'use strict';
// Answer Board: a quiz-board game show, tuned for families rather than
// champions. The server runs it; the TV and phones draw it.
//
// The player in control picks a clue. The host reads it, then everyone races
// to buzz in. Right answers win the clue's value and control. In easy mode the
// buzzer gets four choices; otherwise they type (no "What is…" needed, typos
// forgiven). Daily Doubles let the picker wager. After the double round,
// everyone wagers and answers the final clue in secret.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { matchAnswer, normalize } = require('./survey');

const MAX_PLAYERS = 8;
const LEVELS = 5;
const SECS = { open: 8, typed: 15, choice: 10, ddWager: 20, ddTyped: 20, ddChoice: 15, reveal: 4, finalWager: 30, finalClue: 30, roundBreak: 5, finalStep: 4 };

class QuizError extends Error {}
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------- clue files ---------- */
//   ## CATEGORY NAME
//   1 | clue text | ANSWER / other ways to say it
//   ... levels 1 to 5, one of each
//   FINAL | CATEGORY | clue text | ANSWER / others | WRONG ONE; WRONG TWO; WRONG THREE

function keysFor(answer, alts) {
  return [...new Set([answer, ...alts].map(normalize).filter(Boolean))];
}

function parseClues(text, filename = 'clues') {
  const cats = [];
  const finals = [];
  let cat = null;
  // "# Difficulty: easy" at the top tags the whole file; standard otherwise.
  const tag = String(text).match(/^#\s*Difficulty:\s*(\w+)/im);
  const difficulty = tag ? tag[1].toLowerCase() : 'standard';
  const fail = (n, msg) => { throw new QuizError(`${filename} line ${n}: ${msg}`); };
  const finish = () => {
    if (!cat) return;
    if (cat.clues.length !== LEVELS || cat.clues.some((c, i) => c.level !== i + 1)) fail(cat.line, `"${cat.name}" needs one clue at each level 1 to 5, in order.`);
    cats.push({ name: cat.name, difficulty, clues: cat.clues.map(({ line, ...c }) => c) });
    cat = null;
  };
  String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/).forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('//') || /^#(?!#)/.test(line)) return;
    if (line.startsWith('##')) { finish(); cat = { name: line.slice(2).trim().toUpperCase(), clues: [], line: n }; if (!cat.name) fail(n, 'category has no name.'); return; }
    const parts = line.split('|').map(s => s.trim());
    if (/^FINAL$/i.test(parts[0])) {
      finish();
      if (parts.length !== 5) fail(n, 'FINAL | CATEGORY | clue | ANSWER / others | WRONG; WRONG; WRONG');
      const [answer, ...alts] = parts[3].split('/').map(s => s.trim());
      const wrong = parts[4].split(';').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (wrong.length !== 3) fail(n, 'a final clue needs three wrong choices.');
      finals.push({ category: parts[1].toUpperCase(), difficulty, q: parts[2], a: answer.toUpperCase(), keys: keysFor(answer, alts), wrong });
      return;
    }
    if (!cat) fail(n, 'a clue before any "## CATEGORY".');
    if (parts.length !== 3) fail(n, 'should look like: 3 | clue text | ANSWER / other ways to say it');
    const level = +parts[0];
    if (!(level >= 1 && level <= LEVELS)) fail(n, 'the level must be 1 to 5.');
    const [answer, ...alts] = parts[2].split('/').map(s => s.trim());
    if (!answer || !parts[1]) fail(n, 'missing the clue or the answer.');
    cat.clues.push({ level, q: parts[1], a: answer.toUpperCase(), keys: keysFor(answer, alts), line: n });
  });
  finish();
  return { cats, finals };
}

class ClueStore {
  constructor({ dir }) {
    this.cats = [];
    this.finals = [];
    fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort().forEach(f => {
      try {
        const r = parseClues(fs.readFileSync(path.join(dir, f), 'utf8'), f);
        this.cats.push(...r.cats);
        this.finals.push(...r.finals);
      } catch (e) {
        console.error(`Skipping clues ${f}: ${e.message}`);
      }
    });
  }
}

// "What is a cow?" -> "a cow"
const stripQuestion = s => String(s || '').replace(/^\s*(what|who|where|when)\s*('?s|\s+is|\s+are|\s+was|\s+were)\s+/i, '');

/* ---------- the game ---------- */

class Quiz {
  constructor(opts) {
    this.clues = opts.clues;
    this.onChange = opts.onChange || (() => {});
    this.fx = opts.fx || (() => {});
    this.now = opts.now || Date.now;
    this.setTimer = opts.setTimer || setTimeout;
    this.clearTimer = opts.clearTimer || clearTimeout;
    this.random = opts.random || Math.random;
    this.code = opts.code;
    this.settings = { difficulty: 'standard', choices: false, penalty: false, rounds: 2, final: true };
    this.players = [];
    this.nextId = 1;
    this.usedCats = new Set();
    this.usedFinals = new Set();
    this.reset();
  }

  reset() {
    this.stopTimer();
    this.phase = 'lobby';
    this.roundIdx = 0;
    this.rounds = [];
    this.taken = new Set();
    this.controlId = null;
    this.clue = null;
    this.buzzer = null;
    this.tried = new Set();
    this.last = null;
    this.final = null;
    this.champ = null;
    this.msg = '';
  }

  changed() { this.onChange(); }

  /* ---------- players ---------- */

  player(id) { return this.players.find(p => p.id === id) || null; }
  name(id) { return (this.player(id) || {}).name || 'Someone'; }

  join(rawName, token) {
    let p = token ? this.players.find(x => x.token === token) : null;
    if (p) return p;
    const name = clean(rawName, 16);
    if (!name) throw new QuizError('Type your name.');
    p = this.players.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (p && p.connected) throw new QuizError(`${p.name} is already playing. Pick a different name.`);
    if (!p) {
      if (this.players.length >= MAX_PLAYERS) throw new QuizError(`The game is full. ${MAX_PLAYERS} players is the limit.`);
      p = { id: 'p' + this.nextId++, name, score: 0, token: crypto.randomBytes(16).toString('hex'), connected: false };
      this.players.push(p);
      this.fx({ kind: 'join' });
    }
    this.changed();
    return p;
  }

  adoptPlayers(players, nextId) {
    this.players = players.map(p => ({ id: p.id, name: p.name, token: p.token, connected: p.connected, score: 0 }));
    this.nextId = Math.max(this.nextId, nextId);
  }

  setConnected(id, on) {
    const p = this.player(id);
    if (!p || p.connected === on) return;
    p.connected = on;
    if (this.phase === 'open') this.maybeAllTried();
    if (this.phase === 'finalWager' || this.phase === 'finalClue') this.maybeFinalDone();
    this.changed();
  }

  remove(id) {
    const i = this.players.findIndex(p => p.id === id);
    if (i < 0) return;
    this.players.splice(i, 1);
    if (!this.players.length) { this.toLobby(); return; }
    if (this.controlId === id) this.controlId = this.players[0].id;
    if (this.buzzer === id) { this.buzzer = null; this.openBuzzers(4); return; }
    if ((this.phase === 'ddWager' || this.phase === 'ddAnswer') && this.clue && this.clue.ddPlayer === id) { this.reveal(null); return; }
    if (this.phase === 'finalWager' || this.phase === 'finalClue') this.maybeFinalDone();
    this.changed();
  }

  connectedPlayers() { return this.players.filter(p => p.connected); }

  /* ---------- settings and setup ---------- */

  updateSettings(s) {
    if (this.phase !== 'lobby') throw new QuizError('Change settings from the lobby.');
    ['choices', 'penalty', 'final'].forEach(k => { if (s[k] !== undefined) this.settings[k] = !!s[k]; });
    if (s.rounds !== undefined) { if (![1, 2].includes(+s.rounds)) throw new QuizError('Pick 1 or 2 rounds.'); this.settings.rounds = +s.rounds; }
    if (s.difficulty !== undefined) { if (!['standard', 'easy'].includes(s.difficulty)) throw new QuizError('Unknown difficulty.'); this.settings.difficulty = s.difficulty; }
    this.changed();
  }

  toLobby() {
    const keep = this.players;
    this.reset();
    this.players = keep;
    this.changed();
  }

  pick(list, used, n, key) {
    let pool = list.filter(x => !used.has(key(x)));
    if (pool.length < n) { used.clear(); pool = [...list]; }
    const out = [];
    while (out.length < n && pool.length) {
      const x = pool.splice(Math.floor(this.random() * pool.length), 1)[0];
      used.add(key(x));
      out.push(x);
    }
    return out;
  }

  buildRound(mult, ddCount) {
    const cats = this.pick(this.cats(), this.usedCats, 6, c => c.name);
    const dd = new Set();
    let guard = 0;
    while (dd.size < ddCount && guard++ < 50) {
      // Daily Doubles hide in the lower rows, like the show.
      const c = Math.floor(this.random() * cats.length), r = 2 + Math.floor(this.random() * 3);
      dd.add(`${c},${r}`);
    }
    return { mult, cats, dd };
  }

  start() {
    if (this.phase !== 'lobby') throw new QuizError('The game has already started.');
    if (!this.players.length) throw new QuizError('Join on a phone first.');
    if (this.cats().length < 6) throw new QuizError('There aren’t enough categories at this difficulty.');
    this.players.forEach(p => { p.score = 0; });
    this.rounds = [this.buildRound(1, 1)];
    if (this.settings.rounds === 2) this.rounds.push(this.buildRound(2, 2));
    this.roundIdx = 0;
    this.controlId = this.players[Math.floor(this.random() * this.players.length)].id;
    this.startBoard();
  }

  // Clues at the chosen difficulty (all of them if a level has too few).
  cats() {
    const at = this.clues.cats.filter(c => c.difficulty === this.settings.difficulty);
    return at.length >= 6 ? at : this.clues.cats;
  }
  finals() {
    const at = this.clues.finals.filter(f => f.difficulty === this.settings.difficulty);
    return at.length ? at : this.clues.finals;
  }

  round() { return this.rounds[this.roundIdx]; }
  value(r) { return (r + 1) * 200 * this.round().mult; }

  startBoard() {
    this.stopTimer();
    this.taken = new Set();
    this.phase = 'board';
    this.clue = null;
    this.msg = `${this.name(this.controlId)}, pick a clue!`;
    this.fx({ kind: 'board', round: this.roundIdx + 1 });
    this.changed();
  }

  /* ---------- clues ---------- */

  choicesFor(cat, clue) {
    const others = cat.clues.filter(c => c !== clue).map(c => c.a);
    const wrong = this.pick(others, new Set(), 3, x => x);
    const all = [clue.a, ...wrong];
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    return all;
  }

  choose(id, c, r) {
    if (this.phase !== 'board') throw new QuizError('Not now.');
    if (id !== null && id !== this.controlId) throw new QuizError(`${this.name(this.controlId)} is picking.`);
    c = +c; r = +r;
    const cat = this.round().cats[c];
    if (!cat || !(r >= 0 && r < LEVELS)) throw new QuizError('Pick a clue on the board.');
    if (this.taken.has(`${c},${r}`)) throw new QuizError('That one’s been played.');
    this.taken.add(`${c},${r}`);
    const clue = cat.clues[r];
    const dd = this.round().dd.has(`${c},${r}`);
    this.clue = { c, r, category: cat.name, q: clue.q, a: clue.a, keys: clue.keys, value: this.value(r), dd, choices: this.choicesFor(cat, clue), ddPlayer: null, wager: 0 };
    this.tried = new Set();
    this.buzzer = null;
    this.last = null;
    if (dd) {
      this.clue.ddPlayer = this.controlId;
      this.phase = 'ddWager';
      this.msg = `Daily Double! ${this.name(this.controlId)}, make your wager.`;
      this.fx({ kind: 'dailyDouble' });
      this.startTimer(SECS.ddWager, () => this.ddWager(this.controlId, this.ddMin(), true));
    } else {
      this.phase = 'reading';
      this.msg = '';
      this.fx({ kind: 'clue', q: clue.q });
      // Buzzers open once the host has had time to read it out.
      const readMs = Math.min(9000, 1500 + clue.q.length * 55);
      this.startTimer(readMs / 1000, () => this.openBuzzers(SECS.open));
    }
    this.changed();
  }

  openBuzzers(secs) {
    this.phase = 'open';
    this.buzzer = null;
    this.msg = this.tried.size ? 'Anyone else? Buzz in!' : 'Buzz in!';
    this.fx({ kind: 'open' });
    this.startTimer(secs, () => this.reveal(null, true));
    this.changed();
  }

  buzz(id) {
    if (this.phase === 'reading') throw new QuizError('Wait for the host to finish reading!');
    if (this.phase !== 'open') throw new QuizError('Too late!');
    if (this.tried.has(id)) throw new QuizError('You already had a go at this one.');
    this.buzzer = id;
    this.phase = 'answering';
    this.msg = `${this.name(id)}!`;
    this.fx({ kind: 'buzz', id });
    this.startTimer(this.settings.choices ? SECS.choice : SECS.typed, () => this.answer(id, '', true));
    this.changed();
  }

  // A tapped choice is right only if it is the answer itself (so a choice
  // like "POLAR BEAR" can't count for "BEAR"); typed answers are forgiving.
  isRight(text, keys, a, choices) {
    const t = stripQuestion(text);
    if (normalize(t) === normalize(a)) return true;
    if (choices && choices.some(ch => normalize(ch) === normalize(t))) return false;
    return matchAnswer(t, [{ keys }]) === 0;
  }

  answer(id, text, timedOut) {
    if (this.phase !== 'answering' || this.buzzer !== id) throw new QuizError('It’s not your turn to answer.');
    text = clean(text, 60);
    if (!text && !timedOut) throw new QuizError('Type your answer.');
    this.stopTimer();
    const c = this.clue;
    const p = this.player(id);
    if (!timedOut && this.isRight(text, c.keys, c.a, c.choices)) {
      p.score += c.value;
      this.controlId = id;
      this.last = { id, text: text.toUpperCase(), right: true, value: c.value };
      this.fx({ kind: 'right' });
      return this.reveal(id);
    }
    if (this.settings.penalty) p.score -= c.value;
    this.tried.add(id);
    this.last = { id, text: timedOut ? '(time ran out)' : text.toUpperCase(), right: false, value: c.value };
    this.fx({ kind: 'wrong' });
    this.buzzer = null;
    if (this.maybeAllTried()) return;
    this.openBuzzers(5);
  }

  maybeAllTried() {
    const left = this.connectedPlayers().filter(p => !this.tried.has(p.id));
    if (!left.length) { this.reveal(null, false); return true; }
    return false;
  }

  /* ---------- Daily Double ---------- */

  ddMin() { return 5; }
  ddMax(id) { return Math.max((this.player(id) || {}).score || 0, LEVELS * 200 * this.round().mult); }

  ddWager(id, amount, auto) {
    if (this.phase !== 'ddWager' || id !== this.clue.ddPlayer) throw new QuizError('It’s not your wager.');
    const max = this.ddMax(id);
    amount = Math.round(+amount);
    if (!(amount >= this.ddMin() && amount <= max)) {
      if (!auto) throw new QuizError(`Wager between $5 and $${max.toLocaleString('en-US')}.`);
      amount = this.ddMin();
    }
    this.clue.wager = amount;
    this.phase = 'ddAnswer';
    this.buzzer = id;
    this.msg = `${this.name(id)} wagers $${amount.toLocaleString('en-US')}.`;
    this.fx({ kind: 'clue', q: this.clue.q });
    this.startTimer(this.settings.choices ? SECS.ddChoice : SECS.ddTyped, () => this.ddAnswer(id, '', true));
    this.changed();
  }

  ddAnswer(id, text, timedOut) {
    if (this.phase !== 'ddAnswer' || id !== this.clue.ddPlayer) throw new QuizError('It’s not your Daily Double.');
    text = clean(text, 60);
    if (!text && !timedOut) throw new QuizError('Type your answer.');
    this.stopTimer();
    const c = this.clue, p = this.player(id);
    const right = !timedOut && this.isRight(text, c.keys, c.a, c.choices);
    if (right) p.score += c.wager; else p.score -= c.wager;
    this.last = { id, text: timedOut ? '(time ran out)' : text.toUpperCase(), right, value: c.wager };
    this.fx({ kind: right ? 'right' : 'wrong' });
    this.reveal(right ? id : null);
  }

  /* ---------- after each clue ---------- */

  reveal(winnerId, timesUp) {
    this.stopTimer();
    this.phase = 'reveal';
    this.buzzer = null;
    const c = this.clue;
    if (timesUp) this.fx({ kind: 'timesUp' });
    this.msg = winnerId ? `${this.name(winnerId)} got it! +$${(c.dd ? c.wager : c.value).toLocaleString('en-US')}`
      : `The answer: ${c.a}`;
    this.changed();
    this.startTimer(SECS.reveal, () => this.afterClue());
  }

  afterClue() {
    this.clue = null;
    const total = this.round().cats.length * LEVELS;
    if (this.taken.size < total) {
      this.phase = 'board';
      this.msg = `${this.name(this.controlId)}, pick a clue!`;
      return this.changed();
    }
    if (this.roundIdx + 1 < this.rounds.length) {
      this.phase = 'roundBreak';
      this.msg = 'Double round! Every clue is worth twice as much.';
      this.fx({ kind: 'roundBreak' });
      this.changed();
      return this.startTimer(SECS.roundBreak, () => {
        this.roundIdx++;
        // The player in last place picks first.
        const low = [...this.players].sort((a, b) => a.score - b.score)[0];
        this.controlId = low.id;
        this.startBoard();
      });
    }
    if (this.settings.final && this.clues.finals.length) return this.startFinal();
    this.finish();
  }

  // From the TV: skip the rest of a round (a long game, or someone left).
  endRound() {
    if (!['board', 'reveal'].includes(this.phase)) throw new QuizError('Finish this clue first.');
    this.round().cats.forEach((cat, c) => cat.clues.forEach((x, r) => this.taken.add(`${c},${r}`)));
    this.afterClue();
  }

  /* ---------- final round ---------- */

  startFinal() {
    this.stopTimer();
    const f = this.pick(this.finals(), this.usedFinals, 1, x => x.q)[0];
    const choices = [f.a, ...f.wrong];
    for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; }
    this.final = { ...f, choices, wagers: {}, answers: {}, order: [], step: -1 };
    this.phase = 'finalWager';
    this.msg = `The final category is ${f.category}. Everyone, make your wager!`;
    this.fx({ kind: 'final' });
    this.startTimer(SECS.finalWager, () => this.toFinalClue());
    this.changed();
  }

  finalMax(id) { return Math.max(0, (this.player(id) || {}).score || 0); }

  finalWager(id, amount) {
    if (this.phase !== 'finalWager') throw new QuizError('Not time to wager.');
    if (this.final.wagers[id] !== undefined) throw new QuizError('Your wager is locked in.');
    const max = this.finalMax(id);
    amount = Math.round(+amount);
    if (!(amount >= 0 && amount <= max)) throw new QuizError(`Wager between $0 and $${max.toLocaleString('en-US')}.`);
    this.final.wagers[id] = amount;
    this.fx({ kind: 'lock' });
    this.maybeFinalDone();
    this.changed();
  }

  maybeFinalDone() {
    const f = this.final;
    if (!f) return;
    const live = this.connectedPlayers();
    if (this.phase === 'finalWager' && live.every(p => f.wagers[p.id] !== undefined)) this.toFinalClue();
    else if (this.phase === 'finalClue' && live.every(p => f.answers[p.id] !== undefined)) this.toFinalReveal();
  }

  toFinalClue() {
    this.stopTimer();
    this.players.forEach(p => { if (this.final.wagers[p.id] === undefined) this.final.wagers[p.id] = 0; });
    this.phase = 'finalClue';
    this.msg = 'Here is the final clue. You have 30 seconds.';
    this.fx({ kind: 'finalClue', q: this.final.q });
    this.startTimer(SECS.finalClue, () => this.toFinalReveal());
    this.changed();
  }

  finalAnswer(id, text) {
    if (this.phase !== 'finalClue') throw new QuizError('Not time to answer.');
    if (this.final.answers[id] !== undefined) throw new QuizError('Your answer is locked in.');
    text = clean(text, 60);
    if (!text) throw new QuizError('Type your answer.');
    this.final.answers[id] = text.toUpperCase();
    this.fx({ kind: 'lock' });
    this.maybeFinalDone();
    this.changed();
  }

  // Reveal from the lowest score up, one player every few seconds.
  toFinalReveal() {
    this.stopTimer();
    const f = this.final;
    f.order = [...this.players].sort((a, b) => a.score - b.score).map(p => p.id);
    f.results = {};
    f.order.forEach(id => {
      const ans = f.answers[id] || '';
      const right = !!ans && this.isRight(ans, f.keys, f.a, f.choices);
      f.results[id] = { answer: ans || '(no answer)', right, wager: f.wagers[id] || 0 };
    });
    this.phase = 'finalReveal';
    f.step = -1;
    this.msg = 'Let’s see how everyone did…';
    this.fx({ kind: 'finalReveal' });
    this.changed();
    this.startTimer(2, () => this.finalStep());
  }

  finalStep() {
    const f = this.final;
    f.step++;
    if (f.step >= f.order.length) return this.finish();
    const id = f.order[f.step];
    const r = f.results[id];
    const p = this.player(id);
    if (p) p.score += r.right ? r.wager : -r.wager;
    this.msg = `${this.name(id)} wrote “${r.answer}”: ${r.right ? 'right' : 'wrong'}! Wager $${r.wager.toLocaleString('en-US')}.`;
    this.fx({ kind: r.right ? 'right' : 'wrong' });
    this.changed();
    this.startTimer(SECS.finalStep, () => this.finalStep());
  }

  finish() {
    this.stopTimer();
    const ranked = [...this.players].sort((a, b) => b.score - a.score);
    const ties = ranked.filter(p => p.score === ranked[0].score);
    this.champ = {
      title: ties.length > 1 ? `It’s a tie: ${ties.map(p => p.name).join(' and ')}!` : `${ranked[0].name} wins!`,
      answer: this.final ? `The final answer was ${this.final.a}.` : '',
      rows: ranked.map(p => ({ name: p.name, score: p.score })),
    };
    this.phase = 'champ';
    this.fx({ kind: 'champ' });
    this.changed();
  }

  /* ---------- clock ---------- */

  startTimer(secs, fn) {
    this.stopTimer();
    this.timer = { total: secs * 1000, endsAt: this.now() + secs * 1000 };
    this.handle = this.setTimer(() => { this.handle = null; this.timer = null; fn(); }, secs * 1000);
  }

  stopTimer() {
    if (this.handle) this.clearTimer(this.handle);
    this.handle = null;
    this.timer = null;
  }

  /* ---------- what the screens see ---------- */

  view() {
    const rd = this.rounds[this.roundIdx];
    const c = this.clue;
    const f = this.final;
    const answering = ['answering', 'ddAnswer'].includes(this.phase);
    return {
      game: 'quiz',
      code: this.code,
      phase: this.phase,
      round: this.roundIdx + 1,
      rounds: this.rounds.length,
      settings: this.settings,
      players: this.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected })),
      controlId: this.controlId,
      board: rd ? {
        cats: rd.cats.map(x => x.name),
        values: [0, 1, 2, 3, 4].map(r => (r + 1) * 200 * rd.mult),
        taken: [...this.taken],
      } : null,
      clue: c ? {
        c: c.c, r: c.r, category: c.category, q: this.phase === 'ddWager' ? '' : c.q, value: c.value, dd: c.dd,
        ddPlayer: c.ddPlayer, wager: c.wager,
        choices: answering && this.settings.choices ? c.choices : null,
        a: this.phase === 'reveal' ? c.a : null,
        ddMax: c.dd ? this.ddMax(c.ddPlayer) : null,
      } : null,
      buzzer: this.buzzer,
      tried: [...this.tried],
      last: this.last,
      final: f ? {
        category: f.category,
        q: ['finalClue', 'finalReveal'].includes(this.phase) ? f.q : '',
        choices: this.phase === 'finalClue' && this.settings.choices ? f.choices : null,
        wagered: Object.keys(f.wagers),
        answered: Object.keys(f.answers),
        maxes: Object.fromEntries(this.players.map(p => [p.id, this.finalMax(p.id)])),
        order: f.order, step: f.step,
        results: this.phase === 'finalReveal' ? Object.fromEntries(f.order.slice(0, f.step + 1).map(id => [id, f.results[id]])) : null,
        a: this.phase === 'finalReveal' && f.step >= 0 ? f.a : null,
      } : null,
      champ: this.phase === 'champ' ? this.champ : null,
      msg: this.msg,
      timer: this.timer ? { total: this.timer.total, remaining: Math.max(0, this.timer.endsAt - this.now()) } : null,
    };
  }
}

module.exports = { Quiz, QuizError, ClueStore, parseClues, stripQuestion };

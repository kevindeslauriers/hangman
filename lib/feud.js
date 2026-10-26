'use strict';
// Family Face-Off: survey game show rules, where every player is their own
// family. Like lib/game.js, the server runs it and the screens just draw it.
//
// A round: face-off (first two to buzz answer; the better answer wins the
// board) -> play or pass -> the family in control answers until the board is
// cleared or they get three strikes -> everyone else gets one steal answer.
// Rounds 3 and 4 on are worth double and triple. First to the target plays
// Fast Money with a partner: five questions each, 200 points to win.

const crypto = require('crypto');
const { matchAnswer, normalize } = require('./survey');

const MAX_PLAYERS = 8;
const TARGETS = [200, 300, 500];
const SECS = { faceoff: 15, decide: 10, play: 20, steal: 25, fast1: 20, fast2: 25 };
const FAST_GOAL = 200;

class FeudError extends Error {}

const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

class Feud {
  constructor(opts) {
    this.surveys = opts.surveys;
    this.onChange = opts.onChange || (() => {});
    this.fx = opts.fx || (() => {});
    this.now = opts.now || Date.now;
    this.setTimer = opts.setTimer || setTimeout;
    this.clearTimer = opts.clearTimer || clearTimeout;
    this.random = opts.random || Math.random;
    this.code = opts.code;
    this.settings = { target: 300, timerOn: true };
    this.players = [];
    this.nextId = 1;
    this.used = new Set();
    this.reset();
  }

  reset() {
    this.stopTimer();
    this.phase = 'lobby';
    this.round = 0;
    this.question = null;
    this.revealed = new Set();
    this.bank = 0;
    this.strikes = 0;
    this.controlId = null;
    this.faceoff = null;
    this.steal = null;
    this.result = null;
    this.lastMiss = null;
    this.fast = null;
    this.champ = null;
    this.msg = '';
  }

  changed() { this.onChange(); }

  /* ---------- players (the same rules as Hangman) ---------- */

  player(id) { return this.players.find(p => p.id === id) || null; }
  name(id) { return (this.player(id) || {}).name || 'Someone'; }

  join(rawName, token) {
    let p = token ? this.players.find(x => x.token === token) : null;
    if (p) return p;
    const name = clean(rawName, 16);
    if (!name) throw new FeudError('Type your name.');
    p = this.players.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (p && p.connected) throw new FeudError(`${p.name} is already playing. Pick a different name.`);
    if (!p) {
      if (this.players.length >= MAX_PLAYERS) throw new FeudError(`The game is full. ${MAX_PLAYERS} players is the limit.`);
      p = { id: 'p' + this.nextId++, name, score: 0, token: crypto.randomBytes(16).toString('hex'), connected: false };
      this.players.push(p);
      this.fx({ kind: 'join' });
    }
    this.changed();
    return p;
  }

  // Switching games in the lobby brings everyone along, scores reset.
  adoptPlayers(players, nextId) {
    this.players = players.map(p => ({ id: p.id, name: p.name, token: p.token, connected: p.connected, score: 0 }));
    this.nextId = Math.max(this.nextId, nextId);
  }

  setConnected(id, on) {
    const p = this.player(id);
    if (!p || p.connected === on) return;
    p.connected = on;
    if (this.phase === 'steal') this.maybeEndSteal();
    this.changed();
  }

  remove(id) {
    const i = this.players.findIndex(p => p.id === id);
    if (i < 0) return;
    this.players.splice(i, 1);
    if (this.players.length < 2 && this.phase !== 'lobby') { this.toLobby(); return; }
    if (this.phase === 'lobby') { this.changed(); return; }
    if (this.fast && this.fast.ids.includes(id)) { this.toLobby(); return; }
    if (this.faceoff && this.faceoff.contenders.includes(id)) { this.openBuzz('Face-off restarted.'); return; }
    if (this.controlId === id) {
      this.controlId = null;
      this.openBuzz('Face-off restarted.');
      return;
    }
    if (this.phase === 'steal') this.maybeEndSteal();
    this.changed();
  }

  /* ---------- settings ---------- */

  updateSettings(s) {
    if (this.phase !== 'lobby') throw new FeudError('Change settings from the lobby.');
    if (s.target !== undefined) { if (!TARGETS.includes(+s.target)) throw new FeudError('Unknown target.'); this.settings.target = +s.target; }
    if (s.timerOn !== undefined) this.settings.timerOn = !!s.timerOn;
    this.changed();
  }

  toLobby() {
    const keep = this.players;
    this.reset();
    this.players = keep;
    this.changed();
  }

  start() {
    if (this.phase !== 'lobby') throw new FeudError('The game has already started.');
    if (this.players.length < 2) throw new FeudError('Face-Off needs at least 2 players.');
    this.players.forEach(p => { p.score = 0; });
    this.round = 0;
    this.nextRound();
  }

  multiplier(round = this.round) { return round >= 4 ? 3 : round === 3 ? 2 : 1; }

  pickQuestion(minAnswers) {
    const all = this.surveys.questions;
    let pool = all.filter(q => !this.used.has(q.text) && q.answers.length >= minAnswers);
    if (!pool.length) { this.used.clear(); pool = all.filter(q => q.answers.length >= minAnswers); }
    if (!pool.length) pool = all;
    const q = pool[Math.floor(this.random() * pool.length)];
    this.used.add(q.text);
    return q;
  }

  nextRound() {
    this.stopTimer();
    this.round++;
    // Bigger boards early, shorter ones when the points are doubled.
    this.question = this.pickQuestion(this.multiplier() === 1 ? 5 : 3);
    this.revealed = new Set();
    this.bank = 0;
    this.strikes = 0;
    this.controlId = null;
    this.steal = null;
    this.result = null;
    this.faceoff = null;
    this.fx({ kind: 'round', multiplier: this.multiplier() });
    this.openBuzz(this.multiplier() > 1 ? `${this.multiplier() === 2 ? 'Double' : 'Triple'} points! Buzz in!` : 'Buzz in!');
  }

  /* ---------- face-off ---------- */

  openBuzz(msg) {
    this.stopTimer();
    this.phase = 'faceoff';
    this.faceoff = { contenders: [], answers: {}, answering: null, open: true, tries: (this.faceoff && this.faceoff.tries) || 0 };
    this.lastMiss = null;
    this.msg = msg;
    this.changed();
  }

  buzz(id) {
    const f = this.faceoff;
    if (this.phase !== 'faceoff' || !f.open) throw new FeudError('The buzzer isn’t open.');
    if (f.contenders.includes(id)) return;
    f.contenders.push(id);
    this.fx({ kind: 'buzz', id });
    if (f.contenders.length === 1) {
      f.answering = id;
      this.msg = `${this.name(id)} buzzed in first!`;
      this.startTimer(SECS.faceoff, () => this.faceoffAnswer(id, '', true));
    }
    if (f.contenders.length === 2) { f.open = false; this.buzzAfter(); }
    this.changed();
  }

  faceoffAnswer(id, text, timedOut) {
    const f = this.faceoff;
    if (this.phase !== 'faceoff' || f.answering !== id) throw new FeudError('It’s not your turn to answer.');
    text = clean(text, 40);
    if (!text && !timedOut) throw new FeudError('Type an answer.');
    let idx = timedOut ? -1 : matchAnswer(text, this.question.answers);
    if (idx >= 0 && this.revealed.has(idx)) idx = -1;
    f.answers[id] = { text: timedOut ? '(time ran out)' : text.toUpperCase(), idx };
    this.stopTimer();
    if (idx >= 0) this.reveal(idx);
    else {
      this.fx({ kind: 'strike', count: 1 });
      this.lastMiss = { kind: 'faceoff', id, text: f.answers[id].text };
    }
    this.resolveFaceoff();
  }

  // Decide what happens after each face-off answer, from the answers so far.
  resolveFaceoff() {
    const f = this.faceoff;
    const [a, b] = f.contenders;
    const A = f.answers[a], B = b && f.answers[b];
    const pts = r => (r && r.idx >= 0 ? this.question.answers[r.idx].points : -1);
    if (A && !B) {
      if (A.idx === 0) return this.winFaceoff(a, `${A.text} is the top answer!`);
      if (!b) {
        // Waiting for a second buzz.
        f.answering = null;
        this.msg = A.idx >= 0 ? `${A.text} is on the board. Who can beat it? Buzz in!` : `${A.text} isn’t there. Buzz in to steal the face-off!`;
        return this.changed();
      }
      f.answering = b;
      this.msg = `${this.name(b)}, can you beat that?`;
      this.startTimer(SECS.faceoff, () => this.faceoffAnswer(b, '', true));
      return this.changed();
    }
    if (A && B) {
      if (pts(A) < 0 && pts(B) < 0) {
        f.tries++;
        if (f.tries >= 3) return this.winFaceoff(a, 'Nobody found one. The first buzzer takes the board.');
        return this.openBuzz('Nobody’s on the board. Buzz in again!');
      }
      return pts(B) > pts(A) ? this.winFaceoff(b, `${B.text} beats it!`) : this.winFaceoff(a, `${A.text} holds on!`);
    }
    this.changed();
  }

  // A second buzz after the first contender has answered.
  buzzAfter() {
    const f = this.faceoff;
    const [a, b] = f.contenders;
    if (b && f.answers[a] && !f.answers[b] && f.answering === null) {
      f.answering = b;
      this.msg = `${this.name(b)}, your answer?`;
      this.startTimer(SECS.faceoff, () => this.faceoffAnswer(b, '', true));
    }
  }

  winFaceoff(id, why) {
    this.stopTimer();
    this.faceoff.open = false;
    this.faceoff.answering = null;
    this.controlId = id;
    if (this.revealed.size === this.question.answers.length) return this.endRound(id, 'cleared');
    this.phase = 'decide';
    this.msg = `${why} ${this.name(id)} wins the face-off. Play or pass?`;
    this.fx({ kind: 'control' });
    this.startTimer(SECS.decide, () => this.decide(id, 'play'));
    this.changed();
  }

  decide(id, choice) {
    if (this.phase !== 'decide' || id !== this.controlId) throw new FeudError('It’s not your choice.');
    if (choice === 'pass') {
      const other = this.faceoff.contenders.find(x => x !== id) || this.nextPlayer(id);
      this.controlId = other;
    }
    this.phase = 'play';
    this.strikes = 0;
    this.lastMiss = null;
    this.msg = `${this.name(this.controlId)} is playing${choice === 'pass' ? ' (passed)' : ''}. Name the answers!`;
    this.playTimer();
    this.changed();
  }

  nextPlayer(id) {
    const i = this.players.findIndex(p => p.id === id);
    return this.players[(i + 1) % this.players.length].id;
  }

  /* ---------- the board ---------- */

  reveal(idx) {
    this.revealed.add(idx);
    this.bank += this.question.answers[idx].points * this.multiplier();
    this.fx({ kind: 'reveal', idx });
  }

  playTimer() {
    if (this.settings.timerOn) this.startTimer(SECS.play, () => this.strike('Time’s up!'));
  }

  answer(id, text) {
    if (this.phase !== 'play') throw new FeudError('It’s not time to answer.');
    if (id !== this.controlId) throw new FeudError(`${this.name(this.controlId)} is in control.`);
    text = clean(text, 40);
    if (!text) throw new FeudError('Type an answer.');
    const idx = matchAnswer(text, this.question.answers);
    if (idx >= 0 && this.revealed.has(idx)) throw new FeudError(`${this.question.answers[idx].text} is already on the board. Try another!`);
    this.stopTimer();
    if (idx >= 0) {
      this.reveal(idx);
      this.lastMiss = null;
      if (this.revealed.size === this.question.answers.length) return this.endRound(id, 'cleared');
      this.msg = `${text.toUpperCase()}: survey says… yes!`;
      this.playTimer();
      return this.changed();
    }
    this.strike(`${text.toUpperCase()}: not on the board.`, text.toUpperCase());
  }

  // From the TV when someone stalls with the clock off.
  forceStrike() {
    if (this.phase === 'play') return this.strike('Strike!');
    if (this.phase === 'faceoff' && this.faceoff.answering) return this.faceoffAnswer(this.faceoff.answering, '', true);
    throw new FeudError('Nobody is answering right now.');
  }

  strike(why, text) {
    this.stopTimer();
    this.strikes++;
    this.lastMiss = { kind: 'play', id: this.controlId, text: text || '(time ran out)' };
    this.fx({ kind: 'strike', count: this.strikes });
    if (this.strikes >= 3) return this.startSteal(why);
    this.msg = `${why} Strike ${this.strikes}.`;
    this.playTimer();
    this.changed();
  }

  /* ---------- steal ---------- */

  stealers() { return this.players.filter(p => p.id !== this.controlId && p.connected); }

  startSteal(why) {
    this.phase = 'steal';
    this.steal = { answers: {} };
    const n = this.stealers().length;
    this.msg = `${why} Three strikes! ${n === 1 ? this.stealers()[0].name + ', steal' : 'Everyone else, steal'} the ${this.bank} points!`;
    if (!n) return this.endRound(this.controlId, 'nosteal');
    this.startTimer(SECS.steal, () => this.endSteal());
    this.changed();
  }

  stealAnswer(id, text) {
    if (this.phase !== 'steal') throw new FeudError('It’s not time to steal.');
    if (id === this.controlId) throw new FeudError('You can’t steal from yourself!');
    if (this.steal.answers[id]) throw new FeudError('You already locked in an answer.');
    text = clean(text, 40);
    if (!text) throw new FeudError('Type an answer.');
    let idx = matchAnswer(text, this.question.answers);
    if (idx >= 0 && this.revealed.has(idx)) idx = -1;
    this.steal.answers[id] = { text: text.toUpperCase(), idx, at: this.now() };
    this.fx({ kind: 'lock' });
    this.maybeEndSteal();
    this.changed();
  }

  maybeEndSteal() {
    if (this.phase === 'steal' && this.stealers().every(p => this.steal.answers[p.id])) this.endSteal();
  }

  // The earliest right answer steals the bank.
  endSteal() {
    this.stopTimer();
    const hits = Object.entries(this.steal.answers).filter(([, a]) => a.idx >= 0).sort((x, y) => x[1].at - y[1].at);
    if (hits.length) {
      const [id, a] = hits[0];
      this.reveal(a.idx);
      this.lastMiss = null;
      return this.endRound(id, 'steal');
    }
    this.lastMiss = { kind: 'steal' };
    this.endRound(this.controlId, 'nosteal');
  }

  endRound(winnerId, how) {
    this.stopTimer();
    const w = this.player(winnerId);
    if (w) w.score += this.bank;
    this.result = { winnerId, points: this.bank, how };
    this.phase = 'reveal';
    const name = this.name(winnerId);
    this.msg = how === 'cleared' ? `${name} cleared the board! +${this.bank}`
      : how === 'steal' ? `${name} stole it! +${this.bank}`
      : `No steal! ${name} keeps the ${this.bank} points.`;
    this.fx({ kind: how === 'nosteal' ? 'keep' : 'win' });
    this.changed();
  }

  // TV override: a miss that should have counted as answer idx.
  override(idx, stealerId) {
    const q = this.question;
    if (!q || !(idx >= 0 && idx < q.answers.length) || this.revealed.has(idx)) throw new FeudError('Pick an answer that isn’t on the board yet.');
    const m = this.lastMiss;
    if (!m) throw new FeudError('There’s nothing to fix.');
    this.lastMiss = null;
    if (m.kind === 'faceoff' && this.phase === 'faceoff') {
      this.faceoff.answers[m.id].idx = idx;
      this.reveal(idx);
      this.stopTimer();
      return this.resolveFaceoff();
    }
    if (m.kind === 'play' && (this.phase === 'play' || this.phase === 'steal')) {
      this.strikes = Math.max(0, this.strikes - 1);
      this.steal = null;
      this.phase = 'play';
      this.reveal(idx);
      if (this.revealed.size === q.answers.length) return this.endRound(this.controlId, 'cleared');
      this.msg = `The judges say it counts: ${q.answers[idx].text}!`;
      this.playTimer();
      return this.changed();
    }
    if (m.kind === 'steal' && this.phase === 'reveal' && this.result.how === 'nosteal') {
      if (!this.steal || !this.steal.answers[stealerId]) throw new FeudError('Pick whose steal counts.');
      const keeper = this.player(this.result.winnerId);
      if (keeper) keeper.score -= this.result.points;
      this.reveal(idx);
      return this.endRound(stealerId, 'steal');
    }
    throw new FeudError('Too late to change that one.');
  }

  next() {
    if (this.phase !== 'reveal') throw new FeudError('The round isn’t over yet.');
    if (this.leader()) return this.startFast();
    this.nextRound();
  }

  leader() {
    const top = Math.max(...this.players.map(p => p.score));
    if (top < this.settings.target) return null;
    return this.players.find(p => p.score === top);
  }

  /* ---------- Fast Money ---------- */

  startFast() {
    const w = this.leader();
    this.stopTimer();
    this.question = null;
    this.fast = { winnerId: w.id, ids: [w.id], questions: [], answers: [[], []], part: 0, cur: 0, total: 0 };
    if (this.players.length === 2) {
      this.fast.ids.push(this.players.find(p => p.id !== w.id).id);
      return this.beginFast();
    }
    this.phase = 'fastPick';
    this.msg = `${w.name} wins with ${w.score}! Pick a Fast Money partner.`;
    this.fx({ kind: 'win' });
    this.changed();
  }

  pickPartner(id, partnerId) {
    if (this.phase !== 'fastPick') throw new FeudError('It’s not time to pick.');
    if (id !== this.fast.winnerId && id !== null) throw new FeudError(`${this.name(this.fast.winnerId)} picks the partner.`);
    if (partnerId !== this.fast.winnerId && !this.player(partnerId)) throw new FeudError('Pick someone who’s playing.');
    this.fast.ids.push(partnerId);
    this.beginFast();
  }

  beginFast() {
    // Five different questions (repeats only if the survey file is tiny).
    const qs = [];
    const distinct = Math.min(5, this.surveys.questions.length);
    while (qs.length < 5) {
      const q = this.pickQuestion(4);
      if (!qs.includes(q) || qs.length >= distinct) qs.push(q);
    }
    this.fast.questions = qs;
    this.fast.part = 0;
    this.phase = 'fastReady';
    this.msg = `Fast Money! ${this.name(this.fast.ids[0])} goes first.${this.fast.ids[0] === this.fast.ids[1] ? '' : ` ${this.name(this.fast.ids[1])}, no peeking at the TV!`}`;
    this.changed();
  }

  fastGo() {
    if (this.phase !== 'fastReady') throw new FeudError('Fast Money isn’t ready.');
    const f = this.fast;
    f.cur = 0;
    f.answers[f.part] = f.questions.map(() => null);
    this.phase = 'fast';
    this.msg = `${this.name(f.ids[f.part])}, go!`;
    this.fx({ kind: 'fastStart' });
    this.startTimer(f.part === 0 ? SECS.fast1 : SECS.fast2, () => this.endFastPart());
    this.changed();
  }

  fastAnswer(id, text, pass) {
    const f = this.fast;
    if (this.phase !== 'fast' || f.ids[f.part] !== id) throw new FeudError('It’s not your turn.');
    const mine = f.answers[f.part];
    if (!pass) {
      text = clean(text, 40);
      if (!text) throw new FeudError('Type an answer, or pass.');
      const q = f.questions[f.cur];
      const idx = matchAnswer(text, q.answers);
      if (f.part === 1) {
        const first = f.answers[0][f.cur];
        if (first && ((idx >= 0 && first.idx === idx) || normalize(first.text) === normalize(text))) {
          this.fx({ kind: 'dupe' });
          throw new FeudError('Already said! Try something else.');
        }
      }
      mine[f.cur] = { text: text.toUpperCase(), idx, points: idx >= 0 ? q.answers[idx].points : 0 };
    }
    // Next unanswered question, wrapping around to ones that were passed.
    const n = f.questions.length;
    let nxt = -1;
    for (let k = 1; k <= n; k++) { const j = (f.cur + k) % n; if (!mine[j]) { nxt = j; break; } }
    if (nxt < 0) return this.endFastPart();
    f.cur = nxt;
    this.changed();
  }

  endFastPart() {
    this.stopTimer();
    const f = this.fast;
    f.answers[f.part] = f.answers[f.part].map(a => a || { text: '', idx: -1, points: 0 });
    f.total = f.answers.flat().filter(Boolean).reduce((s, a) => s + a.points, 0);
    this.fx({ kind: 'fastEnd' });
    if (f.part === 0) {
      f.part = 1;
      this.phase = 'fastHalf';
      this.msg = `${f.total} points so far. ${this.name(f.ids[1])}, you need ${Math.max(0, FAST_GOAL - f.total)} more.`;
    } else {
      this.phase = 'fastDone';
      this.msg = f.total >= FAST_GOAL ? `${f.total} points! Fast Money WIN!` : `${f.total} points. So close!`;
    }
    this.changed();
  }

  // From the TV after a half: start the second player.
  fastNext() {
    if (this.phase !== 'fastHalf') throw new FeudError('Not now.');
    this.phase = 'fastReady';
    this.msg = `${this.name(this.fast.ids[1])}, you’re up. Don’t repeat an answer!`;
    this.changed();
  }

  fastFix(part, q, idx) {
    const f = this.fast;
    if (!f || !['fastHalf', 'fastDone'].includes(this.phase)) throw new FeudError('Not now.');
    const a = f.answers[part] && f.answers[part][q];
    const ans = f.questions[q] && f.questions[q].answers[idx];
    if (!a || !ans || !a.text) throw new FeudError('Pick an answer to fix.');
    a.idx = idx;
    a.points = ans.points;
    f.total = f.answers.flat().filter(Boolean).reduce((s, x) => s + x.points, 0);
    if (this.phase === 'fastDone') this.msg = f.total >= FAST_GOAL ? `${f.total} points! Fast Money WIN!` : `${f.total} points. So close!`;
    this.changed();
  }

  finish() {
    if (this.phase !== 'fastDone') throw new FeudError('Not now.');
    const f = this.fast;
    const ranked = [...this.players].sort((a, b) => b.score - a.score);
    const pair = f.ids[0] === f.ids[1] ? this.name(f.ids[0]) : `${this.name(f.ids[0])} and ${this.name(f.ids[1])}`;
    this.champ = {
      title: `${this.name(f.winnerId)} wins the game!`,
      fast: f.total >= FAST_GOAL ? `${pair} won Fast Money with ${f.total} points!` : `${pair} got ${f.total} in Fast Money.`,
      won: f.total >= FAST_GOAL,
      rows: ranked.map(p => ({ name: p.name, score: p.score })),
    };
    this.phase = 'champ';
    this.fx({ kind: f.total >= FAST_GOAL ? 'champ' : 'keep' });
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
    const q = this.question;
    const showAll = this.phase === 'reveal';
    const f = this.fast;
    const fastView = f ? {
      winnerId: f.winnerId, ids: f.ids, part: f.part, cur: f.cur, total: f.total, goal: FAST_GOAL,
      question: this.phase === 'fast' ? f.questions[f.cur].text : null,
      // During the second half the TV hides the first half, like the show.
      rows: f.questions.map((qq, i) => ({
        q: qq.text,
        a: [0, 1].map(part => {
          const a = f.answers[part] && f.answers[part][i];
          if (!a) return null;
          const hide = part === 0 && f.part === 1 && ['fastReady', 'fast'].includes(this.phase);
          const scored = this.phase === 'fastHalf' || this.phase === 'fastDone' || this.phase === 'champ';
          return hide ? { text: '', points: null } : { text: a.text, points: scored ? a.points : null };
        }),
        options: ['fastHalf', 'fastDone'].includes(this.phase) ? qq.answers.map(x => x.text) : null,
      })),
    } : null;
    return {
      game: 'feud',
      code: this.code,
      phase: this.phase,
      round: this.round,
      multiplier: this.multiplier(),
      settings: this.settings,
      players: this.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected })),
      question: q ? q.text : '',
      board: q ? q.answers.map((a, i) => ({
        n: i + 1,
        text: this.revealed.has(i) || showAll ? a.text : null,
        points: this.revealed.has(i) || showAll ? a.points : null,
        found: this.revealed.has(i),
      })) : [],
      bank: this.bank,
      strikes: this.strikes,
      controlId: this.controlId,
      faceoff: this.phase === 'faceoff' || this.phase === 'decide' ? {
        contenders: this.faceoff.contenders, answering: this.faceoff.answering, open: this.faceoff.open,
        answers: this.faceoff.answers,
      } : null,
      steal: this.steal ? {
        locked: Object.keys(this.steal.answers),
        answers: this.phase === 'reveal' ? this.steal.answers : null,
      } : null,
      stealers: this.phase === 'steal' ? this.stealers().map(p => p.id) : [],
      lastMiss: this.lastMiss,
      result: this.result,
      fast: fastView,
      champ: this.phase === 'champ' ? this.champ : null,
      msg: this.msg,
      timer: this.timer ? { total: this.timer.total, remaining: Math.max(0, this.timer.endsAt - this.now()) } : null,
      target: this.settings.target,
    };
  }
}

module.exports = { Feud, FeudError, FAST_GOAL, SECS };

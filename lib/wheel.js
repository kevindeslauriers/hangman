'use strict';
// Spin & Solve: a wheel-and-puzzle game show. Like the other games, the
// server runs it and the TV and phones only draw it.
//
// Each round: a toss-up (letters appear one at a time; first to buzz in and
// solve wins cash and starts the round), then the main puzzle: spin and call
// a consonant, buy a vowel, or solve. Bankrupt wipes your round money; only
// the player who solves banks theirs. After the last round, the leader plays
// the Bonus Round: R S T L N E, three more consonants and a vowel, 10 seconds.

const crypto = require('crypto');

const ROW_CAPS = [12, 14, 14, 12];
const COLS = 14;
const VOWELS = 'AEIOU';
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';
const VOWEL_COST = 250;
const MIN_WIN = 1000;
const MAX_PLAYERS = 8;
const SECS = { turn: 15, pick: 10, solve: 15, toss: 10, bonus: 10 };
const TOSS_STEP_MS = 1100;
const BONUS_GIVEN = 'RSTLNE';
const BONUS_PRIZES = [25000, 30000, 35000, 40000, 45000, 50000, 75000, 100000];

class WheelError extends Error {}

const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const lettersOnly = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
const money = n => '$' + n.toLocaleString('en-US');

// 24 wedges, clockwise from the top of the wheel.
function wedges(round) {
  const top = round >= 4 ? 5000 : round >= 2 ? 3500 : 2500;
  return [top, 600, 400, 300, 'BANKRUPT', 900, 300, 500, 650, 500, 700, 'LOSE A TURN',
    800, 500, 650, 500, 900, 'BANKRUPT', 550, 600, 500, 300, 750, 450];
}

// Lay a phrase out on the board: whole words per row, rows centred, the
// fewest rows possible. Returns 4 rows of 14 cells, or null if it won't fit.
//   '#' no square here (the board's corners)   '.' empty green square
//   'A' a letter                               "'" "-" "&" shown from the start
function layout(text) {
  const words = String(text).split(' ').filter(Boolean);
  const plans = [[1], [1, 2], [0, 1, 2], [0, 1, 2, 3]];
  for (const rows of plans) {
    const lines = [];
    let i = 0;
    for (const r of rows) {
      let line = '';
      while (i < words.length) {
        const cand = line ? line + ' ' + words[i] : words[i];
        if (cand.length > ROW_CAPS[r]) break;
        line = cand; i++;
      }
      if (!line) break;
      lines.push(line);
    }
    if (i < words.length) continue;
    const grid = ROW_CAPS.map(cap => {
      const pad = (COLS - cap) / 2;
      return '#'.repeat(pad) + '.'.repeat(cap) + '#'.repeat(pad);
    }).map(r => r.split(''));
    lines.forEach((line, k) => {
      const r = rows[k];
      const start = (COLS - ROW_CAPS[r]) / 2 + Math.floor((ROW_CAPS[r] - line.length) / 2);
      [...line].forEach((ch, j) => { if (ch !== ' ') grid[r][start + j] = ch; });
    });
    return grid;
  }
  return null;
}

class Wheel {
  constructor(opts) {
    this.themes = opts.themes;
    this.onChange = opts.onChange || (() => {});
    this.fx = opts.fx || (() => {});
    this.now = opts.now || Date.now;
    this.setTimer = opts.setTimer || setTimeout;
    this.clearTimer = opts.clearTimer || clearTimeout;
    this.random = opts.random || Math.random;
    this.code = opts.code;
    this.settings = { rounds: 3, tossups: true, bonus: true, timerOn: true };
    this.players = [];
    this.nextId = 1;
    this.usedPuzzles = new Set();
    this.angle = 0;
    this.reset();
  }

  reset() {
    this.stopTimer();
    this.stopStep();
    this.phase = 'lobby';
    this.round = 0;
    this.puzzle = null;
    this.shown = new Set();       // "r,c" squares showing their letter
    this.used = new Set();        // letters called this round
    this.turn = 0;
    this.spin = null;
    this.spinValue = 0;
    this.toss = null;
    this.result = null;
    this.bonus = null;
    this.champ = null;
    this.msg = '';
  }

  changed() { this.onChange(); }

  /* ---------- players ---------- */

  player(id) { return this.players.find(p => p.id === id) || null; }
  name(id) { return (this.player(id) || {}).name || 'Someone'; }
  cur() { return this.players[this.turn]; }

  join(rawName, token) {
    let p = token ? this.players.find(x => x.token === token) : null;
    if (p) return p;
    const name = clean(rawName, 16);
    if (!name) throw new WheelError('Type your name.');
    p = this.players.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (p && p.connected) throw new WheelError(`${p.name} is already playing. Pick a different name.`);
    if (!p) {
      if (this.players.length >= MAX_PLAYERS) throw new WheelError(`The game is full. ${MAX_PLAYERS} players is the limit.`);
      p = { id: 'p' + this.nextId++, name, score: 0, bank: 0, token: crypto.randomBytes(16).toString('hex'), connected: false };
      this.players.push(p);
      this.fx({ kind: 'join' });
    }
    this.changed();
    return p;
  }

  adoptPlayers(players, nextId) {
    this.players = players.map(p => ({ id: p.id, name: p.name, token: p.token, connected: p.connected, score: 0, bank: 0 }));
    this.nextId = Math.max(this.nextId, nextId);
  }

  setConnected(id, on) {
    const p = this.player(id);
    if (!p || p.connected === on) return;
    p.connected = on;
    if (this.phase === 'tossup' && !on) this.maybeEndToss();
    this.changed();
  }

  remove(id) {
    const i = this.players.findIndex(p => p.id === id);
    if (i < 0) return;
    const wasTurn = this.turnPhase() && i === this.turn;
    this.players.splice(i, 1);
    if (!this.players.length) { this.toLobby(); return; }
    if (this.bonus && this.bonus.playerId === id) { this.toLobby(); return; }
    if (i < this.turn) this.turn--;
    this.turn %= this.players.length;
    if (this.toss && this.toss.buzzer === id) { this.toss.buzzer = null; this.resumeToss(); }
    if (wasTurn) { this.turn = (this.turn - 1 + this.players.length) % this.players.length; this.passTurn('Next player!'); return; }
    this.changed();
  }

  turnPhase() { return ['turn', 'spinning', 'consonant', 'vowel', 'solving'].includes(this.phase); }

  /* ---------- settings ---------- */

  updateSettings(s) {
    if (this.phase !== 'lobby') throw new WheelError('Change settings from the lobby.');
    if (s.rounds !== undefined) { if (![2, 3, 4, 5].includes(+s.rounds)) throw new WheelError('Pick 2 to 5 rounds.'); this.settings.rounds = +s.rounds; }
    ['tossups', 'bonus', 'timerOn'].forEach(k => { if (s[k] !== undefined) this.settings[k] = !!s[k]; });
    this.changed();
  }

  toLobby() {
    const keep = this.players;
    this.reset();
    this.players = keep;
    this.changed();
  }

  start() {
    if (this.phase !== 'lobby') throw new WheelError('The game has already started.');
    if (!this.players.length) throw new WheelError('Join on a phone first.');
    this.players.forEach(p => { p.score = 0; p.bank = 0; });
    this.round = 0;
    this.nextRound();
  }

  /* ---------- puzzles ---------- */

  allPuzzles() {
    if (this._all) return this._all;
    const out = [];
    for (const t of this.themes.list()) {
      const theme = this.themes.get(t.id);
      theme.categories.forEach(c => c.phrases.forEach(text => {
        const grid = layout(text);
        if (grid && lettersOnly(text).length >= 4) out.push({ text, category: c.name, grid });
      }));
    }
    return (this._all = out);
  }

  pickPuzzle(filter = () => true) {
    const all = this.allPuzzles().filter(filter);
    let pool = all.filter(p => !this.usedPuzzles.has(p.text));
    if (!pool.length) { this.usedPuzzles.clear(); pool = all; }
    if (!pool.length) throw new WheelError('There are no puzzles that fit the board.');
    const p = pool[Math.floor(this.random() * pool.length)];
    this.usedPuzzles.add(p.text);
    return p;
  }

  setPuzzle(p) {
    this.puzzle = p;
    this.shown = new Set();
    this.used = new Set();
  }

  // Squares holding letter L (or every letter square when L is omitted).
  squares(L) {
    const out = [];
    this.puzzle.grid.forEach((row, r) => row.forEach((ch, c) => {
      if (/[A-Z]/.test(ch) && (!L || ch === L)) out.push(`${r},${c}`);
    }));
    return out;
  }

  hidden(L) { return this.squares(L).filter(k => !this.shown.has(k)); }
  solved() { return this.hidden().length === 0; }
  consonantsLeft() { return this.hidden().some(k => { const [r, c] = k.split(','); return !VOWELS.includes(this.puzzle.grid[r][c]); }); }
  vowelsLeft() { return [...VOWELS].some(v => !this.used.has(v) && this.squares(v).length); }

  // Turn letters over one at a time on the TV, in reading order.
  revealLetter(L) {
    const keys = this.hidden(L);
    keys.forEach(k => this.shown.add(k));
    return keys.length;
  }

  revealAll() { this.squares().forEach(k => this.shown.add(k)); }

  isAnswer(text) { return lettersOnly(text) === lettersOnly(this.puzzle.text); }

  /* ---------- rounds ---------- */

  nextRound() {
    this.stopTimer();
    this.round++;
    this.players.forEach(p => { p.bank = 0; });
    this.result = null;
    this.spinValue = 0;
    this.fx({ kind: 'round' });
    if (this.settings.tossups && this.players.length > 1) this.startToss();
    else this.startMain((this.round - 1) % this.players.length);
  }

  startToss() {
    // Toss-ups are short: two rows at most.
    this.setPuzzle(this.pickPuzzle(p => p.grid[0].every(ch => ch === '#' || ch === '.') && p.grid[3].every(ch => ch === '#' || ch === '.')));
    const order = this.squares();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    this.toss = { order, buzzer: null, locked: new Set(), value: 1000 * Math.min(this.round, 3), winnerId: null };
    this.phase = 'tossup';
    this.msg = `Toss-up for ${money(this.toss.value)}! Buzz in when you know it.`;
    this.changed();
    this.resumeToss();
  }

  resumeToss() {
    this.stopStep();
    if (this.phase !== 'tossup' || this.toss.buzzer) return;
    this.stepHandle = this.setTimer(() => this.tossStep(), TOSS_STEP_MS);
  }

  stopStep() { if (this.stepHandle) this.clearTimer(this.stepHandle); this.stepHandle = null; }

  tossStep() {
    this.stepHandle = null;
    const t = this.toss;
    const next = t.order.find(k => !this.shown.has(k));
    // Stop with one letter left: nobody gets it.
    if (!next || this.hidden().length <= 1) return this.endToss(null);
    this.shown.add(next);
    this.fx({ kind: 'tossLetter' });
    this.changed();
    this.resumeToss();
  }

  buzzToss(id) {
    const t = this.toss;
    if (this.phase !== 'tossup' || t.buzzer) throw new WheelError('Too late!');
    if (t.locked.has(id)) throw new WheelError('You already had your try on this one.');
    this.stopStep();
    t.buzzer = id;
    this.fx({ kind: 'buzz' });
    this.msg = `${this.name(id)} buzzed in!`;
    this.startTimer(SECS.toss, () => this.solveToss(id, '', true));
    this.changed();
  }

  solveToss(id, text, timedOut) {
    const t = this.toss;
    if (this.phase !== 'tossup' || t.buzzer !== id) throw new WheelError('It’s not your turn to solve.');
    if (!timedOut && !clean(text, 60)) throw new WheelError('Type the answer.');
    this.stopTimer();
    if (!timedOut && this.isAnswer(text)) return this.endToss(id);
    t.locked.add(id);
    t.buzzer = null;
    this.fx({ kind: 'wrong' });
    this.msg = timedOut ? `Time’s up, ${this.name(id)}!` : `“${clean(text, 40).toUpperCase()}” isn’t it.`;
    this.changed();
    this.maybeEndToss();
    if (this.phase === 'tossup') this.resumeToss();
  }

  maybeEndToss() {
    if (this.phase === 'tossup' && !this.toss.buzzer && this.players.filter(p => p.connected).every(p => this.toss.locked.has(p.id))) this.endToss(null);
  }

  endToss(winnerId) {
    this.stopStep();
    this.stopTimer();
    this.revealAll();
    this.toss.winnerId = winnerId;
    const w = this.player(winnerId);
    if (w) w.score += this.toss.value;
    this.phase = 'tossDone';
    this.msg = w ? `${w.name} solved it! +${money(this.toss.value)}` : 'Nobody got it!';
    this.fx({ kind: w ? 'solve' : 'nobody' });
    this.changed();
    const starter = w ? this.players.indexOf(w) : (this.round - 1) % this.players.length;
    this.startTimer(4, () => this.startMain(starter));
  }

  startMain(starter) {
    this.toss = null;
    this.setPuzzle(this.pickPuzzle());
    this.turn = Math.max(0, starter) % this.players.length;
    this.phase = 'turn';
    this.msg = `The category is ${this.puzzle.category}. ${this.cur().name}, you’re up!`;
    this.fx({ kind: 'puzzle' });
    this.turnTimer();
    this.changed();
  }

  turnTimer() {
    if (this.settings.timerOn) this.startTimer(SECS.turn, () => this.passTurn('Time’s up!'));
    else this.stopTimer();
  }

  requireTurn(id) {
    if (!this.turnPhase()) throw new WheelError('It’s not time for that.');
    if (this.cur().id !== id) throw new WheelError(`It’s ${this.cur().name}’s turn.`);
  }

  passTurn(why) {
    this.stopTimer();
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.turn + k) % n;
      if (this.players[i].connected || k === n) { this.turn = i; break; }
    }
    this.phase = 'turn';
    this.spinValue = 0;
    this.msg = `${why} ${this.cur().name}, your turn.`;
    this.turnTimer();
    this.changed();
  }

  /* ---------- spinning ---------- */

  doSpin(id, power) {
    this.requireTurn(id);
    if (this.phase !== 'turn') throw new WheelError('Finish what you’re doing first.');
    if (!this.consonantsLeft()) throw new WheelError('Only vowels left! Buy a vowel or solve.');
    this.stopTimer();
    power = Math.min(1, Math.max(0, +power || 0.5));
    const list = wedges(this.round);
    const idx = Math.floor(this.random() * list.length);
    const offset = 2 + this.random() * 11;               // somewhere inside the 15° wedge
    const targetMod = (360 - (idx * 15 + offset) + 360) % 360;
    const from = this.angle;
    const turns = 3 + Math.round(power * 3);
    const to = from + turns * 360 + ((targetMod - (from % 360)) + 360) % 360;
    const duration = Math.round(4200 + power * 2600);
    this.spin = { from, to, duration, startedAt: this.now(), idx };
    this.angle = to % 360;
    this.phase = 'spinning';
    this.msg = `${this.cur().name} spins…`;
    this.fx({ kind: 'spin' });
    this.handle = this.setTimer(() => { this.handle = null; this.land(); }, duration + 400);
    this.changed();
  }

  land() {
    const w = wedges(this.round)[this.spin.idx];
    this.spin = null;
    const p = this.cur();
    if (w === 'BANKRUPT') {
      p.bank = 0;
      this.fx({ kind: 'bankrupt' });
      return this.passTurn(`Bankrupt! ${p.name} loses the round money.`);
    }
    if (w === 'LOSE A TURN') {
      this.fx({ kind: 'loseTurn' });
      return this.passTurn('Lose a turn!');
    }
    this.spinValue = w;
    this.phase = 'consonant';
    this.msg = `${money(w)}! ${p.name}, call a consonant.`;
    this.fx({ kind: 'landed', value: w });
    if (this.settings.timerOn) this.startTimer(SECS.pick, () => this.passTurn('Time’s up!'));
    this.changed();
  }

  callConsonant(id, raw) {
    this.requireTurn(id);
    if (this.phase !== 'consonant') throw new WheelError('Spin first.');
    const L = String(raw || '').toUpperCase();
    if (!CONSONANTS.includes(L) || L.length !== 1) throw new WheelError('Pick a consonant.');
    if (this.used.has(L)) throw new WheelError(`${L} has been called.`);
    this.stopTimer();
    this.used.add(L);
    const n = this.revealLetter(L);
    if (!n) {
      this.fx({ kind: 'noLetter', letter: L });
      return this.passTurn(`No ${L}.`);
    }
    const won = this.spinValue * n;
    this.cur().bank += won;
    this.fx({ kind: 'letters', letter: L, count: n });
    this.msg = `${n === 1 ? 'There’s one' : `There are ${n}`} ${L}${n === 1 ? '' : '’s'}! +${money(won)}`;
    this.spinValue = 0;
    this.phase = 'turn';
    this.turnTimer();
    this.changed();
  }

  buyVowel(id) {
    this.requireTurn(id);
    if (this.phase !== 'turn') throw new WheelError('Finish what you’re doing first.');
    if (this.cur().bank < VOWEL_COST) throw new WheelError(`A vowel costs ${money(VOWEL_COST)}. You need more round money.`);
    if (!this.vowelsLeft()) throw new WheelError('There are no vowels left.');
    this.stopTimer();
    this.phase = 'vowel';
    this.msg = `${this.cur().name} is buying a vowel.`;
    if (this.settings.timerOn) this.startTimer(SECS.pick, () => this.passTurn('Time’s up!'));
    this.changed();
  }

  callVowel(id, raw) {
    this.requireTurn(id);
    if (this.phase !== 'vowel') throw new WheelError('Buy a vowel first.');
    const L = String(raw || '').toUpperCase();
    if (!VOWELS.includes(L) || L.length !== 1) throw new WheelError('Pick a vowel.');
    if (this.used.has(L)) throw new WheelError(`${L} has been called.`);
    this.stopTimer();
    this.used.add(L);
    this.cur().bank -= VOWEL_COST;
    this.fx({ kind: 'vowel' });
    const n = this.revealLetter(L);
    if (!n) {
      this.fx({ kind: 'noLetter', letter: L });
      return this.passTurn(`No ${L}.`);
    }
    this.fx({ kind: 'letters', letter: L, count: n });
    this.msg = `${n === 1 ? 'There’s one' : `There are ${n}`} ${L}${n === 1 ? '' : '’s'}!`;
    this.phase = 'turn';
    this.turnTimer();
    this.changed();
  }

  cancelPick(id) {
    this.requireTurn(id);
    if (this.phase === 'vowel') { this.phase = 'turn'; this.turnTimer(); this.changed(); }
  }

  solveStart(id) {
    this.requireTurn(id);
    if (this.phase !== 'turn') throw new WheelError('Finish what you’re doing first.');
    this.phase = 'solving';
    this.msg = `${this.cur().name} is solving…`;
    this.startTimer(SECS.solve, () => this.passTurn('Time’s up!'));
    this.changed();
  }

  solveCancel(id) {
    this.requireTurn(id);
    if (this.phase !== 'solving') return;
    this.phase = 'turn';
    this.turnTimer();
    this.changed();
  }

  solve(id, text) {
    this.requireTurn(id);
    if (this.phase !== 'solving') throw new WheelError('Tap Solve first.');
    if (!clean(text, 60)) throw new WheelError('Type the answer.');
    this.stopTimer();
    if (!this.isAnswer(text)) {
      this.fx({ kind: 'wrong' });
      return this.passTurn(`“${clean(text, 40).toUpperCase()}” isn’t it.`);
    }
    this.winRound(id);
  }

  winRound(id) {
    this.stopTimer();
    this.revealAll();
    const p = this.player(id);
    const amount = Math.max(p.bank, MIN_WIN);
    p.score += amount;
    this.players.forEach(x => { x.bank = 0; });
    this.result = { winnerId: id, amount, puzzle: this.puzzle.text };
    this.phase = 'roundEnd';
    this.msg = `${p.name} solved it and banks ${money(amount)}!`;
    this.fx({ kind: 'solve' });
    this.changed();
  }

  next() {
    if (this.phase !== 'roundEnd') throw new WheelError('The round isn’t over yet.');
    if (this.round < this.settings.rounds) return this.nextRound();
    if (this.settings.bonus) return this.startBonus();
    this.finish();
  }

  /* ---------- Bonus Round ---------- */

  leader() {
    const top = Math.max(...this.players.map(p => p.score));
    return this.players.find(p => p.score === top);
  }

  startBonus() {
    this.stopTimer();
    const w = this.leader();
    // Bonus puzzles are short, and R S T L N E mustn't give them away.
    this.setPuzzle(this.pickPuzzle(p => {
      const L = lettersOnly(p.text);
      return L.length <= 14 && [...L].filter(ch => !BONUS_GIVEN.includes(ch)).length >= 3;
    }));
    [...BONUS_GIVEN].forEach(L => { this.used.add(L); this.revealLetter(L); });
    this.bonus = { playerId: w.id, picks: '', prize: 0, won: false };
    this.phase = 'bonusPick';
    this.msg = `${w.name} plays the Bonus Round! Here are R, S, T, L, N and E. Pick 3 consonants and a vowel.`;
    this.fx({ kind: 'bonus' });
    this.changed();
  }

  bonusPick(id, letters) {
    if (this.phase !== 'bonusPick' || (id !== null && id !== this.bonus.playerId)) throw new WheelError('It’s not your pick.');
    const picks = [...new Set(String(letters || '').toUpperCase().split(''))].filter(ch => /[A-Z]/.test(ch));
    const cons = picks.filter(ch => CONSONANTS.includes(ch) && !BONUS_GIVEN.includes(ch));
    const vow = picks.filter(ch => VOWELS.includes(ch) && !BONUS_GIVEN.includes(ch));
    if (cons.length !== 3 || vow.length !== 1 || picks.length !== 4) throw new WheelError('Pick 3 new consonants and 1 vowel.');
    this.bonus.picks = picks.join('');
    let n = 0;
    picks.forEach(L => { this.used.add(L); n += this.revealLetter(L); });
    this.fx({ kind: n ? 'letters' : 'noLetter', count: n });
    this.phase = 'bonusSolve';
    this.msg = `${this.name(this.bonus.playerId)}, you have 10 seconds. Good luck!`;
    // Two seconds for the letters to turn, then the 10-second clock.
    this.startTimer(2, () => { this.startTimer(SECS.bonus, () => this.endBonus(false)); this.changed(); });
    this.changed();
  }

  bonusGuess(id, text) {
    if (this.phase !== 'bonusSolve' || id !== this.bonus.playerId) throw new WheelError('It’s not your puzzle.');
    if (!clean(text, 60)) throw new WheelError('Type the answer.');
    if (this.isAnswer(text)) return this.endBonus(true);
    this.fx({ kind: 'wrong' });
    throw new WheelError('Not it! Keep trying!');
  }

  endBonus(won) {
    this.stopTimer();
    this.revealAll();
    const b = this.bonus;
    b.won = won;
    b.prize = BONUS_PRIZES[Math.floor(this.random() * BONUS_PRIZES.length)];
    const p = this.player(b.playerId);
    if (won && p) p.score += b.prize;
    this.phase = 'bonusDone';
    this.msg = won ? `${this.name(b.playerId)} solved it and wins ${money(b.prize)}!` : `So close! The prize was ${money(b.prize)}.`;
    this.fx({ kind: won ? 'bonusWin' : 'bonusLose' });
    this.changed();
  }

  finish() {
    if (!['bonusDone', 'roundEnd'].includes(this.phase)) throw new WheelError('Not now.');
    const ranked = [...this.players].sort((a, b) => b.score - a.score);
    this.champ = { title: `${ranked[0].name} wins with ${money(ranked[0].score)}!`, rows: ranked.map(p => ({ name: p.name, score: p.score })) };
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
    const z = this.puzzle;
    const board = z ? z.grid.map((row, r) => row.map((ch, c) => {
      if (ch === '#' || ch === '.') return ch;
      if (!/[A-Z]/.test(ch)) return ch;                 // punctuation shows from the start
      return this.shown.has(`${r},${c}`) ? ch : '_';
    }).join('')) : null;
    const p = this.turnPhase() ? this.cur() : null;
    return {
      game: 'wheel',
      code: this.code,
      phase: this.phase,
      round: this.round,
      settings: this.settings,
      players: this.players.map(x => ({ id: x.id, name: x.name, score: x.score, bank: x.bank, connected: x.connected })),
      turnId: p ? p.id : null,
      category: z ? z.category : '',
      board,
      used: [...this.used].join(''),
      wedges: wedges(Math.max(1, this.round)),
      angle: this.angle,
      spin: this.spin ? { ...this.spin, elapsed: this.now() - this.spin.startedAt } : null,
      spinValue: this.spinValue,
      canSpin: !!(p && this.phase === 'turn' && this.consonantsLeft()),
      canVowel: !!(p && this.phase === 'turn' && p.bank >= VOWEL_COST && this.vowelsLeft()),
      toss: this.toss ? { buzzer: this.toss.buzzer, locked: [...this.toss.locked], value: this.toss.value, winnerId: this.toss.winnerId } : null,
      result: this.result,
      bonus: this.bonus ? { ...this.bonus, given: BONUS_GIVEN, prize: this.phase === 'bonusDone' || this.phase === 'champ' ? this.bonus.prize : null } : null,
      champ: this.phase === 'champ' ? this.champ : null,
      msg: this.msg,
      timer: this.timer ? { total: this.timer.total, remaining: Math.max(0, this.timer.endsAt - this.now()) } : null,
      vowelCost: VOWEL_COST,
    };
  }
}

module.exports = { Wheel, WheelError, layout, wedges, lettersOnly, VOWEL_COST, MIN_WIN, BONUS_GIVEN };

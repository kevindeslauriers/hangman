'use strict';
// The one game the server runs. The TV and the phones only send commands and
// draw the views this hands out; scoring, turns and the shot clock live here.

const crypto = require('crypto');
const { normalizePhrase, phraseProblem } = require('./themes');

const MAX_MISSES = 6;
const BONUS = 3;
const TURN_SECS = 15;
const SOLVE_SECS = 20;
const MAX_PLAYERS = 8;
const TARGETS = [0, 30, 50, 80];
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const SHOW_PROMPTS = [
  w => `Sing “${w}” like an opera star. Hold that last note!`,
  w => `Sing “${w}” as a slow, dramatic love ballad.`,
  w => `Make up a two line jingle selling “${w}” on TV.`,
  w => `Sing “${w}” like a stadium anthem and get everyone clapping.`,
  w => `Rap four lines about “${w}”.`,
  w => `Sing “${w}” in your best country twang.`,
  w => `Sing “${w}” like a boy band. Dance moves required.`,
  w => `Sing “${w}” as a lullaby. Try to put someone to sleep.`,
  w => `Sing “${w}” to the tune of Happy Birthday.`,
  w => `Sing “${w}” like it’s the seventh inning stretch.`,
  w => `Hit your highest note on “${w}”, then your lowest.`,
  w => `Sing “${w}” like the big finale of a Broadway show.`,
  w => `Pick any song you know and swap “${w}” into one line.`,
  (w, c) => `Sing a bit of any song that fits the hint: ${c}.`,
];
const CLAPS = { 1: 'Polite clap', 2: 'Big cheer', 3: 'Standing ovation' };

class GameError extends Error {}

const titleCase = s => s.toLowerCase().replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
const letters = s => s.replace(/[^A-Z]/g, '');

function makeCode(random = Math.random) {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)];
  return c;
}

class Game {
  constructor(opts) {
    this.themes = opts.themes;
    this.onChange = opts.onChange || (() => {});
    this.fx = opts.fx || (() => {});
    this.now = opts.now || Date.now;
    this.setTimer = opts.setTimer || setTimeout;
    this.clearTimer = opts.clearTimer || clearTimeout;
    this.random = opts.random || Math.random;
    this.code = opts.code || makeCode(this.random);
    const first = this.themes.first();
    this.settings = { themeId: first ? first.id : '', category: 'Anything', mode: 'random', showtime: true, target: 50, timerOn: true };
    this.players = [];
    this.nextId = 1;
    this.phase = 'lobby';
    this.round = 0;
    this.starter = 0;
    this.turn = 0;
    this.setterId = null;
    this.setterTurn = 0;
    this.word = '';
    this.hint = '';
    this.guessed = new Set();
    this.misses = [];
    this.streak = 0;
    this.solveBonus = 0;
    this.solving = false;
    this.savedMs = 0;
    this.used = new Set();
    this.msg = '';
    this.hot = false;
    this.leaderId = null;
    this.matchOver = false;
    this.timer = null;
    this.handle = null;
    this.end = null;
    this.champ = null;
    this.lastPrompt = -1;
  }

  changed() { this.onChange(); }

  /* ---------- players ---------- */

  player(id) { return this.players.find(p => p.id === id) || null; }

  // A phone that lost its token can rejoin by typing the same name, as long as
  // that player isn't connected on another phone.
  join(rawName, token) {
    let p = token ? this.players.find(x => x.token === token) : null;
    if (p) return p;
    const name = String(rawName || '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (!name) throw new GameError('Type your name.');
    p = this.players.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (p && p.connected) throw new GameError(`${p.name} is already playing. Pick a different name.`);
    if (!p) {
      if (this.players.length >= MAX_PLAYERS) throw new GameError(`The game is full. ${MAX_PLAYERS} players is the limit.`);
      p = { id: 'p' + this.nextId++, name, score: 0, token: crypto.randomBytes(16).toString('hex'), connected: false };
      this.players.push(p);
      this.fx({ kind: 'join' });
    }
    this.changed();
    return p;
  }

  setConnected(id, on) {
    const p = this.player(id);
    if (!p || p.connected === on) return;
    p.connected = on;
    if (this.phase === 'end') this.maybeFinishVotes();
    this.changed();
  }

  remove(id) {
    const i = this.players.findIndex(p => p.id === id);
    if (i < 0) return;
    const wasTurn = this.phase === 'play' && i === this.turn;
    this.players.splice(i, 1);
    const n = this.players.length;
    if (!n) { this.toLobby(); return; }
    this.starter %= n;
    if (i < this.turn) this.turn--;
    this.turn %= n;
    if (this.phase === 'secret' && this.setterId === id) { this.useRandomWord(); return; }
    if (this.setterId === id) this.setterId = null;
    if (this.phase === 'play' && !this.guessers().length) { this.toLobby(); return; }
    if (wasTurn) {
      this.solving = false;
      this.turn = (i - 1 + n) % n;
      this.nextTurn();
      this.streak = 0;
      this.say(`${this.cur().name}’s turn.`);
      this.startTimer('turn', TURN_SECS);
    }
    if (this.phase === 'end') this.maybeFinishVotes();
    this.changed();
  }

  guessers() { return this.players.filter(p => p.id !== this.setterId); }
  multi() { return this.guessers().length > 1; }
  cur() { return this.players[this.turn]; }

  // Skip the secret setter, and anyone whose phone is off when someone else
  // is around to play.
  nextTurn() {
    const n = this.players.length;
    let fallback = -1;
    for (let k = 1; k <= n; k++) {
      const i = (this.turn + k) % n;
      const p = this.players[i];
      if (p.id === this.setterId) continue;
      if (p.connected) { this.turn = i; return; }
      if (fallback < 0) fallback = i;
    }
    if (fallback >= 0) this.turn = fallback;
  }

  isTurn(id) { return this.phase === 'play' && !!this.cur() && this.cur().id === id; }

  requireTurn(id) {
    if (this.phase !== 'play') throw new GameError('The round isn’t on right now.');
    if (!this.isTurn(id)) throw new GameError(`It’s ${this.cur().name}’s turn.`);
  }

  /* ---------- settings and rounds ---------- */

  updateSettings(s) {
    if (this.phase !== 'lobby') throw new GameError('Change settings from the lobby.');
    const next = { ...this.settings };
    if (s.themeId !== undefined) {
      if (!this.themes.get(s.themeId)) throw new GameError('That theme doesn’t exist any more.');
      if (s.themeId !== next.themeId) next.category = 'Anything';
      next.themeId = s.themeId;
    }
    if (s.category !== undefined) {
      const t = this.themes.get(next.themeId);
      if (s.category !== 'Anything' && !(t && t.categories.some(c => c.name === s.category))) throw new GameError('That category isn’t in this theme.');
      next.category = s.category;
    }
    if (s.mode !== undefined) { if (!['random', 'secret'].includes(s.mode)) throw new GameError('Unknown mode.'); next.mode = s.mode; }
    if (s.showtime !== undefined) next.showtime = !!s.showtime;
    if (s.timerOn !== undefined) next.timerOn = !!s.timerOn;
    if (s.target !== undefined) { if (!TARGETS.includes(+s.target)) throw new GameError('Unknown target.'); next.target = +s.target; }
    this.settings = next;
    this.changed();
  }

  // Theme deleted while selected: fall back to the first one.
  themeRemoved(id) {
    if (this.settings.themeId === id) {
      const first = this.themes.first();
      this.settings = { ...this.settings, themeId: first ? first.id : '', category: 'Anything' };
    }
    this.changed();
  }

  resetScores() {
    if (this.phase !== 'lobby') throw new GameError('Reset scores from the lobby.');
    this.players.forEach(p => { p.score = 0; });
    this.round = 0;
    this.starter = 0;
    this.leaderId = null;
    this.changed();
  }

  start() {
    if (this.phase !== 'lobby') throw new GameError('The game has already started.');
    if (!this.players.length) throw new GameError('Join on a phone first.');
    if (this.matchOver) this.players.forEach(p => { p.score = 0; });
    if (this.matchOver || this.players.every(p => !p.score)) { this.round = 0; this.starter = 0; }
    this.matchOver = false;
    this.leaderId = null;
    this.startRound();
  }

  toLobby() {
    this.stopTimer();
    this.solving = false;
    this.phase = 'lobby';
    this.end = null;
    this.champ = null;
    this.setterId = null;
    this.msg = '';
    this.changed();
  }

  newWord() {
    if (!['play', 'secret', 'end'].includes(this.phase)) throw new GameError('Start the game first.');
    this.startRound();
  }

  startRound() {
    this.stopTimer();
    this.solving = false;
    this.end = null;
    this.champ = null;
    this.setterId = null;
    const n = this.players.length;
    if (this.settings.mode === 'secret' && n >= 2) {
      const setter = this.players[this.setterTurn % n];
      this.setterTurn++;
      this.setterId = setter.id;
      this.phase = 'secret';
      this.msg = `${setter.name} is typing a secret phrase.`;
      this.changed();
      return;
    }
    const { word, hint } = this.pickWord();
    this.begin(word, hint);
  }

  pickWord() {
    const theme = this.themes.get(this.settings.themeId) || this.themes.first();
    if (!theme) throw new GameError('There are no themes. Upload one first.');
    const cats = theme.categories.filter(c => this.settings.category === 'Anything' || c.name === this.settings.category);
    const pool = [];
    (cats.length ? cats : theme.categories).forEach(c => c.phrases.forEach(w => pool.push([w, c.name])));
    let fresh = pool.filter(([w]) => !this.used.has(w));
    if (!fresh.length) { pool.forEach(([w]) => this.used.delete(w)); fresh = pool; }
    const [word, hint] = fresh[Math.floor(this.random() * fresh.length)];
    this.used.add(word);
    return { word, hint };
  }

  submitSecret(id, rawWord, rawHint) {
    if (this.phase !== 'secret') throw new GameError('Nobody is picking a secret phrase right now.');
    if (id !== this.setterId) throw new GameError('It’s someone else’s turn to pick.');
    const word = normalizePhrase(rawWord);
    const problem = phraseProblem(word);
    if (problem) throw new GameError(problem.charAt(0).toUpperCase() + problem.slice(1) + '.');
    const hint = String(rawHint || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    this.begin(word, hint);
  }

  useRandomWord() {
    if (this.phase !== 'secret') throw new GameError('Nobody is picking a secret phrase right now.');
    this.setterId = null;
    const { word, hint } = this.pickWord();
    this.begin(word, hint);
  }

  begin(word, hint) {
    this.word = word;
    this.hint = hint;
    this.guessed = new Set();
    this.misses = [];
    this.streak = 0;
    this.hot = false;
    this.solveBonus = 0;
    this.solving = false;
    this.round++;
    this.phase = 'play';
    const n = this.players.length;
    this.turn = (this.starter - 1 + n) % n;
    this.nextTurn();
    this.say(this.multi() ? `${this.cur().name}’s turn. Pick a letter.` : 'Pick a letter.');
    this.startTimer('turn', TURN_SECS);
    this.fx({ kind: 'round' });
    this.changed();
  }

  say(t, hot) { this.msg = t; this.hot = !!hot; }

  /* ---------- play ---------- */

  guess(id, raw) {
    this.requireTurn(id);
    if (this.solving) throw new GameError('Finish your solve first.');
    const L = String(raw || '').toUpperCase();
    if (!/^[A-Z]$/.test(L)) throw new GameError('Pick a letter.');
    if (this.guessed.has(L)) throw new GameError(`${L} has been picked already.`);
    this.guessed.add(L);
    const count = [...this.word].filter(c => c === L).length;
    const p = this.cur();
    if (!count) {
      this.misses.push(L);
      this.fx({ kind: 'miss', letter: L });
      this.missAndPass(`No ${L}.`);
      return;
    }
    this.streak++;
    const hot = this.streak >= 3;
    const pts = count * (hot ? 2 : 1);
    p.score += pts;
    this.fx({ kind: 'hit', letter: L, count, streak: this.streak });
    if (this.solved()) { this.finish(true); return; }
    const n = count === 1 ? 'one' : count;
    let t = `Yes, ${n} ${L}: +${pts}.`;
    if (hot) t = `On fire! ${n} ${L}, double points: +${pts}.`;
    else if (this.streak === 2) t += ' One more and you’re on fire.';
    this.say(this.multi() ? `${t} ${p.name} goes again.` : t, hot);
    this.checkLeader();
    this.startTimer('turn', TURN_SECS);
    this.changed();
  }

  missAndPass(prefix) {
    const wasHot = this.streak >= 3;
    this.streak = 0;
    this.solving = false;
    if (this.misses.length >= MAX_MISSES) { this.finish(false); return; }
    if (this.multi()) {
      this.nextTurn();
      this.say(`${prefix}${wasHot ? ' Streak over.' : ''} ${this.cur().name}’s turn.`);
    } else this.say(prefix);
    this.checkLeader();
    this.startTimer('turn', TURN_SECS);
    this.changed();
  }

  // From the TV, for a player who walked away with the timer off.
  skip() {
    if (this.phase !== 'play') throw new GameError('The round isn’t on right now.');
    if (!this.multi()) throw new GameError('There’s nobody to skip to.');
    const wasHot = this.streak >= 3;
    this.streak = 0;
    this.solving = false;
    const skipped = this.cur().name;
    this.nextTurn();
    this.say(`Skipped ${skipped}.${wasHot ? ' Streak over.' : ''} ${this.cur().name}’s turn.`);
    this.startTimer('turn', TURN_SECS);
    this.changed();
  }

  solveStart(id) {
    this.requireTurn(id);
    if (this.solving) return;
    this.solving = true;
    this.savedMs = this.timer && this.timer.mode === 'turn' ? Math.max(0, this.timer.endsAt - this.now()) : TURN_SECS * 1000;
    this.say(`${this.cur().name} is solving…`);
    this.startTimer('solve', SOLVE_SECS);
    this.changed();
  }

  solveCancel(id) {
    this.requireTurn(id);
    if (!this.solving) return;
    this.solving = false;
    this.say(this.multi() ? `${this.cur().name}’s turn. Pick a letter.` : 'Pick a letter.');
    this.startTimer('turn', Math.max(this.savedMs, 3000) / 1000);
    this.changed();
  }

  solve(id, answer) {
    this.requireTurn(id);
    if (!this.solving) throw new GameError('Tap Solve it first.');
    const ans = letters(normalizePhrase(answer));
    if (!ans) throw new GameError('Type the whole answer.');
    if (ans === letters(this.word)) {
      const hidden = [...this.word].filter(ch => /[A-Z]/.test(ch) && !this.guessed.has(ch)).length;
      this.solveBonus = hidden * 2;
      this.cur().score += this.solveBonus;
      [...this.word].forEach(ch => { if (/[A-Z]/.test(ch)) this.guessed.add(ch); });
      this.finish(true);
    } else {
      this.misses.push('?');
      this.fx({ kind: 'miss' });
      this.missAndPass('Not it! That costs a miss.');
    }
  }

  solved() { return [...this.word].every(ch => !/[A-Z]/.test(ch) || this.guessed.has(ch)); }

  finish(won) {
    this.stopTimer();
    this.solving = false;
    this.phase = 'end';
    const p = this.cur();
    const named = this.players.length > 1;
    if (won) {
      p.score += BONUS;
      this.say('Solved!');
      const left = MAX_MISSES - this.misses.length;
      this.end = {
        won: true, title: 'Solved!',
        text: named
          ? (this.solveBonus ? `${p.name} solved it outright: +${this.solveBonus + BONUS} points!` : `${p.name} finished it and gets ${BONUS} bonus points.`)
          : `You got it with ${left} ${left === 1 ? 'guess' : 'guesses'} to spare.`,
      };
      this.fx({ kind: 'win' });
    } else {
      this.say('Out of guesses.');
      this.end = { won: false, title: 'Out of guesses', text: 'The phrase was' };
      this.fx({ kind: 'lose' });
    }
    this.end.word = this.word;
    this.end.show = null;
    if (won && this.settings.showtime && this.voters(p.id).length) {
      this.end.show = { performerId: p.id, prompt: '', votes: {}, result: '', done: false };
      this.newPrompt();
    }
    this.checkLeader();
    this.starter = (this.starter + 1) % this.players.length;
    this.changed();
  }

  /* ---------- showtime ---------- */

  voters(performerId) { return this.players.filter(p => p.id !== performerId && p.connected); }

  newPrompt() {
    let i;
    do { i = Math.floor(this.random() * SHOW_PROMPTS.length); } while (i === this.lastPrompt && SHOW_PROMPTS.length > 1);
    this.lastPrompt = i;
    this.end.show.prompt = SHOW_PROMPTS[i](titleCase(this.word), this.hint || 'anything');
  }

  swap() {
    const s = this.end && this.end.show;
    if (this.phase !== 'end' || !s || s.done) throw new GameError('There’s no challenge to swap.');
    if (Object.keys(s.votes).length) throw new GameError('Voting has started. No swapping now.');
    this.newPrompt();
    this.changed();
  }

  vote(id, pts) {
    const s = this.end && this.end.show;
    if (this.phase !== 'end' || !s || s.done) throw new GameError('There’s nothing to vote on.');
    if (id === s.performerId) throw new GameError('No voting for yourself!');
    if (!this.player(id)) throw new GameError('Join the game to vote.');
    if (s.votes[id]) throw new GameError('You voted already.');
    pts = +pts;
    if (![1, 2, 3].includes(pts)) throw new GameError('Pick a vote.');
    s.votes[id] = pts;
    this.fx({ kind: 'vote' });
    this.maybeFinishVotes();
    this.changed();
  }

  maybeFinishVotes() {
    const s = this.end && this.end.show;
    if (!s || s.done) return;
    const voters = this.voters(s.performerId);
    if (voters.length && voters.every(p => s.votes[p.id])) this.finishVotes();
  }

  // The performer gets the average vote, rounded.
  finishVotes() {
    const s = this.end.show;
    s.done = true;
    const votes = Object.values(s.votes);
    const p = this.player(s.performerId);
    if (!votes.length || !p) { s.result = 'No votes this time.'; return; }
    const pts = Math.round(votes.reduce((a, b) => a + b, 0) / votes.length);
    p.score += pts;
    s.result = `${CLAPS[pts]} for ${p.name}! +${pts}`;
    s.pts = pts;
    this.fx({ kind: 'cheer', big: pts === 3 });
    this.checkLeader();
  }

  champion() {
    if (!this.settings.target || !this.players.length) return false;
    return Math.max(...this.players.map(p => p.score)) >= this.settings.target;
  }

  next() {
    if (this.phase !== 'end') throw new GameError('The round isn’t over yet.');
    if (this.end.show && !this.end.show.done) this.finishVotes();
    if (this.champion()) this.showChampion();
    else this.startRound();
  }

  showChampion() {
    const ranked = [...this.players].sort((a, b) => b.score - a.score);
    const ties = ranked.filter(p => p.score === ranked[0].score);
    this.champ = {
      title: ties.length > 1 ? `It’s a tie: ${ties.map(p => p.name).join(' and ')}!` : `${ranked[0].name} wins!`,
      rows: ranked.map(p => ({ name: p.name, score: p.score })),
    };
    this.matchOver = true;
    this.phase = 'champ';
    this.fx({ kind: 'champ' });
    this.changed();
  }

  rematch() {
    if (this.phase !== 'champ') throw new GameError('The match isn’t over yet.');
    this.players.forEach(p => { p.score = 0; });
    this.matchOver = false;
    this.leaderId = null;
    this.round = 0;
    this.starter = 0;
    this.startRound();
  }

  checkLeader() {
    if (this.players.length < 2) return;
    const top = Math.max(...this.players.map(p => p.score));
    const leaders = this.players.filter(p => p.score === top && top > 0);
    if (leaders.length === 1 && leaders[0].id !== this.leaderId) {
      this.leaderId = leaders[0].id;
      this.msg += ` ${leaders[0].name} takes the lead!`;
      this.fx({ kind: 'lead' });
    }
  }

  /* ---------- shot clock ---------- */

  startTimer(mode, secs) {
    this.stopTimer();
    if (!this.settings.timerOn || this.phase !== 'play') return;
    const ms = Math.round(secs * 1000);
    this.timer = { mode, total: mode === 'solve' ? SOLVE_SECS * 1000 : TURN_SECS * 1000, endsAt: this.now() + ms };
    this.handle = this.setTimer(() => { this.handle = null; this.expire(); }, ms);
  }

  stopTimer() {
    if (this.handle) this.clearTimer(this.handle);
    this.handle = null;
    this.timer = null;
  }

  expire() {
    if (!this.timer || this.phase !== 'play') return;
    const mode = this.timer.mode;
    this.timer = null;
    this.fx({ kind: 'timeout' });
    if (mode === 'solve') {
      this.misses.push('?');
      this.missAndPass('Time’s up on the solve! That costs a miss.');
    } else if (this.multi()) {
      const wasHot = this.streak >= 3;
      this.streak = 0;
      this.nextTurn();
      this.say(`Time’s up!${wasHot ? ' Streak over.' : ''} ${this.cur().name}’s turn.`);
      this.checkLeader();
      this.startTimer('turn', TURN_SECS);
      this.changed();
    } else {
      this.misses.push('⏱');
      this.missAndPass('Time’s up! That costs a miss.');
    }
  }

  /* ---------- what the screens see ---------- */

  view() {
    const playing = this.phase === 'play';
    const show = this.end && this.end.show;
    const top = this.players.length ? Math.max(...this.players.map(p => p.score)) : 0;
    const leaders = top > 0 ? this.players.filter(p => p.score === top).map(p => p.id) : [];
    const theme = this.themes.get(this.settings.themeId);
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      settings: this.settings,
      themeName: theme ? theme.name : '',
      players: this.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected })),
      leaders: this.players.length > 1 ? leaders : [],
      turnId: playing && this.cur() ? this.cur().id : null,
      setterId: this.setterId,
      setterName: this.setterId ? (this.player(this.setterId) || {}).name : null,
      multi: this.multi(),
      word: this.phase === 'play' || this.phase === 'end'
        ? [...this.word].map(ch => !/[A-Z]/.test(ch) || this.guessed.has(ch) || this.phase === 'end' ? ch : '_').join('')
        : '',
      revealed: this.phase === 'end' ? [...this.word].map(ch => !/[A-Z]/.test(ch) || this.guessed.has(ch)) : null,
      hint: this.phase === 'play' || this.phase === 'end' ? this.hint : '',
      hits: [...this.guessed].filter(l => this.word.includes(l)).join(''),
      misses: this.misses,
      left: MAX_MISSES - this.misses.length,
      maxMisses: MAX_MISSES,
      msg: this.msg,
      hot: this.hot,
      fire: playing && this.streak >= 3,
      solving: this.solving,
      timer: this.timer ? { mode: this.timer.mode, total: this.timer.total, remaining: Math.max(0, this.timer.endsAt - this.now()) } : null,
      end: this.phase === 'end' && this.end ? {
        won: this.end.won, title: this.end.title, text: this.end.text, word: this.end.word,
        champion: this.champion(),
        show: show ? {
          performerId: show.performerId,
          performerName: (this.player(show.performerId) || {}).name || '',
          prompt: show.prompt, result: show.result, done: show.done,
          voted: Object.keys(show.votes),
          voters: this.voters(show.performerId).map(p => p.id),
        } : null,
      } : null,
      champ: this.phase === 'champ' ? this.champ : null,
    };
  }
}

module.exports = { Game, GameError, makeCode, MAX_MISSES, BONUS, TURN_SECS, SOLVE_SECS, MAX_PLAYERS };

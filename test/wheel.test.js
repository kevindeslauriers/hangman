'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Wheel, WheelError, layout, wedges } = require('../lib/wheel');

function themesWith(phrases) {
  const theme = { id: 't', name: 'T', categories: [{ name: 'Things', phrases }] };
  return { list: () => [{ id: 't' }], get: () => theme };
}

// random() feeds: puzzle pick, then spin wedge index, then offset.
function setup({ phrases = ['HOT DOG STAND'], players = ['Ann', 'Ben'], settings = {}, rand } = {}) {
  let now = 0;
  const timers = [];
  const fx = [];
  const seq = rand ? [...rand] : [];
  const g = new Wheel({
    themes: themesWith(phrases), code: 'ABCD', fx: f => fx.push(f),
    random: () => (seq.length ? seq.shift() : 0),
    now: () => now,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  const ps = players.map(n => { const p = g.join(n); g.setConnected(p.id, true); return p; });
  g.updateSettings({ tossups: false, ...settings });
  const advance = ms => { now += ms; timers.filter(t => t.at <= now).sort((a, b) => a.at - b.at).forEach(t => { const i = timers.indexOf(t); if (i >= 0) { timers.splice(i, 1); t.fn(); } }); };
  // Make the next spin land on wedge i.
  const spinTo = (id, i) => { seq.push(i / 24, 0.5); g.doSpin(id, 0.5); advance(10000); };
  return { g, ps, fx, advance, spinTo, seq };
}

test('puzzles are laid out on the 12/14/14/12 board, centred, whole words per row', () => {
  const g = layout('HOT DOG STAND');
  assert.equal(g.length, 4);
  assert.equal(g[1].join(''), 'HOT.DOG.STAND.');
  assert.equal(g[0].join(''), '#............#');
  const two = layout('CHARLIE AND THE CHOCOLATE FACTORY');
  assert.ok(two, 'fits');
  assert.equal(layout('SUPERCALIFRAGILISTICEXPIALIDOCIOUS'), null);
  assert.equal(wedges(1).length, 24);
});

test('spin, call a consonant, money per letter; a miss passes the turn', () => {
  const { g, ps, spinTo } = setup();
  g.start();
  assert.equal(g.phase, 'turn');
  assert.equal(g.cur().id, ps[0].id);
  spinTo(ps[0].id, 1);                  // $600
  assert.equal(g.phase, 'consonant');
  g.callConsonant(ps[0].id, 't');       // HOT DOG STAND has two T's
  assert.equal(ps[0].bank, 1200);
  assert.equal(g.view().board[1].includes('T'), true);
  spinTo(ps[0].id, 3);                  // $300
  g.callConsonant(ps[0].id, 'Z');
  assert.equal(g.cur().id, ps[1].id);
  assert.throws(() => g.callConsonant(ps[1].id, 'T'), WheelError);
});

test('Bankrupt wipes the round money; Lose a Turn passes', () => {
  const { g, ps, spinTo } = setup();
  g.start();
  spinTo(ps[0].id, 1);
  g.callConsonant(ps[0].id, 'D');
  assert.ok(ps[0].bank > 0);
  spinTo(ps[0].id, 4);                  // BANKRUPT
  assert.equal(ps[0].bank, 0);
  assert.equal(g.cur().id, ps[1].id);
  spinTo(ps[1].id, 11);                 // LOSE A TURN
  assert.equal(g.cur().id, ps[0].id);
});

test('vowels cost $250; solving banks the round money with a $1,000 minimum', () => {
  const { g, ps, spinTo } = setup();
  g.start();
  assert.throws(() => g.buyVowel(ps[0].id), /costs/);
  spinTo(ps[0].id, 1);
  g.callConsonant(ps[0].id, 'S');      // $600
  g.buyVowel(ps[0].id);
  g.callVowel(ps[0].id, 'O');
  assert.equal(ps[0].bank, 350);
  g.solveStart(ps[0].id);
  g.solve(ps[0].id, 'hot dog stand!');
  assert.equal(g.phase, 'roundEnd');
  assert.equal(ps[0].score, 1000);
  assert.equal(ps[0].bank, 0);
});

test('a wrong solve passes the turn and the hidden puzzle never reaches the screens', () => {
  const { g, ps } = setup();
  g.start();
  assert.ok(!JSON.stringify(g.view()).includes('STAND'));
  g.solveStart(ps[0].id);
  g.solve(ps[0].id, 'hot dog stall');
  assert.equal(g.cur().id, ps[1].id);
});

test('the turn clock passes the turn', () => {
  const { g, ps, advance } = setup();
  g.start();
  advance(15000);
  assert.equal(g.cur().id, ps[1].id);
});

test('toss-up: letters appear, a wrong buzz locks you out, a right one wins and starts', () => {
  const { g, ps, advance } = setup({ settings: { tossups: true } });
  g.start();
  assert.equal(g.phase, 'tossup');
  advance(1100);
  assert.equal(g.view().board.join('').replace(/[^A-Z]/g, '').length, 1);
  g.buzzToss(ps[0].id);
  g.solveToss(ps[0].id, 'nope');
  assert.throws(() => g.buzzToss(ps[0].id), /already/);
  advance(1100);
  g.buzzToss(ps[1].id);
  g.solveToss(ps[1].id, 'Hot Dog Stand');
  assert.equal(g.phase, 'tossDone');
  assert.equal(ps[1].score, 1000);
  advance(4000);
  assert.equal(g.phase, 'turn');
  assert.equal(g.cur().id, ps[1].id);
});

test('bonus round: R S T L N E given, 3 + 1 picked, 10 seconds to solve', () => {
  const { g, ps, advance } = setup({ settings: { rounds: 2 }, phrases: ['HOT DOG STAND', 'BIG MAC', 'PANCAKE'] });
  g.start();
  for (let r = 0; r < 2; r++) { g.solveStart(g.cur().id); g.solve(g.cur().id, g.puzzle.text); g.next(); }
  assert.equal(g.phase, 'bonusPick');
  assert.ok(g.view().used.includes('R'));
  assert.throws(() => g.bonusPick(g.bonus.playerId, 'BCDE'), /3 new consonants/);
  g.bonusPick(g.bonus.playerId, 'BCDA');
  advance(2000);
  assert.ok(g.timer && g.timer.total === 10000);
  assert.throws(() => g.bonusGuess(g.bonus.playerId, 'wrong'), /Keep trying/);
  g.bonusGuess(g.bonus.playerId, g.puzzle.text);
  assert.equal(g.phase, 'bonusDone');
  assert.equal(g.bonus.won, true);
  g.finish();
  assert.equal(g.phase, 'champ');
});

test('the Game Night theme has plenty of puzzles that fit', () => {
  const path = require('path');
  const { ThemeStore } = require('../lib/themes');
  const g = new Wheel({ themes: new ThemeStore({ dir: path.join(__dirname, '..', 'themes') }), code: 'X' });
  assert.ok(g.allPuzzles().length > 1000, `${g.allPuzzles().length} puzzles`);
});

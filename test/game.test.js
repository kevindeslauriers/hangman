'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game, GameError } = require('../lib/game');

function setup({ words = ['BANANA SPLIT'], settings = {}, players = ['Ann', 'Ben'] } = {}) {
  const theme = { id: 't', name: 'Test', builtin: true, categories: [{ name: 'Food', phrases: words }] };
  const themes = { get: id => (id === 't' ? theme : null), first: () => theme };
  let now = 0;
  const timers = [];
  const fx = [];
  const g = new Game({
    themes, fx: f => fx.push(f), code: 'ABCD', random: () => 0,
    now: () => now,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  const ps = players.map(n => { const p = g.join(n); g.setConnected(p.id, true); return p; });
  g.updateSettings(settings);
  const advance = ms => {
    now += ms;
    timers.filter(t => t.at <= now).forEach(t => { timers.splice(timers.indexOf(t), 1); t.fn(); });
  };
  return { g, ps, fx, advance };
}

test('right letters score per spot, and the turn stays', () => {
  const { g, ps } = setup();
  g.start();
  assert.equal(g.cur().id, ps[0].id);
  g.guess(ps[0].id, 'a');
  assert.equal(ps[0].score, 3);
  assert.equal(g.cur().id, ps[0].id);
  assert.match(g.msg, /Yes, 3 A: \+3\. Ann goes again\./);
});

test('a miss passes the turn and draws a part', () => {
  const { g, ps } = setup();
  g.start();
  g.guess(ps[0].id, 'Z');
  assert.equal(g.cur().id, ps[1].id);
  assert.deepEqual(g.misses, ['Z']);
  assert.throws(() => g.guess(ps[0].id, 'B'), GameError);
});

test('three in a row puts you on fire for double points', () => {
  const { g, ps } = setup();
  g.start();
  g.guess(ps[0].id, 'B'); // 1
  g.guess(ps[0].id, 'N'); // 2
  g.guess(ps[0].id, 'S'); // on fire: 1 * 2
  assert.equal(ps[0].score, 1 + 2 + 2);
  assert.ok(g.view().fire);
});

test('finishing the phrase gives the bonus and ends the round', () => {
  const { g, ps } = setup({ words: ['AB'], settings: { showtime: false } });
  g.start();
  g.guess(ps[0].id, 'A');
  g.guess(ps[0].id, 'B');
  assert.equal(g.phase, 'end');
  assert.equal(ps[0].score, 1 + 1 + 3);
  assert.equal(g.view().end.word, 'AB');
});

test('solving pays 2 per hidden letter plus the bonus; wrong costs a miss', () => {
  const { g, ps } = setup({ settings: { showtime: false } });
  g.start();
  g.solveStart(ps[0].id);
  g.solve(ps[0].id, 'banana spit');
  assert.deepEqual(g.misses, ['?']);
  assert.equal(g.cur().id, ps[1].id);
  g.solveStart(ps[1].id);
  g.solve(ps[1].id, 'Banana split!');
  assert.equal(ps[1].score, 11 * 2 + 3);
  assert.equal(g.phase, 'end');
});

test('the shot clock passes the turn, and a slow solve costs a miss', () => {
  const { g, ps, advance } = setup();
  g.start();
  advance(15000);
  assert.equal(g.cur().id, ps[1].id);
  assert.equal(g.misses.length, 0);
  g.solveStart(ps[1].id);
  advance(20000);
  assert.deepEqual(g.misses, ['?']);
  assert.equal(g.cur().id, ps[0].id);
});

test('six misses loses the round and reveals the phrase', () => {
  const { g, ps } = setup({ players: ['Solo'] });
  g.start();
  for (const L of 'QWXYZV') g.guess(ps[0].id, L);
  assert.equal(g.phase, 'end');
  assert.equal(g.view().end.won, false);
  assert.equal(g.view().word, 'BANANA SPLIT');
});

test('the hidden phrase never reaches the screens mid-round', () => {
  const { g, ps } = setup();
  g.start();
  g.guess(ps[0].id, 'A');
  const v = JSON.stringify(g.view());
  assert.ok(!v.includes('BANANA'));
  assert.equal(g.view().word, '_A_A_A _____');
});

test('showtime votes average out and go to the performer', () => {
  const { g, ps } = setup({ words: ['AB'], players: ['Ann', 'Ben', 'Cat'] });
  g.start();
  g.guess(ps[0].id, 'A');
  g.guess(ps[0].id, 'B');
  const before = ps[0].score;
  assert.throws(() => g.vote(ps[0].id, 3), GameError);
  g.vote(ps[1].id, 3);
  assert.equal(g.end.show.done, false);
  g.vote(ps[2].id, 2);
  assert.equal(g.end.show.done, true);
  assert.equal(ps[0].score, before + 3);
});

test('reaching the target crowns a champion, rematch resets', () => {
  const { g, ps } = setup({ words: ['AB'], settings: { target: 30, showtime: false } });
  g.start();
  ps[0].score = 40;
  g.guess(ps[0].id, 'A'); g.guess(ps[0].id, 'B');
  g.next();
  assert.equal(g.phase, 'champ');
  assert.equal(g.champ.title, 'Ann wins!');
  g.rematch();
  assert.equal(ps[0].score, 0);
  assert.equal(g.phase, 'play');
});

test('secret mode: the setter types, sits out, and the turns skip them', () => {
  const { g, ps } = setup({ settings: { mode: 'secret' }, players: ['Ann', 'Ben', 'Cat'] });
  g.start();
  assert.equal(g.phase, 'secret');
  assert.equal(g.setterId, ps[0].id);
  assert.throws(() => g.submitSecret(ps[1].id, 'HELLO'), GameError);
  assert.throws(() => g.submitSecret(ps[0].id, 'R2D2'), GameError);
  g.submitSecret(ps[0].id, 'hello there', 'Greeting');
  assert.equal(g.phase, 'play');
  assert.equal(g.hint, 'Greeting');
  assert.notEqual(g.cur().id, ps[0].id);
  g.guess(g.cur().id, 'Z');
  assert.notEqual(g.cur().id, ps[0].id);
  g.guess(g.cur().id, 'Q');
  assert.notEqual(g.cur().id, ps[0].id);
});

test('joining: names are unique, a dropped phone can rejoin by name', () => {
  const { g, ps } = setup();
  assert.throws(() => g.join('ann'), GameError);
  g.setConnected(ps[0].id, false);
  assert.equal(g.join('ANN').id, ps[0].id);
  assert.equal(g.join('', ps[1].token).id, ps[1].id);
});

test('removing the current player hands the turn on', () => {
  const { g, ps } = setup({ players: ['Ann', 'Ben', 'Cat'] });
  g.start();
  g.remove(ps[0].id);
  assert.equal(g.cur().id, ps[1].id);
  assert.equal(g.phase, 'play');
});

test('disconnected players are skipped when someone else can play', () => {
  const { g, ps } = setup({ players: ['Ann', 'Ben', 'Cat'] });
  g.setConnected(ps[1].id, false);
  g.start();
  g.guess(ps[0].id, 'Z');
  assert.equal(g.cur().id, ps[2].id);
});

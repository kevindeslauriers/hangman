'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Quiz, QuizError, ClueStore, parseClues, stripQuestion } = require('../lib/quiz');
const { matchAnswer } = require('../lib/survey');

const CLUES = new ClueStore({ dir: path.join(__dirname, '..', 'clues') });

function setup({ players = ['Ann', 'Ben'], settings = {} } = {}) {
  let now = 0;
  const timers = [];
  const g = new Quiz({
    clues: CLUES, code: 'ABCD', random: () => 0.01,
    now: () => now,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  const ps = players.map(n => { const p = g.join(n); g.setConnected(p.id, true); return p; });
  g.updateSettings(settings);
  const advance = ms => { now += ms; timers.filter(t => t.at <= now).sort((a, b) => a.at - b.at).forEach(t => { const i = timers.indexOf(t); if (i >= 0) { timers.splice(i, 1); t.fn(); } }); };
  // Pick a clue that isn't a Daily Double.
  const plain = () => { for (let c = 0; c < 6; c++) for (let r = 0; r < 5; r++) if (!g.taken.has(`${c},${r}`) && !g.round().dd.has(`${c},${r}`)) return [c, r]; };
  return { g, ps, advance, plain };
}

test('every clue file parses, with enough categories and finals, and answers match themselves', () => {
  const dir = path.join(__dirname, '..', 'clues');
  let cats = 0, finals = 0;
  const names = new Set();
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.txt'))) {
    const r = parseClues(fs.readFileSync(path.join(dir, f), 'utf8'), f);
    r.cats.forEach(c => {
      assert.ok(!names.has(c.name), `category twice: ${c.name}`);
      names.add(c.name);
      const answers = c.clues.map(x => x.a);
      assert.equal(new Set(answers).size, 5, `${c.name} has a repeated answer`);
      c.clues.forEach(x => x.keys.forEach(k => assert.equal(matchAnswer(k, [{ keys: x.keys }]), 0)));
    });
    cats += r.cats.length; finals += r.finals.length;
  }
  assert.ok(cats >= 60, `${cats} categories`);
  assert.ok(finals >= 16, `${finals} finals`);
  // At least two full games of each difficulty before categories repeat.
  for (const d of ['standard', 'easy']) assert.ok(CLUES.cats.filter(c => c.difficulty === d).length >= 24, d);
});

test('no "What is" needed, but it is fine to say it', () => {
  assert.equal(stripQuestion('What is a cow?'), 'a cow?');
  assert.equal(stripQuestion("Who's Batman"), 'Batman');
  assert.equal(stripQuestion('Toronto'), 'Toronto');
});

test('pick, wait for the reading, buzz, answer right: points and control', () => {
  const { g, ps, advance, plain } = setup({ settings: { choices: false } });
  g.start();
  const picker = g.controlId;
  const [c, r] = plain();
  g.choose(picker, c, r);
  assert.equal(g.phase, 'reading');
  assert.throws(() => g.buzz(ps[1].id), /Wait for the host/);
  advance(10000);
  assert.equal(g.phase, 'open');
  g.buzz(ps[1].id);
  g.answer(ps[1].id, `what is ${g.clue.a.toLowerCase()}`);
  assert.equal(ps[1].score, (r + 1) * 200);
  assert.equal(g.controlId, ps[1].id);
  assert.equal(g.phase, 'reveal');
  advance(4000);
  assert.equal(g.phase, 'board');
});

test('a wrong answer lets the others buzz; no penalty unless it is turned on', () => {
  const { g, ps, advance, plain } = setup({ settings: { choices: false } });
  g.start();
  g.choose(g.controlId, ...plain());
  advance(10000);
  g.buzz(ps[0].id);
  g.answer(ps[0].id, 'banana hammock');
  assert.equal(ps[0].score, 0);
  assert.equal(g.phase, 'open');
  assert.throws(() => g.buzz(ps[0].id), /already/);
  g.buzz(ps[1].id);
  g.answer(ps[1].id, 'nope');
  assert.equal(g.phase, 'reveal', 'everyone tried, so the answer is shown');
});

test('multiple choice: choices come from the category, and a decoy never counts', () => {
  const { g, ps, advance, plain } = setup({ settings: { choices: true } });
  g.start();
  g.choose(g.controlId, ...plain());
  advance(10000);
  g.buzz(ps[0].id);
  const v = g.view();
  assert.equal(v.clue.choices.length, 4);
  assert.ok(v.clue.choices.includes(g.clue.a));
  const wrong = v.clue.choices.find(x => x !== g.clue.a);
  g.answer(ps[0].id, wrong);
  assert.equal(g.tried.has(ps[0].id), true);
});

test('nobody buzzes: time runs out and the answer is shown', () => {
  const { g, advance, plain } = setup();
  g.start();
  g.choose(g.controlId, ...plain());
  advance(10000);
  advance(8000);
  assert.equal(g.phase, 'reveal');
  assert.ok(g.view().clue.a);
});

test('Daily Double: the picker wagers and answers alone', () => {
  const { g, ps } = setup({ settings: { choices: false } });
  g.start();
  const [dd] = [...g.round().dd];
  const [c, r] = dd.split(',').map(Number);
  const picker = g.player(g.controlId);
  g.choose(picker.id, c, r);
  assert.equal(g.phase, 'ddWager');
  assert.throws(() => g.ddWager(picker.id, 999999), QuizError);
  g.ddWager(picker.id, 500);
  g.ddAnswer(picker.id, g.clue.a);
  assert.equal(picker.score, 500);
});

test('the whole game: double round, then the final with wagers', () => {
  const { g, ps, advance } = setup({ settings: { choices: false } });
  g.start();
  for (let round = 0; round < 2; round++) {
    g.endRound();
    advance(6000);
  }
  assert.equal(g.phase, 'finalWager');
  ps[0].score = 1000;
  assert.throws(() => g.finalWager(ps[0].id, 5000), QuizError);
  g.finalWager(ps[0].id, 600);
  g.finalWager(ps[1].id, 0);
  assert.equal(g.phase, 'finalClue');
  g.finalAnswer(ps[0].id, g.final.a);
  g.finalAnswer(ps[1].id, 'no idea');
  assert.equal(g.phase, 'finalReveal');
  advance(2000); advance(4000); advance(4000);
  assert.equal(g.phase, 'champ');
  assert.equal(ps[0].score, 1600);
  assert.equal(g.champ.title, 'Ann wins!');
});

test('challenging clues by default; easy ones when picked', () => {
  const { g } = setup();
  g.start();
  assert.ok(g.round().cats.every(c => c.difficulty === 'standard'));
  assert.equal(g.settings.choices, false);
  const e = setup({ settings: { difficulty: 'easy' } }).g;
  e.start();
  assert.ok(e.round().cats.every(c => c.difficulty === 'easy'));
});

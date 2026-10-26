'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Feud, FeudError } = require('../lib/feud');
const { parseSurveys, matchAnswer, normalize, SurveyError } = require('../lib/survey');

const SURVEY = parseSurveys(`
? Name a pet
DOG 40 / PUPPY / DOGGY
CAT 30 / KITTEN / KITTY
FISH 12 / GOLDFISH
HAMSTER 8
BIRD 5 / PARROT / BUDGIE
`);

function setup({ players = ['Ann', 'Ben'], settings = {} } = {}) {
  let now = 0;
  const timers = [];
  const fx = [];
  const g = new Feud({
    surveys: { questions: SURVEY }, code: 'ABCD', fx: f => fx.push(f), random: () => 0,
    now: () => now,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  const ps = players.map(n => { const p = g.join(n); g.setConnected(p.id, true); return p; });
  g.updateSettings(settings);
  const advance = ms => { now += ms; timers.filter(t => t.at <= now).forEach(t => { timers.splice(timers.indexOf(t), 1); t.fn(); }); };
  return { g, ps, fx, advance };
}

test('answers match plurals, articles, typos and other ways to say it', () => {
  const a = SURVEY[0].answers;
  assert.equal(matchAnswer('dogs', a), 0);
  assert.equal(matchAnswer('a puppy', a), 0);
  assert.equal(matchAnswer('Kittens!', a), 1);
  assert.equal(matchAnswer('hamstr', a), 3);
  assert.equal(matchAnswer('my pet goldfish', a), 2);
  assert.equal(matchAnswer('snake', a), -1);
  assert.equal(normalize('The Puppies'), 'PUPPY');
});

test('survey files are checked for points and order', () => {
  assert.throws(() => parseSurveys('? Q\nA 10\nB 20\nC 5\n'), SurveyError);
  assert.throws(() => parseSurveys('? Q\nA 60\nB 30\nC 20\n'), SurveyError);
  assert.throws(() => parseSurveys('? Q\nA 60\nB 30\n'), SurveyError);
  assert.throws(() => parseSurveys('DOG 5\n'), SurveyError);
});

test('every survey in surveys/ is valid, with enough questions to play', () => {
  const dir = path.join(__dirname, '..', 'surveys');
  let n = 0;
  const seen = new Set();
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.txt'))) {
    for (const q of parseSurveys(fs.readFileSync(path.join(dir, f), 'utf8'), f)) {
      assert.ok(!seen.has(q.text), `asked twice: ${q.text}`);
      seen.add(q.text);
      // Each answer must match itself, and its aliases mustn't land on another answer.
      q.answers.forEach((a, i) => a.keys.forEach(k => assert.equal(matchAnswer(k, q.answers), i, `${q.text}: "${k}" matches the wrong answer`)));
      n++;
    }
  }
  assert.ok(n >= 50, `only ${n} questions`);
});

test('face-off: the top answer wins control straight away', () => {
  const { g, ps } = setup();
  g.start();
  assert.equal(g.phase, 'faceoff');
  g.buzz(ps[1].id);
  assert.throws(() => g.faceoffAnswer(ps[0].id, 'dog'), FeudError);
  g.faceoffAnswer(ps[1].id, 'Dog');
  assert.equal(g.phase, 'decide');
  assert.equal(g.controlId, ps[1].id);
  assert.equal(g.bank, 40);
});

test('face-off: a better second answer wins; both missing reopens the buzzer', () => {
  const { g, ps } = setup();
  g.start();
  g.buzz(ps[0].id);
  g.buzz(ps[1].id);
  g.faceoffAnswer(ps[0].id, 'snake');
  g.faceoffAnswer(ps[1].id, 'lizard');
  assert.equal(g.phase, 'faceoff');
  assert.equal(g.faceoff.open, true);
  g.buzz(ps[0].id);
  g.faceoffAnswer(ps[0].id, 'fish');
  assert.equal(g.faceoff.answering, null, 'waits for a second buzz');
  g.buzz(ps[1].id);
  g.faceoffAnswer(ps[1].id, 'cat');
  assert.equal(g.controlId, ps[1].id);
});

test('play, three strikes, and a successful steal', () => {
  const { g, ps } = setup({ players: ['Ann', 'Ben', 'Cat'] });
  g.start();
  g.buzz(ps[0].id);
  g.faceoffAnswer(ps[0].id, 'dog');
  g.decide(ps[0].id, 'play');
  g.answer(ps[0].id, 'cats');
  assert.throws(() => g.answer(ps[0].id, 'kitty'), /already on the board/);
  g.answer(ps[0].id, 'snake');
  g.answer(ps[0].id, 'horse');
  g.answer(ps[0].id, 'lizard');
  assert.equal(g.phase, 'steal');
  assert.equal(g.bank, 70);
  g.stealAnswer(ps[1].id, 'rock');
  g.stealAnswer(ps[2].id, 'parrot');
  assert.equal(g.phase, 'reveal');
  assert.equal(ps[2].score, 75);
  assert.equal(ps[0].score, 0);
  assert.equal(g.view().board[3].text, 'HAMSTER', 'reveal shows the whole board');
});

test('a failed steal leaves the points with the family in control', () => {
  const { g, ps, advance } = setup();
  g.start();
  g.buzz(ps[0].id);
  g.faceoffAnswer(ps[0].id, 'dog');
  g.decide(ps[0].id, 'play');
  advance(20000); advance(20000); advance(20000);
  assert.equal(g.phase, 'steal');
  g.stealAnswer(ps[1].id, 'rock');
  assert.equal(ps[0].score, 40);
  assert.equal(g.result.how, 'nosteal');
});

test('the TV can make a missed answer count', () => {
  const { g, ps } = setup();
  g.start();
  g.buzz(ps[0].id);
  g.faceoffAnswer(ps[0].id, 'dog');
  g.decide(ps[0].id, 'play');
  g.answer(ps[0].id, 'mouse');
  assert.equal(g.strikes, 1);
  g.override(3);
  assert.equal(g.strikes, 0);
  assert.equal(g.bank, 48);
});

test('clearing the board wins it; later rounds are doubled and tripled', () => {
  const { g, ps } = setup();
  g.start();
  g.buzz(ps[0].id);
  g.faceoffAnswer(ps[0].id, 'dog');
  g.decide(ps[0].id, 'pass');
  assert.equal(g.controlId, ps[1].id);
  for (const a of ['cat', 'fish', 'hamster', 'bird']) g.answer(ps[1].id, a);
  assert.equal(ps[1].score, 95);
  assert.equal(g.multiplier(2), 1);
  assert.equal(g.multiplier(3), 2);
  assert.equal(g.multiplier(4), 3);
});

test('reaching the target goes to Fast Money: no repeats, 200 to win', () => {
  const { g, ps, advance } = setup({ settings: { target: 200 } });
  g.start();
  ps[0].score = 300;
  g.buzz(ps[0].id);
  g.faceoffAnswer(ps[0].id, 'dog');
  g.decide(ps[0].id, 'play');
  for (const a of ['cat', 'fish', 'hamster', 'bird']) g.answer(ps[0].id, a);
  g.next();
  assert.equal(g.phase, 'fastReady');
  assert.deepEqual(g.fast.ids, [ps[0].id, ps[1].id]);
  g.fastGo();
  for (let i = 0; i < 5; i++) g.fastAnswer(ps[0].id, 'dog');
  assert.equal(g.phase, 'fastHalf');
  assert.equal(g.fast.total, 200);
  g.fastNext();
  g.fastGo();
  assert.throws(() => g.fastAnswer(ps[1].id, 'puppy'), /Already said/);
  g.fastAnswer(ps[1].id, 'cat');
  advance(25000);
  assert.equal(g.phase, 'fastDone');
  assert.equal(g.fast.total, 230);
  g.finish();
  assert.equal(g.champ.won, true);
});

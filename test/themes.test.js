'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseTheme, ThemeStore, ThemeError } = require('../lib/themes');

test('parses headings, categories and phrases', () => {
  const t = parseTheme('# Theme: Food\n## Fruit\napple\nkiwi fruit\n\n## Spicy\njalapeño\n// a note\n', 'x.txt');
  assert.equal(t.name, 'Food');
  assert.deepEqual(t.categories.map(c => c.name), ['Fruit', 'Spicy']);
  assert.deepEqual(t.categories[0].phrases, ['APPLE', 'KIWI FRUIT']);
  assert.deepEqual(t.categories[1].phrases, ['JALAPENO']);
  assert.deepEqual(t.warnings, []);
});

test('phrases with no heading use the theme name as the hint', () => {
  const t = parseTheme('Polar bear\nRed panda', 'Animals.txt');
  assert.equal(t.name, 'Animals');
  assert.equal(t.categories[0].name, 'Animals');
  assert.equal(t.categories[0].phrases.length, 2);
});

test('bad lines are skipped with a warning, duplicates dropped', () => {
  const t = parseTheme('## A\nR2-D2\nNEW YEAR’S EVE\nnew year\'s eve\nX\n', 'a.txt');
  assert.deepEqual(t.categories[0].phrases, ["NEW YEAR'S EVE"]);
  assert.equal(t.warnings.length, 2);
  assert.match(t.warnings[0], /Line 2/);
});

test('a file with no phrases is refused', () => {
  assert.throws(() => parseTheme('# Empty\n## Nothing\n', 'e.txt'), ThemeError);
});

// Every file in themes/ must parse with no skipped lines, so a typo in a
// theme fails the tests instead of quietly dropping a phrase. A phrase
// listed under two categories would only ever show one hint, so that fails too.
test('every theme in themes/ parses cleanly, with no repeated phrases', () => {
  const dir = path.join(__dirname, '..', 'themes');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt'));
  assert.ok(files.length >= 1);
  const names = new Set();
  for (const f of files) {
    const t = parseTheme(fs.readFileSync(path.join(dir, f), 'utf8'), f);
    assert.deepEqual(t.warnings, [], f);
    assert.ok(!names.has(t.name.toLowerCase()), `two themes are called ${t.name}`);
    names.add(t.name.toLowerCase());
    const seen = new Map();
    t.categories.forEach(c => c.phrases.forEach(p => {
      assert.ok(!seen.has(p), `${f}: ${p} is under both ${seen.get(p)} and ${c.name}`);
      seen.set(p, c.name);
    }));
  }
});

test('the store loads the themes folder', () => {
  const store = new ThemeStore({ dir: path.join(__dirname, '..', 'themes') });
  const t = store.get('game-night');
  assert.equal(t.name, 'Game Night');
  assert.ok(t.categories.length >= 30);
  assert.ok(store.list().find(x => x.id === 'game-night').count >= 1000);
  assert.equal(store.first().id, 'game-night');
});

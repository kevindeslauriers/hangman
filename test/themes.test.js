'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
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

test('the built-in and sample themes parse cleanly', () => {
  for (const f of ['themes/family.txt', 'samples/test-theme.txt']) {
    const t = parseTheme(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), f);
    assert.deepEqual(t.warnings, [], f);
  }
});

test('store uploads, replaces and deletes themes on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hangman-'));
  const store = new ThemeStore({ builtinDir: path.join(__dirname, '..', 'themes'), uploadDir: dir });
  const r = store.upload('# Test Theme\n## A\nPOLAR BEAR\n', 'test.txt');
  assert.equal(r.id, 'u-test-theme');
  store.upload('# Test Theme\n## A\nRED PANDA\nGIRAFFE\n', 'test.txt');
  assert.equal(store.get('u-test-theme').categories[0].phrases.length, 2);
  const again = new ThemeStore({ builtinDir: path.join(__dirname, '..', 'themes'), uploadDir: dir });
  assert.ok(again.get('u-test-theme'), 'uploads survive a restart');
  assert.throws(() => again.remove('family'), ThemeError);
  again.remove('u-test-theme');
  assert.equal(again.get('u-test-theme'), null);
  assert.equal(fs.readdirSync(dir).length, 0);
});

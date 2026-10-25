'use strict';
// Themes are plain text files in themes/: "# Theme name", then "## Category"
// headings, then one phrase per line. Adding a file and pushing to main
// redeploys the game with the new theme.

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 100 * 1024;
const MAX_PHRASES = 1000;
const MAX_CATEGORIES = 50;
const MAX_PHRASE_LEN = 40;
const MAX_NAME_LEN = 40;

class ThemeError extends Error {}

function cleanLabel(s) {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
}

// Upper case, straight apostrophes, accents dropped (JALAPEÑO -> JALAPENO).
function normalizePhrase(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`´]/g, "'").replace(/[‐-―]/g, '-')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

function phraseProblem(p) {
  if (!/^[A-Z' -]+$/.test(p)) return 'use letters, spaces, apostrophes and hyphens only';
  if ((p.match(/[A-Z]/g) || []).length < 2) return 'needs at least 2 letters';
  if (p.length > MAX_PHRASE_LEN) return `keep it to ${MAX_PHRASE_LEN} characters`;
  return null;
}

function parseTheme(text, fallbackName) {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new ThemeError('That file is too big. Keep it under 100 KB.');
  const base = cleanLabel(String(fallbackName || '').replace(/\.txt$/i, '').replace(/[-_]+/g, ' '));
  const lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
  let name = '';
  const cats = [];
  const byName = new Map();
  const warnings = [];
  let current = null;
  let total = 0;
  const category = label => {
    const key = label.toLowerCase();
    if (!byName.has(key)) {
      if (cats.length >= MAX_CATEGORIES) throw new ThemeError(`Too many categories. The limit is ${MAX_CATEGORIES}.`);
      const c = { name: label, phrases: [] };
      byName.set(key, c);
      cats.push(c);
    }
    return byName.get(key);
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('//')) return;
    const h2 = line.match(/^##\s*(.*)$/);
    if (h2) {
      const label = cleanLabel(h2[1]);
      if (!label) { warnings.push(`Line ${i + 1}: category heading has no name, skipped.`); return; }
      current = category(label);
      return;
    }
    const h1 = line.match(/^#\s*(.*)$/);
    if (h1) {
      if (!name) name = cleanLabel(h1[1].replace(/^theme\s*:\s*/i, ''));
      return;
    }
    const p = normalizePhrase(line);
    const problem = phraseProblem(p);
    if (problem) { warnings.push(`Line ${i + 1}: "${line.slice(0, 50)}" skipped (${problem}).`); return; }
    const target = current || category(name || base || 'General');
    if (target.phrases.includes(p)) return;
    if (total >= MAX_PHRASES) { if (total === MAX_PHRASES) warnings.push(`Only the first ${MAX_PHRASES} phrases were kept.`); total++; return; }
    target.phrases.push(p);
    total++;
  });
  name = name || base || 'My theme';
  const categories = cats.filter(c => c.phrases.length);
  if (!categories.length) throw new ThemeError('No phrases found. Put one phrase on each line.');
  return { name, categories, warnings };
}

class ThemeStore {
  constructor({ dir }) {
    this.dir = dir;
    this.themes = new Map();
    fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort().forEach(f => {
      try {
        const t = parseTheme(fs.readFileSync(path.join(dir, f), 'utf8'), f);
        const id = path.basename(f, '.txt');
        this.themes.set(id, { id, ...t });
      } catch (e) {
        console.error(`Skipping theme ${f}: ${e.message}`);
      }
    });
  }

  get(id) { return this.themes.get(id) || null; }

  first() { return this.themes.get('family') || this.themes.values().next().value || null; }

  list() {
    return [...this.themes.values()].map(t => ({
      id: t.id, name: t.name,
      count: t.categories.reduce((n, c) => n + c.phrases.length, 0),
      categories: t.categories.map(c => ({ name: c.name, count: c.phrases.length })),
    }));
  }
}

module.exports = { parseTheme, normalizePhrase, phraseProblem, ThemeStore, ThemeError };

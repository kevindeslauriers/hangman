'use strict';
// Survey questions for Family Face-Off, kept as .txt files in surveys/:
//
//   ? Name something people take to the beach.
//   SUNSCREEN 32 / SUNBLOCK / LOTION
//   TOWEL 25 / BEACH TOWEL
//
// "?" starts a question. Each answer line is the answer as shown on the
// board, its points, then other ways people might say it after slashes.

const fs = require('fs');
const path = require('path');

class SurveyError extends Error {}

const STOP = new Set(['A', 'AN', 'THE', 'SOME', 'MY', 'YOUR', 'HIS', 'HER', 'THEIR', 'OUR']);

function singular(w) {
  if (w.length > 4 && w.endsWith('IES')) return w.slice(0, -3) + 'Y';
  if (w.length > 4 && /(SS|SH|CH|X|Z)ES$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('S') && !w.endsWith('SS') && !w.endsWith('US')) return w.slice(0, -1);
  return w;
}

// "The Puppies!" and "puppy" both become "PUPPY".
function normalize(s) {
  const words = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/&/g, ' AND ').replace(/['’]/g, '').replace(/[^A-Z0-9]+/g, ' ')
    .trim().split(' ').filter(Boolean);
  while (words.length > 1 && STOP.has(words[0])) words.shift();
  return words.map(singular).join(' ');
}

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const hasWords = (hay, needle) => (' ' + hay + ' ').includes(' ' + needle + ' ');

// Which answer (index) a typed guess matches, or -1. Exact matches win over
// typos, and typos over partial matches like "towel" for "BEACH TOWEL".
function matchAnswer(typed, answers) {
  const t = normalize(typed);
  if (!t) return -1;
  const tiers = [[], [], []];
  answers.forEach((a, i) => {
    let best = 3;
    for (const k of a.keys) {
      if (k === t) best = 0;
      else if (best > 1 && k.length >= 5 && distance(k, t) <= (k.length >= 9 ? 2 : 1)) best = 1;
      else if (best > 2 && ((k.length >= 4 && hasWords(t, k)) || (t.length >= 4 && hasWords(k, t)))) best = 2;
    }
    if (best < 3) tiers[best].push(i);
  });
  for (const tier of tiers) if (tier.length) return tier[0];
  return -1;
}

function parseSurveys(text, filename = 'surveys') {
  const questions = [];
  let q = null;
  const fail = (n, msg) => { throw new SurveyError(`${filename} line ${n}: ${msg}`); };
  const finish = () => {
    if (!q) return;
    if (q.answers.length < 3) fail(q.line, `"${q.text}" needs at least 3 answers.`);
    if (q.answers.length > 8) fail(q.line, `"${q.text}" has more than 8 answers.`);
    const total = q.answers.reduce((n, a) => n + a.points, 0);
    if (total > 100) fail(q.line, `"${q.text}" adds up to ${total} points; the most is 100.`);
    q.answers.forEach((a, i) => {
      if (i && a.points > q.answers[i - 1].points) fail(a.line, `${a.text} is worth more than the answer above it.`);
    });
    questions.push({ text: q.text, answers: q.answers.map(({ text: t, points, keys }) => ({ text: t, points, keys })) });
    q = null;
  };
  String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/).forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) return;
    if (line.startsWith('?')) {
      finish();
      const t = line.slice(1).trim();
      if (!t) fail(n, 'the question is empty.');
      q = { text: t, answers: [], line: n };
      return;
    }
    if (!q) fail(n, 'an answer before any question. Start questions with "?".');
    const m = line.match(/^(.+?)\s+(\d{1,3})\s*(?:\/(.*))?$/);
    if (!m) fail(n, `"${line}" should look like: ANSWER 25 / OTHER WAY TO SAY IT`);
    const shown = m[1].trim().toUpperCase();
    if (shown.length > 26) fail(n, `"${shown}" is too long for the board (26 characters at most).`);
    const points = +m[2];
    if (points < 1) fail(n, `${shown} needs at least 1 point.`);
    const keys = [...new Set([shown, ...(m[3] || '').split('/')].map(normalize).filter(Boolean))];
    q.answers.push({ text: shown, points, keys, line: n });
  });
  finish();
  return questions;
}

class SurveyStore {
  constructor({ dir }) {
    this.questions = [];
    fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort().forEach(f => {
      try {
        this.questions.push(...parseSurveys(fs.readFileSync(path.join(dir, f), 'utf8'), f));
      } catch (e) {
        console.error(`Skipping surveys ${f}: ${e.message}`);
      }
    });
  }
}

module.exports = { parseSurveys, matchAnswer, normalize, SurveyStore, SurveyError };

'use strict';
// Class Board: a quiz board for a whole class. The teacher's computer drives
// the projector; every student answers every clue on their own laptop.
//
// Students sit in teams (table groups). A team picks the clue, then everyone
// answers before the timer runs out. Right answers earn a student the clue's
// value, and their team earns the value times the share of the team that got
// it right, so every student's answer counts. Daily Doubles and the final
// clue are team wagers: a team wins its bet when at least half of it is right.
// Nothing is stored: the teacher downloads a CSV report at the end.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { matchAnswer, normalize } = require('./survey');
const { stripQuestion } = require('./quiz');

class ClassError extends Error {}

const LEVELS = 5;
const COLS = 6;
const MAX_STUDENTS = 60;
const FINAL_POINTS = 1000;
const TEAM_NAMES = ['Protons', 'Neutrons', 'Electrons', 'Quarks', 'Photons', 'Neutrinos', 'Isotopes', 'Ions'];
const TEAM_COLORS = ['#e8453c', '#2f7de1', '#f2b705', '#22b573', '#9b51e0', '#f2862a', '#14b8c4', '#e05aa8'];
const TIMES = [20, 30, 45, 60, 90];
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------- numbers ---------- */

const SUPER = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };

// "3.0 x 10^8 m/s", "3e8", "300 000 000" and "3.0×10⁸" all read as 3e8.
// Returns { value, rest } or null.
function parseNumber(s) {
  let t = String(s || '').trim().replace(/^(about|approx\.?|approximately|~|≈|\$)\s*/i, '')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, m => '^' + [...m].map(ch => SUPER[ch]).join(''))
    .replace(/[−–]/g, '-').replace(/[×·*]/g, 'x').replace(/\^\s*\(\s*(-?\d+)\s*\)/g, '^$1')
    .replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/(\d) (?=\d{3}\b)/g, '$1');
  const m = t.match(/^([-+]?(?:\d+\.?\d*|\.\d+))\s*(?:[eE]\s*([-+]?\d+)|x\s*10\s*(?:\^|\*\*|\s)?\s*([-+]?\d+))?/);
  if (!m) return null;
  const exp = m[2] != null ? +m[2] : m[3] != null ? +m[3] : 0;
  const value = parseFloat(m[1]) * 10 ** exp;
  if (!isFinite(value)) return null;
  return { value, rest: t.slice(m[0].length).trim() };
}

const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = n => String(n).replace(/-/g, '⁻').replace(/\d/g, d => SUP_DIGITS[d]);
// How a numeric answer is shown: "3e8" -> "3 × 10⁸".
function showNumber(raw) {
  const p = parseNumber(raw);
  if (!p) return raw;
  const m = String(raw).trim().match(/^([-+]?[\d.]+)\s*(?:[eE]\s*([-+]?\d+)|[x×*]\s*10\s*\^?\s*([-+]?\d+))/);
  if (m && (m[2] || m[3])) return `${m[1]} × 10${sup(m[2] || m[3])}`;
  return p.value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/* ---------- names ---------- */

// A light filter for first names: the teacher can rename or remove anyone.
const BAD_ANYWHERE = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'niga', 'fag', 'slut', 'whore', 'porn', 'dildo', 'jizz', 'wank', 'twat', 'hitler', 'penis', 'vagina', 'pussy', 'asshole', 'bollock', 'boner', 'horny', 'retard'];
const BAD_WORDS = new Set(['ass', 'arse', 'dick', 'cock', 'sex', 'sexy', 'boob', 'boobs', 'tit', 'tits', 'damn', 'crap', 'piss', 'kill', 'anal', 'cum', 'hoe', 'hoes', 'butt', 'poop', 'fart', 'nazi', 'rape', 'prick', 'idiot', 'stupid', 'dumb', 'loser', 'nude', 'naked', 'bum', 'pee', 'gay', 'die', 'dead', 'hell']);
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };

function badName(name) {
  const plain = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[013457@$!8]/g, ch => LEET[ch]);
  const squash = s => s.replace(/(.)\1+/g, '$1');
  const letters = plain.replace(/[^a-z]/g, '');
  if (BAD_ANYWHERE.some(w => letters.includes(w) || squash(letters).includes(squash(w)))) return true;
  const words = plain.split(/[^a-z]+/).filter(Boolean);
  return words.some(w => BAD_WORDS.has(w) || BAD_WORDS.has(squash(w)));
}

/* ---------- clue banks ---------- */
//   # Course: SNC1W | Grade 9 Science
//   # Unit: bio | Biology: Sustainable Ecosystems
//   ## CATEGORY NAME
//   1 | clue | ANSWER | WRONG; WRONG; WRONG     four choices
//   2 | clue | ANSWER / other ways to say it      typed
//   3 | clue | = 2.5e13 km ~2%                    a number (default ±2%)
//   ... levels 1 to 5, one of each
//   FINAL | CATEGORY | clue | answer as above

function parseAnswer(field, wrongField, fail) {
  field = field.trim();
  if (field.startsWith('=')) {
    if (wrongField != null) fail('a number answer can’t have wrong choices.');
    const [main, tolRaw] = field.slice(1).split('~');
    const p = parseNumber(main);
    if (!p) fail(`can’t read the number "${main.trim()}".`);
    let tol = { rel: 0.02 };
    if (tolRaw != null) {
      const tm = tolRaw.trim().match(/^([\d.]+)\s*(%?)$/);
      if (!tm) fail('write the tolerance like ~2% or ~0.5');
      tol = tm[2] ? { rel: +tm[1] / 100 } : { abs: +tm[1] };
    }
    const shown = showNumber(main.trim().slice(0, main.trim().length - p.rest.length).trim());
    return { type: 'num', value: p.value, tol, unit: p.rest, a: (shown + (p.rest ? ' ' + p.rest : '')).trim() };
  }
  const [answer, ...alts] = field.split('/').map(s => s.trim());
  if (!answer) fail('missing the answer.');
  const keys = [...new Set([answer, ...alts].map(normalize).filter(Boolean))];
  if (wrongField == null) return { type: 'text', a: answer, keys };
  const wrong = wrongField.split(';').map(s => s.trim()).filter(Boolean);
  if (wrong.length < 1 || wrong.length > 4) fail('give one to four wrong choices, separated by semicolons.');
  if (wrong.some(w => w.toUpperCase() === answer.toUpperCase())) fail('a wrong choice is the same as the answer.');
  return { type: 'mc', a: answer, keys, wrong };
}

function parseBank(text, filename = 'bank') {
  const fail = (n, msg) => { throw new ClassError(`${filename} line ${n}: ${msg}`); };
  const head = (name) => { const m = String(text).match(new RegExp(`^#\\s*${name}:\\s*([^|\\n]+?)\\s*(?:\\|\\s*(.+?))?\\s*$`, 'im')); return m ? { id: m[1].trim(), title: (m[2] || m[1]).trim() } : null; };
  const course = head('Course');
  const unit = head('Unit');
  if (!course || !unit) throw new ClassError(`${filename}: needs "# Course: ID | Title" and "# Unit: id | Title" lines.`);
  const cats = [];
  const finals = [];
  let cat = null;
  const finish = () => {
    if (!cat) return;
    if (cat.clues.length !== LEVELS || cat.clues.some((c, i) => c.level !== i + 1)) fail(cat.line, `"${cat.name}" needs one clue at each level 1 to 5, in order.`);
    cats.push({ name: cat.name, unit: unit.id, clues: cat.clues.map(({ line, ...c }) => c) });
    cat = null;
  };
  String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/).forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('//') || /^#(?!#)/.test(line)) return;
    if (line.startsWith('##')) { finish(); cat = { name: line.slice(2).trim().toUpperCase(), clues: [], line: n }; if (!cat.name) fail(n, 'category has no name.'); return; }
    const parts = line.split('|').map(s => s.trim());
    const bad = msg => fail(n, msg);
    if (/^FINAL$/i.test(parts[0])) {
      finish();
      if (parts.length < 4 || parts.length > 5) bad('FINAL | CATEGORY | clue | ANSWER [| WRONG; WRONG; WRONG]');
      finals.push({ category: parts[1].toUpperCase(), unit: unit.id, q: parts[2], ...parseAnswer(parts[3], parts[4], bad) });
      return;
    }
    if (!cat) bad('a clue before any "## CATEGORY".');
    if (parts.length < 3 || parts.length > 4) bad('should look like: 3 | clue | ANSWER  (add "| WRONG; WRONG; WRONG" for choices)');
    const level = +parts[0];
    if (!(level >= 1 && level <= LEVELS)) bad('the level must be 1 to 5.');
    if (!parts[1]) bad('missing the clue.');
    cat.clues.push({ level, q: parts[1], ...parseAnswer(parts[2], parts[3], bad), line: n });
  });
  finish();
  return { course, unit, cats, finals };
}

// Every .txt file in the folder is one unit of a course.
class Bank {
  constructor({ dir }) {
    this.courses = [];
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort(); } catch (e) {}
    files.forEach(f => {
      try { this.add(parseBank(fs.readFileSync(path.join(dir, f), 'utf8'), f)); } catch (e) { console.error(`Skipping clue bank ${f}: ${e.message}`); }
    });
  }

  add({ course, unit, cats, finals }) {
    let c = this.courses.find(x => x.id === course.id);
    if (!c) { c = { id: course.id, title: course.title, units: [] }; this.courses.push(c); }
    if (c.units.some(u => u.id === unit.id)) throw new ClassError(`${course.id} has two units called "${unit.id}".`);
    c.units.push({ id: unit.id, title: unit.title, cats, finals });
  }

  course(id) { return this.courses.find(c => c.id === id) || null; }

  list() {
    return this.courses.map(c => ({ id: c.id, title: c.title, units: c.units.map(u => ({ id: u.id, title: u.title, cats: u.cats.length, finals: u.finals.length })) }));
  }
}

/* ---------- the game ---------- */

class Classroom {
  constructor(opts) {
    this.bank = opts.bank;
    this.code = opts.code;
    this.onChange = opts.onChange || (() => {});
    this.fx = opts.fx || (() => {});
    this.now = opts.now || Date.now;
    this.setTimer = opts.setTimer || setTimeout;
    this.clearTimer = opts.clearTimer || clearTimeout;
    this.random = opts.random || Math.random;
    const first = this.bank.courses[0];
    this.settings = { course: first ? first.id : '', units: first ? first.units.map(u => u.id) : [], teams: 4, rounds: 2, secs: 30, final: true, dd: true };
    this.students = [];
    this.nextId = 1;
    this.used = new Set();
    this.timer = null;
    this.handle = null;
    this.reset();
  }

  reset() {
    this.stopTimer();
    this.phase = 'lobby';
    this.rounds = [];
    this.roundIdx = 0;
    this.taken = new Set();
    this.pickTeam = 0;
    this.records = [];
    this.rec = null;
    this.final = null;
    this.paused = null;
    this.msg = '';
  }

  changed() { this.onChange(); }

  /* ---------- students and teams ---------- */

  student(id) { return this.students.find(s => s.id === id) || null; }
  teamNames() { return TEAM_NAMES.slice(0, this.settings.teams); }
  members(t) { return this.students.filter(s => s.team === t); }
  smallestTeam() {
    const counts = this.teamNames().map((_, t) => this.members(t).length);
    const min = Math.min(...counts);
    return counts.indexOf(min);
  }

  checkName(raw, exceptId) {
    const name = clean(raw, 14);
    if (!name) throw new ClassError('Type your first name.');
    if (badName(name)) throw new ClassError('Please use your real first name.');
    let n = name, k = 2;
    while (this.students.some(s => s.id !== exceptId && s.name.toLowerCase() === n.toLowerCase())) n = `${name.slice(0, 12)} ${k++}`;
    return n;
  }

  join(rawName, team) {
    if (this.students.length >= MAX_STUDENTS) throw new ClassError('This class is full.');
    const name = this.checkName(rawName);
    const t = Number.isInteger(team) && team >= 0 && team < this.settings.teams ? team : this.smallestTeam();
    const s = { id: this.nextId++, token: crypto.randomBytes(12).toString('hex'), name, team: t, connected: true };
    this.students.push(s);
    this.fx({ kind: 'join', name });
    this.changed();
    return s;
  }

  setConnected(id, on) {
    const s = this.student(id);
    if (!s || s.connected === on) return;
    s.connected = on;
    this.changed();
  }

  setTeam(id, team, byStudent) {
    const s = this.student(id);
    if (!s) throw new ClassError('That student isn’t here.');
    if (!(Number.isInteger(team) && team >= 0 && team < this.settings.teams)) throw new ClassError('Pick a team.');
    if (byStudent && this.phase !== 'lobby') throw new ClassError('Ask your teacher to change your team.');
    s.team = team;
    this.changed();
  }

  rename(id, name) {
    const s = this.student(id);
    if (!s) throw new ClassError('That student isn’t here.');
    s.name = this.checkName(name, id);
    this.changed();
  }

  remove(id) {
    const i = this.students.findIndex(s => s.id === id);
    if (i < 0) return;
    this.students.splice(i, 1);
    // Their answers stay in this game's report; they just stop playing.
    if (this.rec && this.rec.eligible.has(id) && !this.rec.answers.has(id)) this.rec.eligible.delete(id);
    this.maybeAllAnswered();
    this.changed();
  }

  // Deal everyone into even teams at random.
  balance() {
    const order = this.students.map(s => ({ s, k: this.random() })).sort((a, b) => a.k - b.k).map(x => x.s);
    order.forEach((s, i) => { s.team = i % this.settings.teams; });
    this.changed();
  }

  /* ---------- settings ---------- */

  updateSettings(s) {
    if (this.phase !== 'lobby') throw new ClassError('Change settings in the lobby.');
    const st = this.settings;
    if (s.course != null && this.bank.course(String(s.course))) {
      if (String(s.course) !== st.course) st.units = this.bank.course(String(s.course)).units.map(u => u.id);
      st.course = String(s.course);
    }
    const course = this.bank.course(st.course);
    if (Array.isArray(s.units) && course) {
      const ids = course.units.map(u => u.id).filter(id => s.units.includes(id));
      if (!ids.length) throw new ClassError('Pick at least one unit.');
      st.units = ids;
    }
    if (s.teams != null) {
      const n = Math.max(2, Math.min(TEAM_NAMES.length, Math.round(+s.teams) || 4));
      st.teams = n;
      this.students.filter(x => x.team >= n).forEach(x => { x.team = this.smallestTeam(); });
    }
    if (s.rounds != null) st.rounds = +s.rounds === 1 ? 1 : 2;
    if (s.secs != null && TIMES.includes(+s.secs)) st.secs = +s.secs;
    if (s.final != null) st.final = !!s.final;
    if (s.dd != null) st.dd = !!s.dd;
    this.changed();
  }

  units() {
    const c = this.bank.course(this.settings.course);
    return c ? c.units.filter(u => this.settings.units.includes(u.id)) : [];
  }

  /* ---------- starting ---------- */

  shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // Six categories shared out as evenly as the chosen units allow, avoiding
  // ones this class has already played.
  pickCats(n, avoid) {
    const fresh = u => this.shuffle(u.cats.filter(c => !avoid.has(c) && !this.used.has(u.id + '/' + c.name)));
    const stale = u => this.shuffle(u.cats.filter(c => !avoid.has(c) && this.used.has(u.id + '/' + c.name)));
    const piles = this.shuffle(this.units()).map(u => [...fresh(u), ...stale(u)]);
    const out = [];
    while (out.length < n && piles.some(p => p.length)) piles.forEach(p => { if (out.length < n && p.length) out.push(p.shift()); });
    return out;
  }

  start() {
    if (this.phase !== 'lobby') throw new ClassError('The game has already started.');
    if (!this.students.length) throw new ClassError('Wait for students to join.');
    const units = this.units();
    if (!units.length) throw new ClassError('Pick at least one unit.');
    const total = units.reduce((n, u) => n + u.cats.length, 0);
    if (total < COLS) throw new ClassError('Those units don’t have enough categories for a board.');
    const roundCount = total >= COLS * 2 ? this.settings.rounds : 1;
    this.reset();
    const avoid = new Set();
    for (let r = 0; r < roundCount; r++) {
      const cats = this.pickCats(COLS, avoid);
      cats.forEach(c => avoid.add(c));
      const mult = r + 1;
      const dds = new Set();
      if (this.settings.dd) {
        while (dds.size < r + 1) dds.add(`${Math.floor(this.random() * COLS)},${2 + Math.floor(this.random() * 3)}`);
      }
      this.rounds.push({ cats, mult, dds });
    }
    // The team with the fewest players picks first.
    this.pickTeam = this.nextPicker(-1);
    this.phase = 'board';
    this.msg = '';
    this.fx({ kind: 'board' });
    this.changed();
  }

  round() { return this.rounds[this.roundIdx] || null; }
  value(r) { return (r + 1) * 100 * (this.round() ? this.round().mult : 1); }

  nextPicker(from) {
    const n = this.settings.teams;
    for (let k = 1; k <= n; k++) {
      const t = (from + k + n) % n;
      if (this.members(t).length) return t;
    }
    return 0;
  }

  /* ---------- clues ---------- */

  choose(id, c, r) {
    if (this.phase !== 'board') throw new ClassError('It’s not time to pick.');
    if (id != null) {
      const s = this.student(id);
      if (!s || s.team !== this.pickTeam) throw new ClassError(`${TEAM_NAMES[this.pickTeam]} are picking.`);
    }
    c = +c; r = +r;
    const rd = this.round();
    if (!(c >= 0 && c < COLS && r >= 0 && r < LEVELS)) throw new ClassError('Pick a clue on the board.');
    const key = `${c},${r}`;
    if (this.taken.has(key)) throw new ClassError('That clue is gone. Pick another.');
    this.taken.add(key);
    const cat = rd.cats[c];
    this.used.add(cat.unit + '/' + cat.name);
    const clue = cat.clues[r];
    this.rec = {
      n: this.records.length + 1, round: this.roundIdx + 1, cat: cat.name, unit: cat.unit, c, r,
      value: this.value(r), ...this.clueFields(clue),
      dd: rd.dds.has(key) ? { team: this.pickTeam, wager: null } : null,
      eligible: new Set(), answers: new Map(), accepted: new Set(), teamOf: new Map(), done: false,
    };
    this.fx({ kind: 'pick', c, r });
    if (this.rec.dd) {
      this.phase = 'ddWager';
      this.msg = '';
      this.fx({ kind: 'dd' });
      this.startTimer(45, () => this.ddWager(null, this.rec.value, true));
    } else {
      this.openClue();
    }
    this.changed();
  }

  clueFields(clue) {
    const f = { q: clue.q, type: clue.type, a: clue.a, keys: clue.keys, num: clue.type === 'num' ? { value: clue.value, tol: clue.tol } : null, unit: clue.unit || '' };
    f.choices = clue.type === 'mc' ? this.shuffle([clue.a, ...clue.wrong]) : null;
    return f;
  }

  teamScores() { return this.scores().teams; }

  ddMax() {
    const rec = this.rec;
    return Math.max(this.teamScores()[rec.dd.team], LEVELS * 100 * this.round().mult);
  }

  ddWager(id, amount, auto) {
    if (this.phase !== 'ddWager') throw new ClassError('It’s not time to wager.');
    const dd = this.rec.dd;
    if (id != null) {
      const s = this.student(id);
      if (!s || s.team !== dd.team) throw new ClassError('Only the team that found the Daily Double wagers.');
    }
    const max = this.ddMax();
    const w = Math.round(+amount);
    if (!auto && !(w >= 0 && w <= max)) throw new ClassError(`Wager from 0 to ${max.toLocaleString('en-US')}.`);
    dd.wager = auto ? Math.min(max, Math.max(0, w)) : w;
    dd.by = id != null ? this.student(id).name : auto ? '' : 'Teacher';
    this.openClue();
    this.changed();
  }

  openClue() {
    const rec = this.rec;
    this.students.forEach(s => { rec.teamOf.set(s.id, s.team); if (s.connected) rec.eligible.add(s.id); });
    this.phase = rec.final ? 'finalClue' : 'open';
    this.paused = null;
    const secs = rec.final ? this.settings.secs * 2 : rec.type === 'num' ? Math.round(this.settings.secs * 1.5) : this.settings.secs;
    this.startTimer(secs, () => this.close(true));
    this.fx({ kind: 'open' });
  }

  check(rec, text) {
    if (rec.type === 'num') {
      const p = parseNumber(text);
      if (!p) return false;
      const { value, tol } = rec.num;
      const room = tol.abs != null ? tol.abs : Math.abs(value) * tol.rel;
      return Math.abs(p.value - value) <= room + 1e-12 * Math.abs(value);
    }
    if (rec.type === 'mc') return text === rec.a;
    const t = stripQuestion(text);
    return matchAnswer(t, [{ keys: rec.keys }]) === 0;
  }

  answer(id, raw) {
    const rec = this.rec;
    if (!rec || !['open', 'finalClue'].includes(this.phase)) throw new ClassError('Answers are closed.');
    const s = this.student(id);
    if (!s) throw new ClassError('Join the game first.');
    if (rec.answers.has(id)) throw new ClassError('You already answered.');
    const text = clean(raw, 80);
    if (!text) throw new ClassError('Type an answer.');
    if (rec.type === 'mc' && !rec.choices.includes(text)) throw new ClassError('Pick one of the choices.');
    if (rec.type === 'num' && !parseNumber(text)) throw new ClassError('Type a number, like 42, 0.5 or 3.0e8.');
    rec.eligible.add(id);
    if (!rec.teamOf.has(id)) rec.teamOf.set(id, s.team);
    rec.answers.set(id, { text, right: this.check(rec, text), at: this.now() });
    this.fx({ kind: 'answered' });
    if (!this.maybeAllAnswered()) this.changed();
  }

  // Everyone who is here has answered: no need to wait out the clock.
  maybeAllAnswered() {
    const rec = this.rec;
    if (!rec || !['open', 'finalClue'].includes(this.phase) || this.paused) return false;
    const waiting = this.students.filter(s => s.connected && !rec.answers.has(s.id));
    if (waiting.length || !rec.answers.size) return false;
    this.close(false);
    return true;
  }

  close(timesUp) {
    const rec = this.rec;
    if (!rec || !['open', 'finalClue'].includes(this.phase)) throw new ClassError('Answers are already closed.');
    this.stopTimer();
    this.paused = null;
    rec.done = true;
    if (rec.final) {
      this.phase = 'finalReveal';
      const before = this.scores({ beforeFinal: true }).teams;
      // Teams are revealed from last place up.
      this.final.order = this.teamNames().map((_, t) => t).filter(t => this.members(t).length || [...rec.teamOf.values()].includes(t))
        .sort((a, b) => before[a] - before[b]);
      this.final.shown = 0;
      this.fx({ kind: 'finalClosed', timesUp });
    } else {
      this.phase = 'reveal';
      const st = this.stats(rec);
      this.fx({ kind: 'reveal', timesUp, pct: st.pct });
    }
    this.changed();
  }

  pause() {
    if (!['open', 'finalClue', 'ddWager', 'finalWager'].includes(this.phase)) throw new ClassError('Nothing to pause.');
    if (this.paused) {
      const left = this.paused.left;
      const fn = this.paused.fn;
      const total = this.paused.total;
      this.paused = null;
      this.startTimer(left / 1000, fn);
      this.timer.total = total;
      if (!this.maybeAllAnswered()) this.changed();
      return;
    }
    if (!this.timer) return;
    this.paused = { left: Math.max(1000, this.timer.endsAt - this.now()), fn: this.timer.fn, total: this.timer.total };
    this.stopTimer();
    this.changed();
  }

  // Count a typed answer that the checker missed (or take that back).
  accept(key) {
    const rec = this.rec;
    if (!rec || !rec.done || !['reveal', 'finalReveal'].includes(this.phase) || rec.type === 'mc') throw new ClassError('Nothing to accept.');
    if (this.phase === 'finalReveal' && this.final.shown > 0) throw new ClassError('Accept answers before revealing the teams.');
    const on = !rec.accepted.has(key);
    if (on) rec.accepted.add(key); else rec.accepted.delete(key);
    rec.answers.forEach(a => { if (this.groupKey(rec, a.text) === key) a.right = on || this.check(rec, a.text); });
    this.changed();
  }

  groupKey(rec, text) {
    if (rec.type === 'num') { const p = parseNumber(text); return p ? 'n:' + +p.value.toPrecision(6) : 't:' + normalize(text); }
    return 't:' + (normalize(stripQuestion(text)) || text.toUpperCase());
  }

  skip() {
    if (!['open', 'ddWager'].includes(this.phase)) throw new ClassError('Nothing to skip.');
    this.stopTimer();
    this.paused = null;
    this.rec = null;
    this.toBoard(false);
  }

  next() {
    if (this.phase === 'reveal') {
      this.records.push(this.rec);
      this.rec = null;
      return this.toBoard(true);
    }
    if (this.phase === 'roundBreak') {
      this.roundIdx++;
      this.taken = new Set();
      this.pickTeam = this.nextPicker(this.pickTeamLow());
      this.phase = 'board';
      this.fx({ kind: 'board' });
      return this.changed();
    }
    if (this.phase === 'finalWager') return this.toFinalClue();
    if (this.phase === 'finalReveal') return this.finalStep();
    throw new ClassError('Nothing to move on to.');
  }

  // The team furthest behind picks first in the next round.
  pickTeamLow() {
    const sc = this.teamScores();
    let low = -1, best = Infinity;
    sc.forEach((v, t) => { if (this.members(t).length && v < best) { best = v; low = t; } });
    return low < 0 ? -1 : (low - 1 + this.settings.teams) % this.settings.teams;
  }

  toBoard(advance) {
    if (advance) this.pickTeam = this.nextPicker(this.pickTeam);
    if (this.taken.size >= COLS * LEVELS) return this.endRound();
    this.phase = 'board';
    this.msg = '';
    this.changed();
  }

  endRound() {
    if (!['board', 'reveal'].includes(this.phase)) throw new ClassError('Finish this clue first.');
    if (this.phase === 'reveal') { this.records.push(this.rec); this.rec = null; }
    this.stopTimer();
    if (this.roundIdx + 1 < this.rounds.length) {
      this.phase = 'roundBreak';
      this.fx({ kind: 'roundBreak' });
      return this.changed();
    }
    if (this.settings.final && this.startFinal()) return;
    this.finish();
  }

  /* ---------- the final clue ---------- */

  startFinal() {
    const finals = this.units().flatMap(u => u.finals);
    if (!finals.length) return false;
    const fresh = finals.filter(f => !this.used.has('final/' + f.q));
    const pool = fresh.length ? fresh : finals;
    const f = pool[Math.floor(this.random() * pool.length)];
    this.used.add('final/' + f.q);
    this.final = { category: f.category, wagers: {}, order: [], shown: 0 };
    this.rec = {
      n: this.records.length + 1, round: 'Final', cat: f.category, unit: f.unit, value: FINAL_POINTS, final: true, ...this.clueFields(f),
      dd: null, eligible: new Set(), answers: new Map(), accepted: new Set(), teamOf: new Map(), done: false,
    };
    this.phase = 'finalWager';
    this.fx({ kind: 'final' });
    this.startTimer(60, () => this.toFinalClue());
    this.changed();
    return true;
  }

  finalMax(t) { return Math.max(0, this.scores({ beforeFinal: true }).teams[t]); }

  finalWager(id, team, amount) {
    if (this.phase !== 'finalWager') throw new ClassError('It’s not time to wager.');
    let by = 'Teacher';
    if (id != null) {
      const s = this.student(id);
      if (!s) throw new ClassError('Join the game first.');
      team = s.team;
      by = s.name;
    }
    team = +team;
    if (!(team >= 0 && team < this.settings.teams)) throw new ClassError('Pick a team.');
    const max = this.finalMax(team);
    const w = Math.round(+amount);
    if (!(w >= 0 && w <= max)) throw new ClassError(max ? `Wager from 0 to ${max.toLocaleString('en-US')}.` : 'Your team has no points to wager.');
    this.final.wagers[team] = { amount: w, by };
    const teams = this.teamNames().map((_, t) => t).filter(t => this.members(t).length);
    if (teams.every(t => this.final.wagers[t] || this.finalMax(t) === 0)) return this.toFinalClue();
    this.changed();
  }

  toFinalClue() {
    if (this.phase !== 'finalWager') throw new ClassError('It’s not time for the final clue.');
    this.stopTimer();
    this.openClue();
    this.changed();
  }

  finalStep() {
    const f = this.final;
    if (f.shown < f.order.length) {
      f.shown++;
      const t = f.order[f.shown - 1];
      const r = this.teamResult(this.rec, t);
      this.fx({ kind: 'finalTeam', team: t, won: r.n > 0 && r.right * 2 >= r.n });
      return this.changed();
    }
    this.records.push(this.rec);
    this.rec = null;
    this.finish();
  }

  finish() {
    this.stopTimer();
    if (this.rec && this.rec.done) { this.records.push(this.rec); this.rec = null; }
    this.phase = 'champ';
    this.fx({ kind: 'champ' });
    this.changed();
  }

  toLobby() {
    this.reset();
    this.changed();
  }

  /* ---------- scoring ---------- */

  teamResult(rec, t) {
    let n = 0, right = 0;
    rec.eligible.forEach(id => {
      if (rec.teamOf.get(id) !== t) return;
      n++;
      const a = rec.answers.get(id);
      if (a && a.right) right++;
    });
    return { n, right };
  }

  // Points for a team from one clue.
  teamPoints(rec, t) {
    const { n, right } = this.teamResult(rec, t);
    if (rec.final) {
      const w = (this.final && this.final.wagers[t] || { amount: 0 }).amount;
      return n && right * 2 >= n ? w : -w;
    }
    if (rec.dd) {
      if (rec.dd.team !== t) return 0;
      return n && right * 2 >= n ? rec.dd.wager : -rec.dd.wager;
    }
    return n ? Math.round(rec.value * right / n) : 0;
  }

  // Scores are worked out from the answers, so accepting an answer or
  // removing a student never leaves them out of step.
  scores({ beforeFinal } = {}) {
    const teams = this.teamNames().map(() => 0);
    const students = new Map(this.students.map(s => [s.id, 0]));
    const right = new Map(this.students.map(s => [s.id, 0]));
    const recs = [...this.records];
    if (this.rec && this.rec.done && !this.records.includes(this.rec)) recs.push(this.rec);
    recs.forEach(rec => {
      if (rec.final && beforeFinal) return;
      if (rec.final && this.phase === 'finalReveal') {
        this.final.order.slice(0, this.final.shown).forEach(t => { teams[t] += this.teamPoints(rec, t); });
        return;
      }
      teams.forEach((_, t) => { teams[t] += this.teamPoints(rec, t); });
      rec.answers.forEach((a, id) => {
        if (!a.right || !students.has(id)) return;
        students.set(id, students.get(id) + rec.value);
        right.set(id, right.get(id) + 1);
      });
    });
    return { teams, students, right };
  }

  stats(rec) {
    const answers = [...rec.answers.values()];
    const n = rec.eligible.size;
    const nRight = answers.filter(a => a.right).length;
    const out = { n, answered: answers.length, right: nRight, pct: n ? Math.round(100 * nRight / n) : 0 };
    out.teams = this.teamNames().map((_, t) => ({ ...this.teamResult(rec, t), pts: this.teamPoints(rec, t) }));
    if (rec.type === 'mc') {
      out.dist = rec.choices.map(ch => ({ text: ch, count: answers.filter(a => a.text === ch).length, right: ch === rec.a }));
    } else {
      const groups = new Map();
      answers.forEach(a => {
        const key = this.groupKey(rec, a.text);
        const g = groups.get(key) || { key, text: a.text, count: 0, right: a.right, accepted: rec.accepted.has(key) };
        g.count++;
        groups.set(key, g);
      });
      out.groups = [...groups.values()].sort((a, b) => b.right - a.right || b.count - a.count).slice(0, 12);
    }
    return out;
  }

  /* ---------- timers ---------- */

  startTimer(secs, fn) {
    this.stopTimer();
    this.timer = { total: secs * 1000, endsAt: this.now() + secs * 1000, fn };
    this.handle = this.setTimer(() => { this.handle = null; this.timer = null; fn(); }, secs * 1000);
  }

  stopTimer() {
    if (this.handle) this.clearTimer(this.handle);
    this.handle = null;
    this.timer = null;
  }

  timerView() {
    if (this.paused) return { total: this.paused.total, remaining: this.paused.left, paused: true };
    return this.timer ? { total: this.timer.total, remaining: Math.max(0, this.timer.endsAt - this.now()) } : null;
  }

  /* ---------- what the screens see ---------- */

  top(n, sc) {
    return this.students.map(s => ({ name: s.name, team: s.team, score: sc.students.get(s.id) || 0 }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, n);
  }

  clueView() {
    const rec = this.rec;
    if (!rec) return null;
    const open = ['open', 'finalClue'].includes(this.phase);
    const shown = this.phase !== 'ddWager' && this.phase !== 'finalWager';
    const revealed = rec.done;
    return {
      n: rec.n, cat: rec.cat, value: rec.value, final: !!rec.final, c: rec.c, r: rec.r,
      q: shown ? rec.q : '', type: rec.type, choices: shown ? rec.choices : null, unit: rec.type === 'num' && rec.unit ? rec.unit : '',
      dd: rec.dd ? { team: rec.dd.team, wager: rec.dd.wager, by: rec.dd.by || '', max: this.phase === 'ddWager' ? this.ddMax() : null } : null,
      answered: rec.answers.size, waiting: open ? this.students.filter(s => s.connected && !rec.answers.has(s.id)).length : 0,
      a: revealed ? rec.a : null,
      stats: revealed ? this.stats(rec) : null,
    };
  }

  baseView(sc) {
    const rd = this.round();
    return {
      game: 'class',
      code: this.code,
      phase: this.phase,
      round: this.roundIdx + 1,
      rounds: this.rounds.length,
      settings: this.settings,
      teams: this.teamNames().map((name, t) => ({ t, name, color: TEAM_COLORS[t], score: sc.teams[t], count: this.members(t).length })),
      pickTeam: this.pickTeam,
      board: rd ? { cats: rd.cats.map(c => c.name), values: [0, 1, 2, 3, 4].map(r => this.value(r)), taken: [...this.taken] } : null,
      final: this.final ? {
        category: this.final.category,
        wagers: Object.fromEntries(Object.entries(this.final.wagers).map(([t, w]) => [t, true])),
        maxes: this.teamNames().map((_, t) => this.finalMax(t)),
        order: this.final.order, shown: this.final.shown,
        results: this.phase === 'finalReveal' || this.phase === 'champ'
          ? Object.fromEntries(this.final.order.slice(0, this.phase === 'champ' ? this.final.order.length : this.final.shown).map(t => {
            const rec = this.phase === 'champ' ? this.records.find(r => r.final) : this.rec;
            return [t, rec ? { ...this.teamResult(rec, t), wager: (this.final.wagers[t] || { amount: 0 }).amount, pts: this.teamPoints(rec, t) } : null];
          })) : null,
      } : null,
      top: this.top(3, sc),
      timer: this.timerView(),
      msg: this.msg,
    };
  }

  teacherView() {
    const sc = this.scores();
    return {
      ...this.baseView(sc),
      courses: this.bank.list(),
      students: this.students.map(s => ({ id: s.id, name: s.name, team: s.team, connected: s.connected, score: sc.students.get(s.id) || 0 })),
      clue: this.clueView(),
      finalWagers: this.final ? this.final.wagers : null,
      reportReady: this.records.length > 0,
    };
  }

  // Each student sees the shared screen plus their own answer and score.
  studentView(id) {
    const sc = this.scores();
    const s = this.student(id);
    const v = this.baseView(sc);
    v.clue = this.clueView();
    if (v.clue && v.clue.stats) {
      // Students see how the class did, not the list of typed answers.
      const { groups, ...rest } = v.clue.stats;
      v.clue.stats = rest;
    }
    if (!s) return { ...v, me: null };
    const rec = this.rec;
    const mine = rec && rec.answers.get(id);
    v.me = {
      id: s.id, name: s.name, team: s.team, score: sc.students.get(id) || 0, right: sc.right.get(id) || 0,
      rank: 1 + this.students.filter(x => (sc.students.get(x.id) || 0) > (sc.students.get(id) || 0)).length,
      answer: mine ? { text: mine.text, right: rec.done ? mine.right : null } : null,
      teammates: this.members(s.team).map(x => x.name),
      finalWager: this.final && this.final.wagers[s.team] ? this.final.wagers[s.team] : null,
    };
    return v;
  }

  /* ---------- the report ---------- */

  report() {
    const recs = this.records.filter(r => r.done);
    const q = s => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [];
    const sc = this.scores();
    rows.push(['Question', 'Round', 'Category', 'Value', 'Clue', 'Answer', 'Answered', 'Right', '% right'].map(q).join(','));
    recs.forEach(r => {
      const st = this.stats(r);
      rows.push([r.n, r.round, r.cat, r.value, r.q, r.a, st.answered, st.right, st.pct].map(q).join(','));
    });
    rows.push('');
    rows.push(['Student', 'Team', 'Score', 'Right', 'Answered', ...recs.map(r => `Q${r.n}`)].map(q).join(','));
    const names = new Map(this.students.map(s => [s.id, s]));
    const ids = new Set(this.students.map(s => s.id));
    recs.forEach(r => r.answers.forEach((_, id) => ids.add(id)));
    [...ids].forEach(id => {
      const s = names.get(id);
      const team = s ? s.team : recs.map(r => r.teamOf.get(id)).find(t => t != null);
      const answered = recs.filter(r => r.answers.has(id)).length;
      const right = recs.filter(r => r.answers.has(id) && r.answers.get(id).right).length;
      const score = recs.reduce((n, r) => n + (r.answers.has(id) && r.answers.get(id).right ? r.value : 0), 0);
      const cells = recs.map(r => { const a = r.answers.get(id); return a ? `${a.right ? '✓' : '✗'} ${a.text}` : ''; });
      rows.push([s ? s.name : '(removed)', TEAM_NAMES[team] || '', score, right, answered, ...cells].map(q).join(','));
    });
    rows.push('');
    rows.push(['Team', 'Score'].map(q).join(','));
    this.teamNames().forEach((name, t) => rows.push([name, sc.teams[t]].map(q).join(',')));
    return '﻿' + rows.join('\r\n') + '\r\n';
  }
}

module.exports = { Classroom, ClassError, Bank, parseBank, parseNumber, showNumber, badName, TEAM_NAMES, TEAM_COLORS, TIMES };

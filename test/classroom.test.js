'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const WebSocket = require('ws');
const { Classroom, Bank, parseBank, parseNumber, badName } = require('../lib/classroom');
const { createServer } = require('../server');

const BANK = `# Course: TST | Test Course
# Unit: u1 | Unit One
${['A', 'B', 'C', 'D', 'E', 'F'].map(l => `## CAT ${l}
1 | Pick ${l}1 | RIGHT | WRONG1; WRONG2; WRONG3
2 | Type ${l}2 | PHOTOSYNTHESIS / PHOTO SYNTHESIS
3 | Number ${l}3 | = 3.0e8 m/s ~2%
4 | Count ${l}4 | = 12 ~0
5 | Pick ${l}5 | YES | NO`).join('\n')}
FINAL | THE END | Last one | ALPHA | BETA; GAMMA; DELTA
`;

function setup(opts = {}) {
  const bank = new Bank({ dir: '/nonexistent' });
  bank.add(parseBank(BANK, 'test.txt'));
  const timers = [];
  let now = 0;
  const g = new Classroom({
    bank, code: 'TEST', random: () => 0.3, now: () => now,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    ...opts,
  });
  const runTimer = () => { const t = timers.shift(); now = t.at; t.fn(); };
  return { g, runTimer, timers };
}

test('numbers in any notation', () => {
  assert.strictEqual(parseNumber('3e8').value, 3e8);
  assert.strictEqual(parseNumber('3.0 x 10^8 m/s').value, 3e8);
  assert.strictEqual(parseNumber('3×10⁸').value, 3e8);
  assert.strictEqual(parseNumber('300 000 000').value, 3e8);
  assert.strictEqual(parseNumber('1,500 km').value, 1500);
  assert.ok(Math.abs(parseNumber('1.5 × 10^-3').value - 0.0015) < 1e-12);
  assert.strictEqual(parseNumber('$0.96').value, 0.96);
  assert.strictEqual(parseNumber('twelve'), null);
});

test('the name filter catches rude names but not real ones', () => {
  for (const n of ['Dickson', 'Cassidy', 'Analise', 'Chloe', 'Killian', 'Nazir', 'Essex', 'Hannah']) assert.strictEqual(badName(n), false, n);
  for (const n of ['fuck', 'B1tch', 'Sexy Sam', 'ass', 'p00p']) assert.strictEqual(badName(n), true, n);
});

test('the SNC1W clue bank loads every unit', () => {
  const bank = new Bank({ dir: path.join(__dirname, '..', 'class-clues') });
  const c = bank.course('SNC1W');
  assert.ok(c, 'SNC1W course');
  assert.deepStrictEqual(c.units.map(u => u.id), ['bio', 'space', 'chem', 'elec']);
  c.units.forEach(u => {
    assert.ok(u.cats.length >= 12, `${u.id} has enough categories for two boards`);
    assert.ok(u.finals.length >= 3, `${u.id} finals`);
  });
});

test('bad clue lines are reported with their line number', () => {
  assert.throws(() => parseBank('# Course: X\n# Unit: a | A\n## C\n1 | q | = lots', 'x.txt'), /x\.txt line 4/);
  assert.throws(() => parseBank('## C\n1 | q | A', 'x.txt'), /Course/);
});

test('everyone answers; teams earn their share', () => {
  const { g, runTimer } = setup();
  g.updateSettings({ teams: 2, rounds: 1, dd: false, final: false });
  const a = g.join('Ann', 0), b = g.join('Ben', 0), c = g.join('Cy', 1);
  assert.throws(() => g.join('shit'), /real first name/);
  assert.strictEqual(g.join('ann', 1).name, 'ann 2');
  g.start();
  assert.strictEqual(g.phase, 'board');
  const picker = g.pickTeam;
  const other = g.students.find(s => s.team !== picker);
  assert.throws(() => g.choose(other.id, 0, 0), /picking/);
  g.choose(null, 0, 0);
  assert.strictEqual(g.phase, 'open');
  const ch = g.rec.choices;
  assert.strictEqual(ch.length, 4);
  assert.throws(() => g.answer(a.id, 'nonsense'), /choices/);
  g.answer(a.id, 'RIGHT');
  g.answer(b.id, 'WRONG1');
  assert.throws(() => g.answer(a.id, 'RIGHT'), /already/);
  g.answer(c.id, 'RIGHT');
  assert.strictEqual(g.phase, 'open', 'ann 2 has not answered');
  runTimer();
  assert.strictEqual(g.phase, 'reveal');
  const sc = g.scores();
  // Team 0: Ann right, Ben wrong: half of 100. Team 1: Cy right, "ann 2" silent: half.
  assert.deepStrictEqual(sc.teams, [50, 50]);
  assert.strictEqual(sc.students.get(a.id), 100);
  assert.strictEqual(sc.students.get(b.id), 0);
  const st = g.stats(g.rec);
  assert.strictEqual(st.pct, 50);
  assert.strictEqual(st.dist.find(d => d.right).count, 2);
  g.next();
  assert.strictEqual(g.phase, 'board');
  assert.notStrictEqual(g.pickTeam, picker, 'the next team picks');
});

test('typed and number answers, accepting a near miss, and the report', () => {
  const { g } = setup();
  g.updateSettings({ teams: 2, rounds: 1, dd: false, final: false });
  const a = g.join('Ann', 0), b = g.join('Ben', 1);
  g.start();
  g.choose(null, 0, 1);
  g.answer(a.id, 'what is photosynthisis');
  g.answer(b.id, 'sunlight food');
  assert.strictEqual(g.phase, 'reveal', 'closes when everyone has answered');
  assert.strictEqual(g.rec.answers.get(a.id).right, true);
  assert.strictEqual(g.rec.answers.get(b.id).right, false);
  const grp = g.stats(g.rec).groups.find(x => !x.right);
  g.accept(grp.key);
  assert.strictEqual(g.rec.answers.get(b.id).right, true);
  assert.deepStrictEqual(g.scores().teams, [200, 200]);
  g.accept(grp.key);
  assert.deepStrictEqual(g.scores().teams, [200, 0]);
  g.next();
  g.choose(null, 0, 2);
  assert.throws(() => g.answer(a.id, 'fast'), /number/);
  g.answer(a.id, '3 x 10^8');
  g.answer(b.id, '2.0e8');
  assert.strictEqual(g.rec.answers.get(a.id).right, true);
  assert.strictEqual(g.rec.answers.get(b.id).right, false);
  g.next();
  const csv = g.report();
  assert.match(csv, /"Ann","Protons","500","2","2"/);
  assert.match(csv, /"Ben","Neutrons","0","0","2"/);
  assert.match(csv, /"1","1","CAT [A-F]","200"/);
});

test('a Daily Double is a team wager; the final clue too', () => {
  const { g, runTimer } = setup();
  g.updateSettings({ teams: 2, rounds: 1, dd: true, final: true });
  const a = g.join('Ann', 0), b = g.join('Ben', 0), c = g.join('Cy', 1);
  g.start();
  const [dc, dr] = [...g.round().dds][0].split(',').map(Number);
  g.pickTeam = 0;
  g.choose(a.id, dc, dr);
  assert.strictEqual(g.phase, 'ddWager');
  assert.throws(() => g.ddWager(c.id, 100), /Only the team/);
  g.ddWager(b.id, 400);
  assert.strictEqual(g.phase, 'open');
  const right = g.rec.type === 'mc' ? g.rec.a : g.rec.type === 'num' ? String(g.rec.num.value) : 'PHOTOSYNTHESIS';
  g.answer(a.id, right);
  g.answer(b.id, g.rec.type === 'mc' ? g.rec.choices.find(x => x !== g.rec.a) : '999999');
  g.answer(c.id, right);
  // Half of Ann's team was right: they win the wager; the other team gets nothing.
  assert.deepStrictEqual(g.scores().teams, [400, 0]);
  assert.strictEqual(g.scores().students.get(c.id), g.rec.value);
  g.next();
  g.endRound();
  assert.strictEqual(g.phase, 'finalWager');
  assert.strictEqual(g.finalMax(1), 0);
  assert.throws(() => g.finalWager(c.id, null, 10), /no points/);
  g.finalWager(a.id, null, 300);
  assert.strictEqual(g.phase, 'finalClue', 'every team that can wager has');
  g.answer(a.id, 'BETA');
  g.answer(b.id, 'BETA');
  g.answer(c.id, 'ALPHA');
  assert.strictEqual(g.phase, 'finalReveal');
  assert.deepStrictEqual(g.final.order, [1, 0], 'last place first');
  g.next();
  g.next();
  assert.deepStrictEqual(g.scores().teams, [100, 0]);
  g.next();
  assert.strictEqual(g.phase, 'champ');
  assert.strictEqual(g.scores().students.get(c.id), g.records[0].value + 1000);
  const tv = g.teacherView();
  assert.strictEqual(tv.top[0].name, 'Cy');
  g.toLobby();
  assert.strictEqual(g.students.length, 3);
});

test('pause holds the clock; skipping gives no points', () => {
  const { g, timers } = setup();
  g.updateSettings({ teams: 2, rounds: 1, dd: false, final: false, secs: 20 });
  const a = g.join('Ann', 0);
  g.join('Ben', 1);
  g.start();
  g.choose(null, 1, 0);
  g.pause();
  assert.strictEqual(timers.length, 0);
  assert.ok(g.timerView().paused);
  g.answer(a.id, 'RIGHT');
  g.pause();
  assert.strictEqual(timers.length, 1);
  g.skip();
  assert.strictEqual(g.phase, 'board');
  assert.deepStrictEqual(g.scores().teams, [0, 0]);
  assert.ok(g.taken.has('1,0'));
});

test('students only see the answer after answers close', () => {
  const { g } = setup();
  g.updateSettings({ teams: 2, rounds: 1, dd: false, final: false });
  const a = g.join('Ann', 0);
  g.join('Ben', 1);
  g.start();
  g.choose(null, 2, 1);
  const v = g.studentView(a.id);
  assert.strictEqual(v.clue.a, null);
  assert.ok(!JSON.stringify(v).includes('PHOTOSYNTHESIS'));
  g.answer(a.id, 'photosynthesis');
  assert.strictEqual(g.studentView(a.id).me.answer.right, null);
});

const open = [];
function wsClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  open.push(ws);
  const inbox = [], waiters = [];
  ws.on('message', d => { const m = JSON.parse(d); inbox.push(m); waiters.slice().forEach(w => { if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } }); });
  return {
    open: () => new Promise(r => ws.once('open', r)),
    send: m => ws.send(JSON.stringify(m)),
    wait(pred) { const i = inbox.findIndex(pred); if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]); return new Promise(resolve => waiters.push({ pred, resolve })); },
    close: () => ws.close(),
  };
}

// A student on the polling fallback, as on a network that blocks WebSockets.
async function pollClient(base) {
  const { sid } = await (await fetch(`${base}/rt/open`, { method: 'POST' })).json();
  const inbox = [];
  let stop = false;
  (async () => { while (!stop) { const r = await fetch(`${base}/rt/poll?sid=${sid}`); if (!r.ok) break; inbox.push(...await r.json()); } })().catch(() => {});
  return {
    send: m => fetch(`${base}/rt/send?sid=${sid}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) }),
    async wait(pred) { for (let k = 0; k < 400; k++) { const i = inbox.findIndex(pred); if (i >= 0) return inbox.splice(i, 1)[0]; await new Promise(r => setTimeout(r, 10)); } throw new Error('timed out'); },
    close: async () => { stop = true; await fetch(`${base}/rt/close?sid=${sid}`, { method: 'POST' }); },
  };
}

test('class rooms are separate, work over polling, and give a report', async () => {
  const { server, classes } = createServer({ gameOpts: { code: 'FAMY' } });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const t1 = wsClient(port); await t1.open();
    t1.send({ t: 'hello', role: 'classTv' });
    const h1 = await t1.wait(m => m.t === 'classHost');
    const t2 = wsClient(port); await t2.open();
    t2.send({ t: 'hello', role: 'classTv' });
    const h2 = await t2.wait(m => m.t === 'classHost');
    assert.notStrictEqual(h1.code, h2.code);

    const s1 = await pollClient(base);
    s1.send({ t: 'hello', role: 'student', code: h1.code.toLowerCase(), name: 'Ann' });
    const j1 = await s1.wait(m => m.t === 'joined');
    const s2 = wsClient(port); await s2.open();
    s2.send({ t: 'hello', role: 'student', code: h2.code, name: 'Ben' });
    await s2.wait(m => m.t === 'joined');
    const bad = wsClient(port); await bad.open();
    bad.send({ t: 'hello', role: 'student', code: 'QQQQQ', name: 'Cy' });
    assert.match((await bad.wait(m => m.t === 'error')).msg, /No class/);

    // A class code typed on the family join page goes to the class page.
    const fam = wsClient(port); await fam.open();
    fam.send({ t: 'hello', role: 'phone', code: h1.code, name: 'Dee' });
    assert.strictEqual((await fam.wait(m => m.t === 'goto')).url, `/join?code=${h1.code}`);

    const v1 = await t1.wait(m => m.t === 'state' && m.view.students.length === 1);
    assert.strictEqual(v1.view.students[0].name, 'Ann');
    assert.strictEqual(classes.rooms.get(h2.code).game.students[0].name, 'Ben');

    t1.send({ t: 'settings', settings: { units: ['bio'], rounds: 1, dd: false, final: false } });
    t1.send({ t: 'start' });
    await s1.wait(m => m.t === 'state' && m.view.phase === 'board');
    s1.send({ t: 'choose', c: 0, r: 0 });
    const open = await s1.wait(m => m.t === 'state' && m.view.phase === 'open');
    const c = open.view.clue;
    assert.strictEqual(c.a, null);
    s1.send({ t: 'answer', a: c.type === 'mc' ? c.choices[0] : 'something' });
    const rev = await t1.wait(m => m.t === 'state' && m.view.phase === 'reveal');
    assert.strictEqual(rev.view.clue.stats.answered, 1);
    t1.send({ t: 'next' });
    await t1.wait(m => m.t === 'state' && m.view.phase === 'board' && m.view.reportReady);

    // Rejoining with the saved token puts the student back in their class.
    const again = wsClient(port); await again.open();
    again.send({ t: 'hello', role: 'student', token: j1.token });
    assert.strictEqual((await again.wait(m => m.t === 'joined')).code, h1.code);

    const nope = await fetch(`${base}/class/report.csv?code=${h1.code}&key=wrong`);
    assert.strictEqual(nope.status, 404);
    const rep = await fetch(`${base}/class/report.csv?code=${h1.code}&key=${h1.key}`);
    assert.strictEqual(rep.status, 200);
    assert.match(await rep.text(), /"Ann"/);

    // A refreshed teacher page gets its room back with its key.
    const t1b = wsClient(port); await t1b.open();
    t1b.send({ t: 'hello', role: 'classTv', code: h1.code, key: h1.key });
    assert.strictEqual((await t1b.wait(m => m.t === 'classHost')).code, h1.code);
    await s1.close();
  } finally {
    open.forEach(ws => ws.close());
    server.close();
    server.closeAllConnections();
  }
});

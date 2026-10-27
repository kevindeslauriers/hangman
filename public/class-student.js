// Class Board for students: join with the code on the board, then answer
// every clue from here. Built for laptops first; it works on phones too.
const S = { outbox: [], ws: null, token: null, me: null, view: null, status: 'Connecting…', toast: '', drafts: {}, needJoin: false, saved: null };
const params = new URLSearchParams(location.search);
const urlCode = (params.get('code') || '').toUpperCase();
try { S.saved = JSON.parse(localStorage.getItem('class-student') || 'null'); } catch (e) {}
// Rejoin automatically after a refresh, but not on a shared computer hours later.
if (S.saved && Date.now() - S.saved.at < 3 * 60 * 60 * 1000 && (!urlCode || urlCode === S.saved.code)) S.token = S.saved.token;
S.drafts.code = urlCode || '';

/* ---------- connection ---------- */
let retry = 0;
function connect() {
  const ws = openSocket();
  S.ws = ws;
  ws.onopen = () => {
    retry = 0; S.status = '';
    ws.send(JSON.stringify({ t: 'hello', role: 'student', token: S.token }));
    // Anything typed while still connecting (like pressing Join) goes now.
    S.outbox.splice(0).forEach(m => ws.send(m));
    render();
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'joined') {
      S.token = m.token; S.me = m.id; S.needJoin = false; S.toast = '';
      S.saved = { token: m.token, code: m.code, name: m.name, at: Date.now() };
      try { localStorage.setItem('class-student', JSON.stringify(S.saved)); } catch (e) {}
    } else if (m.t === 'needJoin') { S.needJoin = true; S.me = null; S.view = null; }
    else if (m.t === 'state') { S.view = m.view; if (S.saved) { S.saved.at = Date.now(); try { localStorage.setItem('class-student', JSON.stringify(S.saved)); } catch (e) {} } }
    else if (m.t === 'error') S.toast = m.msg;
    else if (m.t === 'kicked' || m.t === 'left' || m.t === 'closed') {
      forget();
      S.toast = m.t === 'kicked' ? 'Your teacher took you out of the game. You can join again.' : m.t === 'closed' ? 'That game has ended.' : 'You left the game.';
    }
    render();
  };
  ws.onclose = () => {
    if (S.ws !== ws) return;
    S.status = 'Lost the connection. Reconnecting…'; render();
    setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
  };
}
function forget() { S.token = null; S.me = null; S.view = null; S.needJoin = true; try { localStorage.removeItem('class-student'); } catch (e) {} }
function send(t, extra = {}) {
  S.toast = '';
  const m = JSON.stringify({ t, ...extra });
  if (S.ws && S.ws.readyState === 1) S.ws.send(m); else S.outbox.push(m);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.ws && S.ws.readyState > 1) { retry = 0; connect(); } });

/* ---------- helpers ---------- */
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'on') Object.entries(v).forEach(([ev, f]) => e.addEventListener(ev, f));
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style') e.style.cssText = v;
    else e[k] = v;
  }
  kids.flat().forEach(k => { if (k != null && k !== false) e.append(k); });
  return e;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const rich = s => esc(s).replace(/\^\(?(-?\d+)\)?/g, '<sup>$1</sup>');
const btn = (text, onclick, cls = 'btn', extra = {}) => h('button', { className: cls, textContent: text, on: { click: onclick }, ...extra });
function field(id, props = {}) {
  const on = { input: e => { S.drafts[id] = e.target.value; }, ...(props.on || {}) };
  return h('input', { className: 'field', id, autocomplete: 'off', spellcheck: false, value: S.drafts[id] || '', ...props, on });
}
const pts = n => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en-US');
const team = t => (S.view && S.view.teams[t]) || { name: '', color: '#888' };
const LETTERS = 'ABCD';

/* ---------- screens ---------- */
function render() {
  const app = document.getElementById('app');
  const act = document.activeElement, actId = act && app.contains(act) ? act.id : '';
  let selS = null, selE = null; try { selS = act.selectionStart; selE = act.selectionEnd; } catch (e) {}
  app.innerHTML = '';
  const v = S.view;
  const me = v && v.me;
  if (me) document.documentElement.style.setProperty('--team', team(me.team).color);
  app.append(h('p', { className: 'status' }, S.status));
  if (!me) app.append(joinScreen());
  else {
    app.append(topBar(v, me));
    app.append(screen(v, me));
  }
  app.append(h('p', { className: 'toast', role: 'alert' }, S.toast));
  if (me) app.append(btn('Leave the game', () => { if (confirm('Leave the game? Your points stay in the report.')) send('leave'); }, 'btn small leave'));
  if (actId) { const e = document.getElementById(actId); if (e) { e.focus(); try { if (selS != null) e.setSelectionRange(selS, selE); } catch (er) {} } }
  tickTimer();
}

function joinScreen() {
  const go = () => {
    const code = (S.drafts.code || '').trim().toUpperCase(), name = (S.drafts.name || '').trim();
    if (!code) { S.toast = 'Type the code from the board.'; return render(); }
    if (!name) { S.toast = 'Type your first name.'; return render(); }
    send('hello', { role: 'student', code, name });
  };
  const onEnter = { keydown: e => { if (e.key === 'Enter') go(); } };
  const card = h('div', { className: 'card' },
    h('h1', {}, 'Class Board'),
    h('label', { className: 'label', htmlFor: 'code' }, 'Game code (on the board)'),
    field('code', { className: 'field code', maxLength: 6, autocapitalize: 'characters', on: { input: e => { S.drafts.code = e.target.value; }, ...onEnter } }),
    h('label', { className: 'label', htmlFor: 'name' }, 'Your first name'),
    field('name', { maxLength: 14, autocomplete: 'given-name', on: { input: e => { S.drafts.name = e.target.value; }, ...onEnter } }),
    btn('Join', go, 'btn primary'),
    h('p', { className: 'hint' }, 'Use your real first name or the name your teacher asked for.'));
  if (S.saved && !S.token) {
    card.append(btn(`Rejoin as ${S.saved.name}`, () => { S.token = S.saved.token; send('hello', { role: 'student', token: S.token }); }, 'btn small'));
  }
  return card;
}

function topBar(v, me) {
  const t = team(me.team);
  return h('div', { className: 'bar' },
    h('span', { className: 'who' }, me.name),
    h('span', { className: 'tm' }, h('span', { className: 'dot' }), t.name, h('span', { className: 'sc' }, pts(t.score))),
    h('span', {}, 'You: ', h('span', { className: 'sc' }, pts(me.score)), v.phase !== 'lobby' && me.score > 0 ? h('span', { className: 'hint' }, ` · #${me.rank}`) : null));
}

function screen(v, me) {
  switch (v.phase) {
    case 'lobby': return lobby(v, me);
    case 'board': return board(v, me);
    case 'ddWager': return ddWager(v, me);
    case 'open': case 'finalClue': return answerScreen(v, me);
    case 'reveal': case 'finalReveal': return results(v, me);
    case 'roundBreak': return h('div', { className: 'card' }, h('h2', {}, 'End of the first board'), h('p', {}, 'The second board is worth double. Get ready!'), scores(v, me));
    case 'finalWager': return finalWager(v, me);
    case 'champ': return champ(v, me);
  }
  return h('div', { className: 'card' }, h('p', {}, 'Waiting…'));
}

function lobby(v, me) {
  return h('div', { className: 'card' },
    h('h2', {}, 'You’re in!'),
    h('p', {}, 'Pick your team (your table group), then wait for your teacher to start.'),
    h('div', { className: 'teams' }, v.teams.map(t => {
      const b = btn('', () => send('team', { team: t.t }), 'btn' + (t.t === me.team ? ' on' : ''));
      b.style.borderColor = t.color;
      b.append(h('span', { className: 'dot', style: `background:${t.color}` }), t.name, h('small', {}, String(t.count)));
      return b;
    })),
    h('p', { className: 'mates' }, `${team(me.team).name}: ${me.teammates.join(', ')}`));
}

function board(v, me) {
  const mine = v.pickTeam === me.team;
  const card = h('div', { className: 'card' });
  if (!mine) {
    card.append(h('h2', {}, `${team(v.pickTeam).name} are picking a clue`), h('p', { className: 'hint' }, 'Watch the board. Everyone answers every clue.'), scores(v, me));
    return card;
  }
  card.append(h('h2', {}, 'Your team picks!'), h('p', { className: 'hint' }, 'Agree with your team, then one of you taps a clue (or tell your teacher).'));
  const grid = h('div', { className: 'mini' });
  v.board.cats.forEach((cat, c) => {
    grid.append(h('div', { className: 'col' }, h('div', { className: 'h' }, cat),
      v.board.values.map((val, r) => btn(String(val), () => send('choose', { c, r }), 'btn', { disabled: v.board.taken.includes(`${c},${r}`) }))));
  });
  card.append(grid);
  return card;
}

function wagerBox(id, max, onGo, label) {
  const go = () => {
    const n = Math.round(+(S.drafts[id] || '').replace(/[^\d]/g, ''));
    if (!(n >= 0 && n <= max) || (S.drafts[id] || '') === '') { S.toast = `Wager from 0 to ${pts(max)}.`; return render(); }
    onGo(n);
  };
  return h('div', {},
    h('label', { className: 'label', htmlFor: id }, label),
    h('div', { className: 'row' }, field(id, { inputMode: 'numeric', placeholder: `0 to ${pts(max)}`, on: { input: e => { S.drafts[id] = e.target.value; }, keydown: e => { if (e.key === 'Enter') go(); } } }), btn('Lock it in', go, 'btn primary')));
}

function ddWager(v, me) {
  const c = v.clue;
  const card = h('div', { className: 'card' }, h('h1', {}, 'Daily Double!'), h('div', { className: 'cat' }, h('span', {}, c.cat)));
  if (c.dd.team === me.team) {
    card.append(h('p', {}, 'Your team found it. Agree on a wager, then one of you enters it. Your team wins the wager if at least half of you get it right, and loses it if not.'));
    card.append(wagerBox('ddw', c.dd.max, n => send('ddWager', { amount: n }), `Team wager (0 to ${pts(c.dd.max)})`));
  } else {
    card.append(h('p', {}, `${team(c.dd.team).name} are making a wager. You’ll still answer this clue for your own points.`));
  }
  return card;
}

function answerScreen(v, me) {
  const c = v.clue;
  const card = h('div', { className: 'card' });
  card.append(h('div', { className: 'cat' }, h('span', {}, c.final ? `Final clue · ${c.cat}` : c.cat), h('b', {}, c.final ? '' : c.dd ? `Daily Double` : String(c.value))));
  card.append(h('p', { className: 'q', html: rich(c.q) }));
  const mine = me.answer;
  if (c.type === 'mc') {
    card.append(h('div', { className: 'choices' }, c.choices.map((ch, i) => {
      const b = btn('', () => { if (!mine) send('answer', { a: ch }); }, 'btn choice' + (mine && mine.text === ch ? ' picked' : ''), { disabled: !!mine && mine.text !== ch });
      b.append(h('span', { className: 'k' }, LETTERS[i]), h('span', { html: rich(ch) }));
      return b;
    })));
    if (!mine) card.append(h('p', { className: 'kbd' }, 'Tip: press A, B, C or D. Your first choice is final.'));
  } else if (!mine) {
    const id = 'ans' + c.n + (c.final ? 'f' : '');
    const go = () => { const a = (S.drafts[id] || '').trim(); if (!a) { S.toast = 'Type an answer first.'; return render(); } send('answer', { a }); };
    card.append(h('div', { className: 'row' },
      field(id, { placeholder: c.type === 'num' ? `Number${c.unit ? ' (' + c.unit + ')' : ''}` : 'Your answer', inputMode: c.type === 'num' ? 'decimal' : 'text', maxLength: 80,
        on: { input: e => { S.drafts[id] = e.target.value; }, keydown: e => { if (e.key === 'Enter') go(); } } }),
      btn('Submit', go, 'btn primary')));
    card.append(h('p', { className: 'hint' }, c.type === 'num'
      ? 'For scientific notation type 3e8 or 3 x 10^8. You don’t need the unit.'
      : 'Spelling doesn’t have to be perfect. No need to write “What is…”.'));
    setTimeout(() => { const e = document.getElementById(id); if (e && !document.activeElement.closest('.row')) e.focus(); });
  }
  if (mine && c.type !== 'mc') card.append(h('p', { className: 'locked' }, 'Locked in: ', h('b', {}, mine.text)));
  if (mine) card.append(h('p', { className: 'hint' }, `Waiting for the others… ${c.answered} answered${c.waiting ? `, ${c.waiting} to go` : ''}.`));
  card.append(h('div', { className: 'row', style: 'align-items:center' }, h('div', { className: 'timer', style: 'flex:1' }, h('i', { id: 'tfill' })), h('span', { className: 'secs', id: 'tsecs' })));
  return card;
}

function results(v, me) {
  const c = v.clue;
  const card = h('div', { className: 'card' });
  card.append(h('div', { className: 'cat' }, h('span', {}, c.final ? `Final clue · ${c.cat}` : c.cat), h('b', {}, c.final ? '' : c.dd ? 'Daily Double' : String(c.value))));
  const a = me.answer;
  if (!a) card.append(h('p', { className: 'result no' }, 'No answer'));
  else if (a.right) card.append(h('p', { className: 'result ok' }, `Right! +${pts(c.value)}`));
  else card.append(h('p', { className: 'result no' }, 'Not quite'));
  card.append(h('p', { className: 'q', html: rich(c.q) }));
  card.append(h('p', { className: 'answer', html: `Answer: <b>${rich(c.a)}</b>` }));
  if (a && !a.right && c.type !== 'mc') card.append(h('p', { className: 'hint' }, `You wrote: ${a.text}`));
  if (c.type === 'mc' && a) {
    card.append(h('div', { className: 'choices' }, c.choices.map((ch, i) => {
      const right = ch === c.a;
      const b = h('div', { className: 'btn choice' + (right ? ' right' : a.text === ch ? ' wrongpick' : '') });
      b.append(h('span', { className: 'k' }, LETTERS[i]), h('span', { html: rich(ch) }));
      return b;
    })));
  }
  const st = c.stats;
  card.append(h('p', {}, `${st.pct}% of the class got it.`));
  if (v.phase === 'reveal') {
    const tr = st.teams[me.team];
    if (c.dd && c.dd.team !== me.team) card.append(h('p', { className: 'hint' }, `Only ${team(c.dd.team).name}’s team points were on the line.`));
    else if (tr) card.append(h('p', {}, `${team(me.team).name}: ${tr.right} of ${tr.n} right, `, h('b', { className: tr.pts < 0 ? 'neg' : '' }, `${tr.pts >= 0 ? '+' : ''}${pts(tr.pts)}`), ' team points.'));
  } else if (v.final && v.final.results) {
    const r = v.final.results[me.team];
    card.append(h('p', {}, r ? `${team(me.team).name}: ${r.right} of ${r.n} right, ${r.pts >= 0 ? 'won' : 'lost'} ${pts(Math.abs(r.pts))}.` : 'Watch the board for your team’s result.'));
  }
  card.append(scores(v, me));
  return card;
}

function finalWager(v, me) {
  const card = h('div', { className: 'card' }, h('h1', {}, 'Final clue'), h('div', { className: 'cat' }, h('span', {}, `Category: ${v.final.category}`)));
  const max = v.final.maxes[me.team];
  if (!max) card.append(h('p', {}, 'Your team has no points to wager, but answer anyway for your own points.'));
  else {
    card.append(h('p', {}, 'Agree on your team’s wager. Your team wins it if at least half of you get the final clue right. Anyone on the team can enter it; the last one entered counts.'));
    if (me.finalWager) card.append(h('p', { className: 'locked' }, `Your team’s wager: ${pts(me.finalWager.amount)} (entered by ${me.finalWager.by})`));
    card.append(wagerBox('fw', max, n => send('finalWager', { amount: n }), `Team wager (0 to ${pts(max)})`));
  }
  card.append(scores(v, me));
  return card;
}

function champ(v, me) {
  const ranked = v.teams.filter(t => t.count).slice().sort((a, b) => b.score - a.score);
  const place = ranked.findIndex(t => t.t === me.team) + 1;
  return h('div', { className: 'card' },
    h('h1', {}, ranked.length ? `${ranked[0].name} win!` : 'Game over'),
    h('p', {}, `${team(me.team).name} finished #${place}. You scored ${pts(me.score)} with ${me.right} right answer${me.right === 1 ? '' : 's'}.`),
    scores(v, me),
    v.top.length ? h('div', {}, h('p', { className: 'label' }, 'Top students'), h('ol', {}, v.top.map(s => h('li', {}, `${s.name} · ${pts(s.score)}`)))) : null);
}

function scores(v, me) {
  return h('div', { className: 'scores' }, v.teams.filter(t => t.count).slice().sort((a, b) => b.score - a.score).map(t =>
    h('div', { className: 't' + (t.t === me.team ? ' me' : '') }, h('span', { className: 'dot', style: `background:${t.color}` }), h('span', {}, t.name), h('b', { className: t.score < 0 ? 'neg' : '' }, pts(t.score)))));
}

/* ---------- the timer ---------- */
function tickTimer() {
  cancelAnimationFrame(S.raf);
  const v = S.view;
  const fill = document.getElementById('tfill'), secs = document.getElementById('tsecs');
  if (!v || !v.timer || !fill) return;
  if (v.timer.paused) { fill.style.transform = `scaleX(${v.timer.remaining / v.timer.total})`; secs.textContent = 'Paused'; return; }
  if (S.timerFor !== v) { S.timerFor = v; S.ends = performance.now() + v.timer.remaining; }
  const step = () => {
    const left = Math.max(0, S.ends - performance.now());
    fill.style.transform = `scaleX(${left / v.timer.total})`;
    const s = Math.ceil(left / 1000);
    secs.textContent = s;
    secs.className = 'secs' + (s <= 5 ? ' low' : '');
    if (left > 0) S.raf = requestAnimationFrame(step);
  };
  step();
}

// A, B, C, D (or 1 to 4) answer a multiple-choice clue.
document.addEventListener('keydown', e => {
  const v = S.view;
  if (!v || !v.me || !v.clue || !['open', 'finalClue'].includes(v.phase) || v.clue.type !== 'mc' || v.me.answer) return;
  if (e.target && e.target.tagName === 'INPUT') return;
  const k = e.key.toUpperCase();
  const i = 'ABCD'.indexOf(k) >= 0 ? 'ABCD'.indexOf(k) : '1234'.indexOf(k);
  if (i >= 0 && v.clue.choices[i] != null) send('answer', { a: v.clue.choices[i] });
});

render();
connect();

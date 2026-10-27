// The phone: join with the code on the TV, then play your turns from here.
const P = { ws: null, token: null, me: null, view: null, status: 'Connecting…', toast: '', drafts: {}, phase: '', needJoin: false, wasTurn: false, clock: null };
const params = new URLSearchParams(location.search);
try { P.token = localStorage.getItem('hangman-token'); } catch (e) {}
P.drafts.code = (params.get('code') || '').toUpperCase();
try { P.drafts.name = localStorage.getItem('hangman-name') || ''; } catch (e) { P.drafts.name = ''; }

/* ---------- connection ---------- */
let retry = 0;
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  P.ws = ws;
  ws.onopen = () => { retry = 0; P.status = ''; ws.send(JSON.stringify({ t: 'hello', role: 'phone', token: P.token })); render(); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'joined') {
      P.token = m.token; P.me = m.id; P.needJoin = false; P.toast = '';
      try { localStorage.setItem('hangman-token', m.token); localStorage.setItem('hangman-name', m.name); } catch (e) {}
    } else if (m.t === 'needJoin') { P.needJoin = true; P.me = null; }
    else if (m.t === 'goto') { location.href = m.url; return; }
    else if (m.t === 'state') { P.view = m.view; if (m.you) P.me = m.you; }
    else if (m.t === 'error') { P.toast = m.msg; buzz(); }
    else if (m.t === 'kicked' || m.t === 'left') {
      forget(); P.toast = m.t === 'kicked' ? 'The TV took you out of the game. Join again any time.' : 'You left the game.';
    }
    render();
  };
  ws.onclose = () => {
    if (P.ws !== ws) return;
    P.status = 'Lost the connection. Reconnecting…'; render();
    setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
  };
}
function forget() { P.token = null; P.me = null; P.needJoin = true; try { localStorage.removeItem('hangman-token'); } catch (e) {} }
function send(t, extra = {}) { P.toast = ''; if (P.ws && P.ws.readyState === 1) P.ws.send(JSON.stringify({ t, ...extra })); }
function buzz(ms = 60) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }
// Reconnect straight away when the phone wakes up.
document.addEventListener('visibilitychange', () => { if (!document.hidden && P.ws && P.ws.readyState > 1) { retry = 0; connect(); } });

/* ---------- helpers ---------- */
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'on') Object.entries(v).forEach(([ev, f]) => e.addEventListener(ev, f));
    else if (k === 'aria') e.setAttribute('aria-label', v);
    else e[k] = v;
  }
  kids.flat().forEach(k => { if (k != null && k !== false) e.append(k); });
  return e;
}
function draft(id, props) {
  return h('input', { className: 'field', id, autocomplete: 'off', spellcheck: false, value: P.drafts[id] || '', ...props, on: { input: e => { P.drafts[id] = e.target.value; } } });
}
const btn = (text, onclick, cls = 'btn', extra = {}) => h('button', { className: cls, textContent: text, on: { click: onclick }, ...extra });
const nameOf = id => ((P.view && P.view.players.find(p => p.id === id)) || {}).name || '';

/* ---------- screens ---------- */
function render() {
  const el = document.getElementById('app');
  const act = document.activeElement, actId = act && el.contains(act) ? act.id : '';
  let selS = null, selE = null; try { selS = act.selectionStart; selE = act.selectionEnd; } catch (e) {}
  const v = P.view;
  if (v && v.phase !== P.phase) { ['secret', 'secretHint', 'solve', 'fa', 'wa', 'qa', 'qw'].forEach(k => { delete P.drafts[k]; }); P.phase = v.phase; }
  const feud = !!(v && v.game === 'feud');
  const wheel = !!(v && v.game === 'wheel');
  const quiz = !!(v && v.game === 'quiz');
  // Answer Board borrows Face-Off's blue look.
  document.body.classList.toggle('feud', feud || quiz);
  document.body.classList.toggle('quiz', quiz);
  document.body.classList.toggle('wheel', wheel);
  document.getElementById('feudCss').disabled = !(feud || quiz);
  document.getElementById('wheelCss').disabled = !wheel;
  document.title = feud ? 'Family Face-Off' : wheel ? 'Spin & Solve' : quiz ? 'Answer Board' : 'Hangman';
  el.innerHTML = '';
  if (P.status) el.append(h('p', { className: 'status', textContent: P.status }));

  if (!P.me || !v) { el.append(joinScreen()); }
  else {
    const me = v.players.find(p => p.id === P.me);
    if (!me) { forget(); el.append(joinScreen()); }
    else {
      el.append(h('div', { className: 'me' }, h('span', { textContent: me.name }), h('span', {}, 'Score ', h('b', { textContent: String(me.score) }))));
      if (v.phase === 'lobby') el.append(lobbyScreen(v));
      else if (feud) el.append(...feudScreen(v));
      else if (wheel) el.append(...wheelScreen(v));
      else if (quiz) el.append(...quizScreen(v));
      else if (v.phase === 'secret') el.append(secretScreen(v));
      else if (v.phase === 'play') el.append(...playScreen(v));
      else if (v.phase === 'end') el.append(endScreen(v));
      else if (v.phase === 'champ') el.append(champScreen(v));
      if (P.toast) el.append(h('p', { className: 'toast', textContent: P.toast }));
      if (v.phase === 'lobby') el.append(btn('Leave the game', () => { if (confirm('Leave the game?')) send('leave'); }, 'btn leave'));
    }
  }
  if (actId) { const n = document.getElementById(actId); if (n) { n.focus({ preventScroll: true }); try { if (selS != null) n.setSelectionRange(selS, selE); } catch (e) {} } }

  const myTurn = !!(v && !feud && !wheel && !quiz && v.phase === 'play' && v.turnId === P.me);
  if (myTurn && !P.wasTurn) buzz([80, 60, 80]);
  P.wasTurn = myTurn;
  setClock(v);
}

function joinScreen() {
  if (!P.needJoin && P.token) return h('p', { className: 'small', textContent: 'Finding your game…' });
  const go = () => {
    const code = (P.drafts.code || '').trim(), name = (P.drafts.name || '').trim();
    if (code.length !== 4) { P.toast = 'Type the 4 letter code from the TV.'; render(); return; }
    if (!name) { P.toast = 'Type your name.'; render(); return; }
    send('hello', { role: 'phone', code, name });
  };
  const code = draft('code', { placeholder: 'ABCD', maxLength: 4, autocapitalize: 'characters', aria: 'Game code', className: 'field code' });
  const name = draft('name', { placeholder: 'Your name', maxLength: 16, autocapitalize: 'words', aria: 'Your name' });
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  return h('div', { className: 'panel' },
    h('p', { className: 'title', textContent: 'Join Hangman' }),
    h('p', { className: 'small', textContent: 'The code is on the TV.' }),
    code, name,
    P.toast ? h('p', { className: 'toast', textContent: P.toast }) : null,
    btn('Join', go, 'btn primary'));
}

function scoreList(v) {
  return h('ul', { className: 'scores' }, v.players.map(p => h('li', { className: p.id === v.turnId ? 'now' : '' },
    h('span', { textContent: (v.leaders.includes(p.id) ? '👑 ' : '') + p.name + ' ' }), h('b', { textContent: String(p.score) }))));
}

function lobbyScreen(v) {
  return h('div', { className: 'panel' },
    h('p', { className: 'title', textContent: 'You’re in!' }),
    h('p', { textContent: 'Waiting for the TV to start the game.' }),
    h('p', { className: 'small', textContent: `Playing: ${v.players.map(p => p.name).join(', ')}` }),
    v.game === 'feud' ? h('p', { className: 'small', textContent: 'Game: Family Face-Off' })
      : v.game === 'wheel' ? h('p', { className: 'small', textContent: 'Game: Spin & Solve' })
      : v.game === 'quiz' ? h('p', { className: 'small', textContent: 'Game: Answer Board' })
      : v.themeName ? h('p', { className: 'small', textContent: `Theme: ${v.themeName}` }) : null);
}

function secretScreen(v) {
  if (v.setterId !== P.me) {
    return h('div', { className: 'panel' }, scoreList(v),
      h('p', { className: 'title', textContent: `${v.setterName} is picking` }),
      h('p', { textContent: 'They’re typing a secret phrase. No peeking!' }));
  }
  const go = () => send('secret', { w: P.drafts.secret || '', h: P.drafts.secretHint || '' });
  const hint = draft('secretHint', { type: 'text', placeholder: 'Hint, like Animal (optional)', aria: 'Hint', maxLength: 40 });
  hint.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  return h('div', { className: 'panel' },
    h('p', { className: 'title', textContent: 'Your turn to pick' }),
    h('p', { textContent: 'Type a secret phrase for everyone else to guess. Only you can see this.' }),
    draft('secret', { type: 'password', placeholder: 'Word or phrase', aria: 'Secret word or phrase', maxLength: 40 }),
    hint,
    btn('Hide it and play', go, 'btn primary'),
    btn('Let the game pick one instead', () => send('secretRandom')));
}

function playScreen(v) {
  const mine = v.turnId === P.me;
  const setter = v.setterId === P.me;
  const out = [scoreList(v)];
  out.push(h('p', { className: 'turn' + (mine ? ' mine' : ''), textContent: mine ? 'Your turn!' : setter ? 'Watch them guess your phrase' : `${nameOf(v.turnId)}’s turn` }));
  out.push(h('p', { className: 'clock', id: 'clock' }));
  if (v.hint) out.push(h('p', { className: 'hint', style: 'margin:0', textContent: `Hint: ${v.hint}` }));
  out.push(wordBoxes(v.word));
  out.push(h('p', { className: 'msg', textContent: v.msg }));
  if (mine && v.solving) {
    const solve = () => { const a = (P.drafts.solve || '').trim(); if (!a) return; P.drafts.solve = ''; send('solve', { a }); };
    const inp = draft('solve', { type: 'text', placeholder: 'Type the whole answer', aria: 'Your answer', autocapitalize: 'characters' });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); solve(); } });
    setTimeout(() => { if (document.getElementById('solve') && document.activeElement.id !== 'solve') document.getElementById('solve').focus(); }, 0);
    out.push(h('div', { className: 'row' }, inp, btn('Lock it in', solve, 'btn primary')), btn('Never mind', () => send('solveCancel')));
    return out;
  }
  out.push(h('div', { className: 'keys' + (mine ? '' : ' off') }, [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(L => {
    const hit = v.hits.includes(L), miss = v.misses.includes(L);
    const b = h('button', { className: 'key' + (hit ? ' hit' : miss ? ' miss' : ''), textContent: L, aria: L, disabled: !mine || hit || miss });
    b.onclick = () => { b.classList.add('pending'); send('guess', { l: L }); };
    return b;
  })));
  out.push(h('p', { className: 'status', textContent: `${v.left} ${v.left === 1 ? 'guess' : 'guesses'} left` }));
  if (mine) out.push(btn('Solve it', () => send('solveStart'), 'btn solve'));
  else if (v.solving) out.push(h('p', { className: 'small', textContent: `${nameOf(v.turnId)} is typing a solve…` }));
  return out;
}

// Blanks as underlined boxes, sized so the longest word fits the screen.
function wordBoxes(word) {
  const words = word.split(' ');
  const longest = Math.max(...words.map(w => w.length));
  const width = Math.min(window.innerWidth, 560) - 32;
  const fs = Math.max(14, Math.min(34, width / (longest * 0.94 + 0.2)));
  return h('div', { className: 'word', style: `--fs:${fs}px`, aria: `${word.replace(/[^A-Z_]/g, '').length} letters` },
    words.map(w => h('span', { className: 'w' }, [...w].map(ch => h('span', {
      className: 'l' + (ch !== '_' && !/[A-Z]/.test(ch) ? ' punct' : ''),
      textContent: ch === '_' ? '' : ch,
    })))));
}

function endScreen(v) {
  const E = v.end, S = E.show;
  const kids = [h('p', { className: 'title', textContent: E.title }), h('p', { textContent: E.text }), h('p', { className: 'big-word', textContent: E.word })];
  if (S) {
    if (S.performerId === P.me) {
      kids.push(h('h3', { textContent: 'Showtime! Your challenge:', style: 'margin:.4em 0 0;color:var(--yellow);font-weight:400' }), h('p', { className: 'show-prompt', textContent: S.prompt }));
      if (!S.done && !S.voted.length) kids.push(btn('Different challenge', () => send('swap')));
      if (!S.done) kids.push(h('p', { className: 'small', textContent: `${S.voted.length} of ${S.voters.length} voted so far.` }));
    } else {
      kids.push(h('h3', { textContent: `Showtime for ${S.performerName}`, style: 'margin:.4em 0 0;color:var(--yellow);font-weight:400' }), h('p', { className: 'show-prompt', textContent: S.prompt }));
      if (!S.done && !S.voted.includes(P.me)) {
        kids.push(h('p', { className: 'small', textContent: 'When they’re done, vote:' }));
        [[1, 'Polite clap +1'], [2, 'Big cheer +2'], [3, 'Standing ovation +3']].forEach(([pts, t]) => kids.push(btn(t, () => send('vote', { pts }), 'btn clap')));
      } else if (!S.done) kids.push(h('p', { className: 'small', textContent: `Thanks! ${S.voted.length} of ${S.voters.length} voted.` }));
    }
    if (S.result) kids.push(h('p', { className: 'show-result', textContent: S.result }));
  }
  kids.push(btn(E.champion ? 'See who won' : 'Next round', () => send('next'), 'btn primary'));
  return h('div', { className: 'panel' }, kids);
}

function champScreen(v) {
  return h('div', { className: 'panel' },
    h('p', { className: 'title', textContent: v.champ.title }),
    h('ol', { className: 'podium' }, v.champ.rows.map(r => h('li', { textContent: `${r.name}: ${r.score}` }))),
    btn('Rematch', () => send('rematch'), 'btn primary'));
}

/* ---------- shot clock ---------- */
function setClock(v) {
  P.clock = v && v.timer && (v.phase === 'play' || v.game === 'feud' || v.game === 'wheel' || v.game === 'quiz') ? { mode: v.timer.mode, end: Date.now() + v.timer.remaining } : null;
  tick();
}
function tick() {
  const c = document.getElementById('clock'); if (!c) return;
  if (!P.clock) { c.textContent = ''; return; }
  const sec = Math.ceil(Math.max(0, P.clock.end - Date.now()) / 1000);
  c.textContent = (P.clock.mode === 'solve' ? 'Answer in ' : '⏱ ') + sec;
  c.classList.toggle('low', sec <= 5);
}
setInterval(tick, 250);

render();
connect();

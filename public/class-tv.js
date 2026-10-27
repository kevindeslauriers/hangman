// Class Board on the teacher's computer (and the projector): the lobby, the
// board, each clue with live answer counts, the results and the report.
const $ = s => document.querySelector(s);
const V = { view: null, ws: null, code: '', key: '', phase: '', clock: null, clueKey: '', boardKey: '', revealKey: '' };
try { const saved = JSON.parse(localStorage.getItem('class-host') || 'null'); if (saved) { V.code = saved.code; V.key = saved.key; } } catch (e) {}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const pts = n => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en-US');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// "3 × 10^8" and "cm^3" show as superscripts.
const rich = s => esc(s).replace(/\^\(?(-?\d+)\)?/g, '<sup>$1</sup>');
const team = t => (V.view && V.view.teams[t]) || { name: '', color: '#888' };
const LETTERS = 'ABCD';

/* ---------- connection ---------- */
let retry = 0;
function connect() {
  const ws = openSocket();
  V.ws = ws;
  ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: 'hello', role: 'classTv', code: V.code, key: V.key })); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'classHost') {
      V.code = m.code; V.key = m.key;
      try { localStorage.setItem('class-host', JSON.stringify({ code: m.code, key: m.key })); } catch (e) {}
      $('#ovConnect').hidden = true;
      setJoin();
    } else if (m.t === 'state') render(m.view);
    else if (m.t === 'fx') onFx(m);
    else if (m.t === 'error') toast(m.msg);
    else if (m.t === 'closed') { V.closed = true; try { localStorage.removeItem('class-host'); } catch (e) {} $('#ovClosed').hidden = false; }
  };
  ws.onclose = () => {
    if (V.ws !== ws || V.closed) return;
    $('#ovConnect').hidden = false;
    $('#connectText').textContent = 'Lost the game server. Reconnecting…';
    setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
  };
}
function cmd(t, extra = {}) { if (V.ws && V.ws.readyState === 1) V.ws.send(JSON.stringify({ t, ...extra })); }
function toast(text) {
  if (!$('#ovLobby').hidden) $('#lobbyErr').textContent = text;
  else { $('#msg').textContent = text; clearTimeout(V.toastT); V.toastT = setTimeout(() => { $('#msg').textContent = ''; }, 5000); }
  const c = $('#cTools'); if (!$('#clue').hidden && c) { const p = el('p', 'err', text); c.append(p); setTimeout(() => p.remove(), 4000); }
}

function setJoin() {
  const url = `${location.host}/join`;
  $('#lobbyUrl').textContent = url;
  $('#joinUrl').textContent = url;
  $('#lobbyCode').textContent = V.code;
  $('#joinCode').textContent = V.code;
  const qr = `/class/qr.svg?code=${V.code}`;
  if ($('#lobbyQr').getAttribute('src') !== qr) { $('#lobbyQr').src = qr; $('#joinQr').src = qr; }
}

/* ---------- board and sidebar ---------- */
function renderBoard(v) {
  const b = $('#qboard');
  if (!v.board) { b.innerHTML = ''; V.boardKey = ''; return; }
  const key = v.round + v.board.cats.join('|');
  if (V.boardKey !== key) {
    V.boardKey = key;
    b.innerHTML = '';
    v.board.cats.forEach(c => { const h = el('div', 'qcell'); h.append(el('span', 'qcat', c)); b.append(h); });
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) {
      const cell = el('div', 'qcell');
      cell.dataset.k = `${c},${r}`;
      cell.append(el('span', 'qval', String(v.board.values[r])));
      cell.onclick = () => { if (V.phase === 'board' && !cell.classList.contains('gone')) { unlockFeudAudio(); cmd('choose', { c, r }); } };
      b.append(cell);
    }
    const cells = [...b.querySelectorAll('[data-k]')];
    cells.forEach(c => { c.style.opacity = 0; });
    cells.slice().sort(() => Math.random() - 0.5).forEach((c, i) => setTimeout(() => { c.style.opacity = ''; c.classList.add('pop'); }, 40 * i));
  }
  b.querySelectorAll('[data-k]').forEach(cell => cell.classList.toggle('gone', v.board.taken.includes(cell.dataset.k)));
}

function renderSide(v) {
  const box = $('#teams');
  box.innerHTML = '';
  v.teams.forEach(t => {
    const row = el('div', 'team' + (v.phase === 'board' && v.pickTeam === t.t ? ' pick' : ''));
    const sw = el('span', 'sw'); sw.style.background = t.color;
    const nm = el('span', 'nm', t.name); nm.append(el('small', '', `${t.count} student${t.count === 1 ? '' : 's'}`));
    row.append(sw, nm, el('span', 'sc' + (t.score < 0 ? ' neg' : ''), pts(t.score)));
    box.append(row);
  });
  const top = $('#top3');
  top.innerHTML = '';
  if (!v.top.length) top.append(el('li', '', 'No points yet'));
  v.top.forEach((s, i) => {
    const li = el('li');
    li.append(el('span', 'medal', String(i + 1)), el('span', 'n', s.name), el('span', 's', pts(s.score)));
    li.querySelector('.n').style.color = team(s.team).color;
    top.append(li);
  });
}

/* ---------- the class list ---------- */
function renderRoster(box, v) {
  box.innerHTML = '';
  v.teams.forEach(t => {
    const col = el('div', 'rteam');
    col.style.borderColor = t.color;
    const h = el('h4'); h.append(el('span', '', t.name), el('span', '', String(t.count)));
    h.style.color = t.color;
    const chips = el('div', 'chips');
    v.students.filter(s => s.team === t.t).forEach(s => {
      const c = el('button', 'chip' + (s.connected ? '' : ' away'), s.name);
      c.onclick = e => studentMenu(s, e);
      chips.append(c);
    });
    col.append(h, chips);
    box.append(col);
  });
}

function studentMenu(s, e) {
  closeMenu();
  const m = el('div', 'menu');
  m.append(el('b', '', s.name));
  const row = el('div', 'row');
  V.view.teams.forEach(t => {
    if (t.t === s.team) return;
    const b = el('button', 'btn', '→ ' + t.name);
    b.style.borderColor = t.color;
    b.onclick = () => { cmd('move', { id: s.id, team: t.t }); closeMenu(); };
    row.append(b);
  });
  const act = el('div', 'row');
  const rn = el('button', 'btn', 'Rename');
  rn.onclick = () => { const n = prompt(`New name for ${s.name}`, s.name); if (n) cmd('rename', { id: s.id, name: n }); closeMenu(); };
  const rm = el('button', 'btn red', 'Remove');
  rm.onclick = () => { if (confirm(`Remove ${s.name} from the game?`)) cmd('kick', { id: s.id }); closeMenu(); };
  const x = el('button', 'btn', 'Cancel');
  x.onclick = closeMenu;
  act.append(rn, rm, x);
  m.append(el('small', '', 'Move to'), row, act);
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(innerWidth - r.width - 8, e.clientX) + 'px';
  m.style.top = Math.min(innerHeight - r.height - 8, e.clientY) + 'px';
  V.menu = m;
}
function closeMenu() { if (V.menu) V.menu.remove(); V.menu = null; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

/* ---------- lobby ---------- */
function renderLobby(v) {
  setJoin();
  $('#rosterTitle').textContent = `Students (${v.students.length})`;
  renderRoster($('#lobbyRoster'), v);
  const st = v.settings;
  const course = v.courses.find(c => c.id === st.course);
  const sel = $('#course');
  if (sel.options.length !== v.courses.length) {
    sel.innerHTML = '';
    v.courses.forEach(c => sel.append(new Option(`${c.id}: ${c.title}`, c.id)));
  }
  sel.value = st.course;
  $('#courseRow').hidden = v.courses.length < 2;
  const units = $('#units');
  const key = st.course + '|' + st.units.join(',');
  if (V.unitKey !== key) {
    V.unitKey = key;
    units.innerHTML = '';
    (course ? course.units : []).forEach(u => {
      const l = el('label', 'choice');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = st.units.includes(u.id);
      cb.onchange = () => {
        const ids = [...units.querySelectorAll('input')].map((x, i) => x.checked && course.units[i].id).filter(Boolean);
        cmd('settings', { settings: { units: ids } });
      };
      l.append(cb, ` ${u.title} `, el('small', '', `(${u.cats} categories)`));
      units.append(l);
    });
  }
  $('#teamsN').value = String(st.teams);
  $('#rounds').value = String(st.rounds);
  $('#secs').value = String(st.secs);
  $('#dd').checked = st.dd;
  $('#final').checked = st.final;
}
$('#course').onchange = e => cmd('settings', { settings: { course: e.target.value } });
$('#teamsN').onchange = e => cmd('settings', { settings: { teams: +e.target.value } });
$('#rounds').onchange = e => cmd('settings', { settings: { rounds: +e.target.value } });
$('#secs').onchange = e => cmd('settings', { settings: { secs: +e.target.value } });
$('#dd').onchange = e => cmd('settings', { settings: { dd: e.target.checked } });
$('#final').onchange = e => cmd('settings', { settings: { final: e.target.checked } });
$('#balance').onclick = () => cmd('balance');
$('#newClass').onclick = () => {
  if (!confirm('Start a new class with a new code? Everyone here is signed out of this game.')) return;
  try { localStorage.removeItem('class-host'); } catch (e) {}
  location.reload();
};
$('#startGame').onclick = () => { $('#lobbyErr').textContent = ''; unlockFeudAudio(); cmd('start'); };

/* ---------- the clue screen ---------- */
function btn(text, f, cls = 'btn') { const b = el('button', cls, text); b.onclick = f; return b; }

function renderClue(v) {
  const c = v.clue;
  const box = $('#clue');
  const showing = c && ['ddWager', 'open', 'reveal', 'finalWager', 'finalClue', 'finalReveal'].includes(v.phase);
  if (!showing) { box.hidden = true; V.clueKey = ''; return; }
  const key = `${c.n}|${c.final}`;
  if (box.hidden || V.clueKey !== key) {
    V.clueKey = key;
    V.revealKey = '';
    box.hidden = false;
    box.classList.remove('zoom'); void box.offsetWidth; box.classList.add('zoom');
  }
  $('#cCat').textContent = c.final ? `Final clue · ${c.cat}` : c.cat;
  $('#cVal').textContent = c.final ? '' : c.dd ? `Daily Double · ${team(c.dd.team).name}` : String(c.value);
  const body = $('#cBody');
  const tools = $('#cTools');
  // Keep wagers being typed when the screen redraws.
  const kept = {};
  body.querySelectorAll('input[data-id]').forEach(i => { kept[i.dataset.id] = i.value; });
  const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
  setTimeout(() => body.querySelectorAll('input[data-id]').forEach(i => {
    if (kept[i.dataset.id]) i.value = kept[i.dataset.id];
    if (focus === i.dataset.id) i.focus();
  }));
  body.innerHTML = '';
  tools.innerHTML = '';
  $('#cQ').innerHTML = c.q ? rich(c.q) : '';
  $('#cQ').classList.toggle('long', (c.q || '').length > 110);
  box.classList.toggle('done', !!c.stats);
  $('#cFoot').hidden = !['open', 'finalClue', 'ddWager', 'finalWager'].includes(v.phase);

  if (v.phase === 'ddWager') {
    body.append(el('div', 'dd', 'DAILY DOUBLE'));
    body.append(el('p', 'big', `${team(c.dd.team).name}: agree on a wager from 0 to ${pts(c.dd.max)}, then one of you enters it.`));
    const row = el('div', 'wrow');
    const inp = el('input', 'field'); inp.type = 'number'; inp.min = 0; inp.max = c.dd.max; inp.placeholder = 'Wager'; inp.dataset.id = 'dd';
    row.append(inp, btn('Enter for them', () => cmd('ddWager', { amount: +inp.value })));
    body.append(row);
    tools.append(btn('Skip this clue', () => cmd('skip')), pauseBtn(v));
    countLine(v, '');
    return;
  }
  if (v.phase === 'finalWager') {
    body.append(el('p', 'big', `Final category: ${v.final.category}. Each team agrees on a wager; one member enters it.`));
    const grid = el('div', 'fteams');
    activeTeams(v).forEach(t => {
      const card = el('div', 'ft'); card.style.borderColor = t.color;
      card.append(el('div', 'nm', t.name), el('div', 'st', `Score ${pts(t.score)} · can wager up to ${pts(v.final.maxes[t.t])}`));
      const w = v.finalWagers && v.finalWagers[t.t];
      card.append(el('div', 'st', w ? `✓ Wager in (${w.by})` : v.final.maxes[t.t] ? 'Waiting…' : 'No points to wager'));
      if (v.final.maxes[t.t]) {
        const row = el('div', 'wrow');
        const inp = el('input', 'field'); inp.type = 'number'; inp.min = 0; inp.max = v.final.maxes[t.t]; inp.placeholder = 'Wager'; inp.dataset.id = 'fw' + t.t;
        row.append(inp, btn('Set', () => cmd('finalWager', { team: t.t, amount: +inp.value })));
        card.append(row);
      }
      grid.append(card);
    });
    body.append(grid);
    tools.append(btn('Show the final clue', () => cmd('next'), 'btn primary'), pauseBtn(v));
    countLine(v, '');
    return;
  }

  const open = ['open', 'finalClue'].includes(v.phase);
  if (c.type === 'mc') body.append(choiceGrid(c));
  else if (open) body.append(el('p', 'hint', c.type === 'num' ? `Type a number${c.unit ? ' in ' + c.unit.replace(/\^(\d)/g, '^$1') : ''}. Use 3e8 or 3 x 10^8 for scientific notation.` : 'Type your answer on your device. Spelling doesn’t have to be perfect.'));

  if (open) {
    countLine(v, c);
    tools.append(btn('Close answers now', () => cmd('close'), 'btn primary'), pauseBtn(v));
    if (!c.final) tools.append(btn('Skip this clue', () => { if (confirm('Skip this clue? No points are given.')) cmd('skip'); }));
    return;
  }

  // Results
  const st = c.stats;
  const a = el('div', 'ca'); a.innerHTML = rich(c.a);
  body.prepend(a);
  const pct = el('p', 'pct'); pct.innerHTML = `<b>${st.pct}%</b> of the class got it · ${st.right} of ${st.n}`;
  body.append(pct);
  if (v.phase === 'reveal') body.append(teamResults(v, st, c));
  if (c.type !== 'mc' && st.groups && st.groups.length) body.append(groupList(c, v.phase === 'finalReveal' && v.final.shown > 0));
  if (v.phase === 'finalReveal') body.append(finalTeams(v));
  if (v.phase === 'reveal') tools.append(btn('Back to the board', () => cmd('next'), 'btn primary'));
  if (v.phase === 'finalReveal') tools.append(btn(v.final.shown < v.final.order.length ? `Reveal ${team(v.final.order[v.final.shown]).name}` : 'Final scores', () => cmd('next'), 'btn primary'));
  const rk = `${c.n}|${v.phase}`;
  if (V.revealKey !== rk && v.phase === 'reveal') { V.revealKey = rk; requestAnimationFrame(() => body.querySelectorAll('.fill').forEach(f => { f.style.width = f.dataset.w; })); }
  else body.querySelectorAll('.fill').forEach(f => { f.style.transition = 'none'; f.style.width = f.dataset.w; });
}

function activeTeams(v) { return v.teams.filter(t => t.count > 0 || (v.final && v.final.order.includes(t.t))); }

function pauseBtn(v) {
  const paused = v.timer && v.timer.paused;
  return btn(paused ? 'Resume' : 'Pause', () => cmd('pause'));
}

function choiceGrid(c) {
  const g = el('div', 'choices');
  const st = c.stats;
  const most = st ? Math.max(1, ...st.dist.map(d => d.count)) : 1;
  c.choices.forEach((ch, i) => {
    const d = st ? st.dist[i] : null;
    const box = el('div', 'ch' + (d ? (d.right ? ' right' : ' dim') : ''));
    const fill = el('span', 'fill');
    if (d) fill.dataset.w = `${Math.round(100 * d.count / Math.max(1, st.answered))}%`;
    const t = el('span', 't'); t.innerHTML = rich(ch);
    box.append(fill, el('span', 'k', LETTERS[i]), t);
    if (d) box.append(el('span', 'cnt', String(d.count)));
    g.append(box);
  });
  return g;
}

function teamResults(v, st, c) {
  const box = el('div', 'tres');
  st.teams.forEach((r, t) => {
    if (!r.n && !(c.dd && c.dd.team === t)) return;
    if (c.dd && c.dd.team !== t) return;
    const card = el('div', 'tr'); card.style.borderColor = team(t).color;
    card.append(el('div', 'nm', team(t).name), el('div', 'r', `${r.right} of ${r.n} right`));
    card.append(el('div', 'p' + (r.pts > 0 ? ' pos' : r.pts < 0 ? ' neg' : ''), (r.pts > 0 ? '+' : '') + pts(r.pts)));
    box.append(card);
  });
  if (c.dd) box.append(el('p', 'hint', `Wager ${pts(c.dd.wager)}: the team wins it if at least half of its members are right.`));
  return box;
}

// Typed answers grouped, so the teacher can accept a near miss for everyone who wrote it.
function groupList(c, locked) {
  const box = el('div', 'groups');
  c.stats.groups.forEach(g => {
    const p = el('span', 'grp' + (g.right ? ' right' : ''));
    p.append(el('span', '', `${g.right ? '✓' : '✗'} ${g.text}`), el('b', '', `×${g.count}`));
    if (!locked && (!g.right || g.accepted)) p.append(btn(g.accepted ? 'Undo' : 'Accept', () => cmd('accept', { key: g.key })));
    box.append(p);
  });
  return box;
}

function finalTeams(v) {
  const grid = el('div', 'fteams');
  v.final.order.forEach((t, i) => {
    const r = v.final.results && v.final.results[t];
    const card = el('div', 'ft' + (r ? '' : ' hide')); card.style.borderColor = team(t).color;
    card.append(el('div', 'nm', team(t).name));
    if (r) {
      card.append(el('div', 'st res', `${r.right} of ${r.n} right · wagered ${pts(r.wager)}`));
      card.append(el('div', 'p', (r.pts >= 0 ? '+' : '') + pts(r.pts)));
    } else card.append(el('div', 'st', 'Still to come'));
    grid.append(card);
  });
  return grid;
}

function countLine(v, c) {
  const n = v.clue.answered + v.clue.waiting;
  $('#cCount').innerHTML = c ? `<b>${v.clue.answered}</b> of ${n} answered` : '';
  $('#ansFill').parentNode.hidden = !c;
  $('#ansFill').style.transform = `scaleX(${n ? v.clue.answered / n : 0})`;
}

/* ---------- the timer ---------- */
function startClock(timer) {
  cancelAnimationFrame(V.raf);
  if (!timer) { $('#cClock').textContent = ''; $('#timeFill').style.transform = 'scaleX(0)'; return; }
  const ends = performance.now() + timer.remaining;
  if (timer.paused) {
    $('#cClock').textContent = 'Paused';
    $('#cClock').className = 'clock paused';
    $('#timeFill').style.transform = `scaleX(${timer.remaining / timer.total})`;
    return;
  }
  let lastSec = null;
  const tick = () => {
    const left = Math.max(0, ends - performance.now());
    const s = Math.ceil(left / 1000);
    $('#cClock').textContent = s;
    $('#cClock').className = 'clock' + (s <= 5 ? ' low' : '');
    $('#timeFill').style.transform = `scaleX(${left / timer.total})`;
    if (s !== lastSec && s <= 5 && s > 0 && lastSec != null && ['open', 'finalClue'].includes(V.phase)) playSound('tick');
    lastSec = s;
    if (left > 0) V.raf = requestAnimationFrame(tick);
  };
  tick();
}

/* ---------- render ---------- */
function render(v) {
  const prev = V.phase;
  V.view = v;
  V.phase = v.phase;
  const rd = v.rounds ? (v.phase === 'finalWager' || v.phase === 'finalClue' || v.phase === 'finalReveal' ? 'Final clue' : v.phase === 'champ' ? 'Game over' : `Board ${v.round} of ${v.rounds}`) : '';
  $('#roundInfo').textContent = rd;
  $('#btnEnd').hidden = !['board', 'reveal'].includes(v.phase);
  $('#btnReport').hidden = !v.reportReady;
  $('#btnLobby').hidden = v.phase === 'lobby';
  $('#ovLobby').hidden = v.phase !== 'lobby';
  $('#ovRound').hidden = v.phase !== 'roundBreak';
  $('#ovChamp').hidden = v.phase !== 'champ';
  if (v.phase === 'lobby') renderLobby(v);
  if (!$('#ovRoster').hidden) renderRoster($('#gameRoster'), v);
  renderBoard(v);
  renderSide(v);
  renderClue(v);
  startClock(['open', 'finalClue', 'ddWager', 'finalWager'].includes(v.phase) ? v.timer : null);
  if (v.phase === 'champ') renderChamp(v, prev !== 'champ');
  if (v.phase === 'lobby' && prev && prev !== 'lobby') { V.boardKey = ''; confettiStop(); }
}

function renderChamp(v, entering) {
  const teams = activeTeams(v).slice().sort((a, b) => b.score - a.score);
  $('#champTitle').textContent = teams.length ? `${teams[0].name} win!` : 'Game over';
  const pod = $('#podium');
  pod.innerHTML = '';
  teams.forEach(t => { const li = el('li'); li.append(el('span', '', t.name), el('b', '', pts(t.score))); li.style.color = t.color; pod.append(li); });
  const p2 = $('#podium2');
  p2.innerHTML = '';
  v.top.forEach(s => { const li = el('li'); li.append(el('span', '', s.name), el('b', '', pts(s.score))); p2.append(li); });
  if (entering) confetti(true);
}
function confettiStop() { const c = $('#confetti'); c.getContext('2d').clearRect(0, 0, c.width, c.height); }

function onFx(m) {
  switch (m.kind) {
    case 'board': playSound('quiz-board', 0.2); break;
    case 'pick': playSound('quiz-pick'); break;
    case 'dd': playSound('quiz-dailydouble'); break;
    case 'reveal': playSound(m.pct >= 50 ? 'quiz-right' : 'quiz-wrong'); break;
    case 'roundBreak': playSound('quiz-roundbreak'); break;
    case 'final': playSound('quiz-final'); break;
    case 'finalClosed': hushSounds(); playSound('quiz-timesup'); break;
    case 'finalTeam': playSound(m.won ? 'quiz-right' : 'quiz-wrong'); break;
    case 'champ': setTimeout(() => playSound('quiz-champ'), 300); break;
    case 'join': playSound('join'); break;
    case 'open': if (V.view && V.view.clue && V.view.clue.final) setTimeout(() => playSound('quiz-think'), 600); break;
  }
}

/* ---------- buttons ---------- */
const report = () => { location.href = `/class/report.csv?code=${encodeURIComponent(V.code)}&key=${encodeURIComponent(V.key)}`; };
$('#btnReport').onclick = report;
$('#champReport').onclick = report;
$('#btnEnd').onclick = () => { if (confirm('End this board now? Unplayed clues are skipped.')) cmd('endRound'); };
$('#btnLobby').onclick = () => {
  if (V.phase !== 'champ' && !confirm('Stop this game and go back to the lobby? Download the report first if you want it. Students stay joined.')) return;
  cmd('lobby');
};
$('#newGame').onclick = () => cmd('lobby');
$('#nextRound').onclick = () => cmd('next');
$('#btnRoster').onclick = () => { $('#ovRoster').hidden = false; if (V.view) renderRoster($('#gameRoster'), V.view); };
$('#closeRoster').onclick = () => { $('#ovRoster').hidden = true; closeMenu(); };
FS.voice = false;
loadCustomSounds();
$('#btnSound').onclick = () => {
  FS.on = FX.on = !FS.on;
  $('#btnSound').textContent = FS.on ? 'Sound on' : 'Sound off';
  if (FS.on) { unlockFeudAudio(); playSound('quiz-right'); } else hushSounds();
};
$('#btnFull').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch (e) { $('#btnFull').textContent = 'Use your browser’s full screen'; }
};
if (!document.fullscreenEnabled) $('#btnFull').hidden = true;
document.addEventListener('pointerdown', () => unlockFeudAudio(), { once: true });
connect();

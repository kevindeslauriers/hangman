// Answer Board on the TV: the board, the clue screen and the podiums.
const $ = s => document.querySelector(s);
const V = { view: null, hostKey: null, ws: null, phase: '', code: '', clock: null, clueKey: '' };
try { V.hostKey = localStorage.getItem('hangman-host'); } catch (e) {}
const money = n => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const nameOf = id => ((V.view && V.view.players.find(p => p.id === id)) || {}).name || '';
const PAGES = { hangman: '/tv', feud: '/feud-tv', wheel: '/wheel-tv', quiz: '/quiz-tv' };

/* ---------- connection (the same handshake as the other TVs) ---------- */
let retry = 0;
function connect(takeover) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  V.ws = ws;
  ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: 'hello', role: 'tv', hostKey: V.hostKey, takeover: !!takeover })); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'host') { V.hostKey = m.hostKey; try { localStorage.setItem('hangman-host', m.hostKey); } catch (e) {} $('#ovBusy').hidden = true; $('#ovConnect').hidden = true; }
    else if (m.t === 'busy') { $('#ovConnect').hidden = true; $('#ovBusy').hidden = false; }
    else if (m.t === 'replaced') { V.replaced = true; $('#ovBusy').hidden = false; $('#ovBusy h2').textContent = 'The game moved to another screen'; }
    else if (m.t === 'state') {
      if (m.view.game !== 'quiz') { V.leaving = true; location.replace(PAGES[m.view.game] || '/tv'); return; }
      render(m.view);
    }
    else if (m.t === 'fx') onFx(m);
    else if (m.t === 'error') toast(m.msg);
  };
  ws.onclose = () => {
    if (V.ws !== ws || V.replaced || V.leaving) return;
    $('#ovConnect').hidden = false;
    $('#connectText').textContent = 'Lost the game server. Reconnecting…';
    setTimeout(() => connect(false), Math.min(8000, 500 * 2 ** retry++));
  };
}
function cmd(t, extra = {}) { if (V.ws && V.ws.readyState === 1) V.ws.send(JSON.stringify({ t, ...extra })); }
$('#takeover').onclick = () => { V.replaced = false; $('#ovBusy').hidden = true; if (V.ws) { V.ws.onclose = null; V.ws.close(); } connect(true); };
function toast(text) { if (V.phase === 'lobby') $('#lobbyErr').textContent = text; else $('#msg').textContent = text; }

/* ---------- board ---------- */
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
      const val = el('span', 'qval', money(v.board.values[r]));
      cell.append(val);
      // The TV can pick for someone who's stuck.
      cell.onclick = () => { if (V.phase === 'board' && !cell.classList.contains('gone')) cmd('choose', { c, r }); };
      b.append(cell);
    }
    fillAnimation();
  }
  b.querySelectorAll('[data-k]').forEach(cell => cell.classList.toggle('gone', v.board.taken.includes(cell.dataset.k)));
}
// Values pop onto the board in a random order, like the show.
function fillAnimation() {
  const cells = [...$('#qboard').querySelectorAll('[data-k] .qval')];
  cells.forEach(c => { c.style.visibility = 'hidden'; });
  const order = cells.map((c, i) => i).sort(() => Math.random() - 0.5);
  order.forEach((i, k) => setTimeout(() => { cells[i].style.visibility = ''; cells[i].parentElement.classList.add('pop'); }, 300 + k * 45));
  playSound('quiz-board', 0.3);
}

/* ---------- the clue screen ---------- */
function renderClue(v) {
  const box = $('#clue');
  const c = v.clue, f = v.final;
  const show = ['reading', 'open', 'answering', 'reveal', 'ddWager', 'ddAnswer', 'roundBreak', 'finalWager', 'finalClue', 'finalReveal'].includes(v.phase);
  box.hidden = !show;
  if (!show) { V.clueKey = ''; return; }
  const key = c ? `${c.c},${c.r}` : v.phase.startsWith('final') ? 'final' : v.phase;
  if (key !== V.clueKey) {
    V.clueKey = key;
    // Zoom out of the cell that was picked.
    const cell = c && document.querySelector(`#qboard [data-k="${c.c},${c.r}"]`);
    if (cell) {
      const r = cell.getBoundingClientRect();
      box.style.setProperty('--ox', `${r.left + r.width / 2}px`);
      box.style.setProperty('--oy', `${r.top + r.height / 2}px`);
    } else { box.style.setProperty('--ox', '50%'); box.style.setProperty('--oy', '50%'); }
    box.classList.remove('zoom'); void box.offsetWidth; box.classList.add('zoom');
  }
  let cat = '', q = '', open = '', who = '', whoCls = '', a = '';
  const dd = v.phase === 'ddWager';
  if (c) {
    cat = `${c.category} · ${money(c.dd ? c.wager || c.value : c.value)}`;
    q = c.q;
    if (v.phase === 'reading') open = '';
    if (v.phase === 'open') open = v.tried.length ? 'Anyone else? Buzz in!' : 'Buzz in!';
    if (v.phase === 'answering') { who = `${nameOf(v.buzzer)}?`; if (c.choices) open = c.choices.join('   ·   '); }
    if (dd) { cat = c.category; who = `${nameOf(c.ddPlayer)} is making a wager…`; }
    if (v.phase === 'ddAnswer') { who = `${nameOf(c.ddPlayer)} wagered ${money(c.wager)}`; if (c.choices) open = c.choices.join('   ·   '); }
    if (v.phase === 'reveal') {
      a = c.a;
      if (v.last) { who = `${nameOf(v.last.id)}: “${v.last.text}” ${v.last.right ? '✓' : '✕'}`; whoCls = v.last.right ? 'right' : 'wrong'; }
      if (v.last && !v.last.right && v.tried.length) who = `${nameOf(v.last.id)}: “${v.last.text}” ✕`;
    }
  } else if (v.phase === 'roundBreak') {
    q = 'Double round!'; open = 'Every clue is worth twice as much';
  } else if (f) {
    cat = 'Final round';
    if (v.phase === 'finalWager') { q = f.category; who = `${f.wagered.length} of ${v.players.length} wagers in`; }
    if (v.phase === 'finalClue') { cat = `Final round · ${f.category}`; q = f.q; who = `${f.answered.length} of ${v.players.length} answers in`; if (f.choices) open = f.choices.join('   ·   '); }
    if (v.phase === 'finalReveal') {
      cat = `Final round · ${f.category}`; q = f.q; a = f.a || '';
      const id = f.order[f.step];
      const r = id && f.results && f.results[id];
      const now = (v.players.find(p => p.id === id) || {}).score;
      if (r) { who = `${nameOf(id)} wrote “${r.answer}” ${r.right ? '✓' : '✕'}  ·  wagered ${money(r.wager)}  ·  now ${money(now || 0)}`; whoCls = r.right ? 'right' : 'wrong'; }
    }
  }
  $('#clueCat').textContent = cat;
  $('#clueDD').hidden = !dd;
  $('#clueQ').textContent = q;
  $('#clueQ').hidden = dd;
  $('#clueOpen').textContent = open;
  const w = $('#clueWho'); w.textContent = who; w.className = 'who ' + whoCls;
  $('#clueA').textContent = a;
}

/* ---------- render ---------- */
function render(v) {
  const prev = V.phase;
  V.view = v; V.phase = v.phase;
  $('#joinUrl').textContent = location.host; $('#lobbyUrl').textContent = location.host;
  $('#joinCode').textContent = v.code; $('#lobbyCode').textContent = v.code;
  if (V.code !== v.code) { V.code = v.code; $('#joinQr').src = $('#lobbyQr').src = '/qr.svg?c=' + v.code; }
  $('#ovLobby').hidden = v.phase !== 'lobby';
  $('#ovChamp').hidden = v.phase !== 'champ';
  $('#btnLobby').hidden = v.phase === 'lobby';
  $('#btnEnd').hidden = !['board', 'reveal'].includes(v.phase);
  if (v.phase === 'lobby') renderLobby(v, prev !== 'lobby');
  if (v.phase === 'champ') renderChamp(v, prev !== 'champ');
  $('#roundInfo').textContent = v.board ? (v.phase.startsWith('final') ? 'Final round' : v.rounds > 1 ? (v.round === 2 ? 'Double round' : 'Round 1') : '') : '';
  renderBoard(v);
  renderClue(v);
  $('#msg').textContent = v.phase === 'board' ? v.msg : '';
  const pods = $('#pods'); pods.innerHTML = '';
  v.players.forEach(p => {
    const d = el('div', 'pod');
    if (p.id === v.controlId && v.phase === 'board') d.classList.add('ctrl');
    if (p.id === v.buzzer || (v.clue && v.clue.ddPlayer === p.id && v.phase.startsWith('dd'))) d.classList.add('lit');
    if (v.tried.includes(p.id) && ['open', 'answering'].includes(v.phase)) d.classList.add('tried');
    if (!p.connected) d.classList.add('away');
    const sc = el('div', 'sc' + (p.score < 0 ? ' neg' : ''), money(p.score));
    let fx = '';
    if (v.final && v.phase === 'finalWager') fx = v.final.wagered.includes(p.id) ? 'wager in ✓' : 'wagering…';
    if (v.final && v.phase === 'finalClue') fx = v.final.answered.includes(p.id) ? 'answer in ✓' : 'thinking…';
    d.append(sc, el('div', 'nm', p.name), el('div', 'fx', fx));
    pods.append(d);
  });
  V.clock = v.timer ? { total: v.timer.total, end: Date.now() + v.timer.remaining } : null;
  // The host reads the final category once it's up.
  if (v.phase === 'finalWager' && prev !== 'finalWager') setTimeout(() => hostSay(`The final category is ${v.final.category}. Make your wagers.`), 1600);
}

function tick() {
  const c = V.clock, bar = $('#clueBarFill');
  const show = c && ['open', 'answering', 'ddWager', 'ddAnswer', 'finalWager', 'finalClue'].includes(V.phase);
  $('#clueBar').style.visibility = show ? 'visible' : 'hidden';
  if (show) bar.style.transform = `scaleX(${Math.max(0, (c.end - Date.now()) / c.total)})`;
}
setInterval(tick, 80);

/* ---------- lobby and champ ---------- */
function renderLobby(v, entering) {
  if (entering) $('#lobbyErr').textContent = '';
  const list = $('#plist'); list.innerHTML = '';
  $('#plistTitle').textContent = v.players.length ? `Players (${v.players.length} of 8)` : 'Players';
  if (!v.players.length) list.append(el('li', '', 'Nobody yet. Join on a phone to play.'));
  v.players.forEach(p => {
    const li = el('li', p.connected ? '' : 'away');
    const rm = el('button', 'btn', 'Remove'); rm.onclick = () => cmd('kick', { id: p.id });
    li.append(el('span', 'dot'), el('span', 'n', p.name + (p.connected ? '' : ' (phone off)')), rm);
    list.append(li);
  });
  const s = v.settings;
  if (document.activeElement !== $('#rounds')) $('#rounds').value = String(s.rounds);
  if (document.activeElement !== $('#difficulty')) $('#difficulty').value = s.difficulty;
  $('#choices').checked = s.choices; $('#penalty').checked = s.penalty; $('#final').checked = s.final;
  $('#startGame').disabled = !v.players.length;
}
const setting = o => cmd('settings', { settings: o });
$('#rounds').onchange = e => setting({ rounds: +e.target.value });
$('#difficulty').onchange = e => setting({ difficulty: e.target.value });
$('#choices').onchange = e => setting({ choices: e.target.checked });
$('#penalty').onchange = e => setting({ penalty: e.target.checked });
$('#final').onchange = e => setting({ final: e.target.checked });
$('#startGame').onclick = () => { unlockFeudAudio(); cmd('start'); };
document.querySelectorAll('.gamepick [data-game]').forEach(b => { b.onclick = () => cmd('switchGame', { to: b.dataset.game }); });

function renderChamp(v, entering) {
  $('#champTitle').textContent = v.champ.title;
  $('#champAnswer').textContent = v.champ.answer;
  const ol = $('#podium'); ol.innerHTML = '';
  v.champ.rows.forEach(r => ol.append(el('li', '', `${r.name}: ${money(r.score)}`)));
  if (entering) confetti(true);
}
$('#newGame').onclick = () => cmd('lobby');

/* ---------- sounds and the host ---------- */
function onFx(m) {
  switch (m.kind) {
    case 'clue': playSound('quiz-pick'); setTimeout(() => hostSay(m.q), 500); break;
    case 'buzz': playSound('quiz-buzz'); try { speechSynthesis.cancel(); } catch (e) {} break;
    case 'right': playSound('quiz-right'); break;
    case 'wrong': playSound('quiz-wrong'); break;
    case 'timesUp': playSound('quiz-timesup'); break;
    case 'dailyDouble': playSound('quiz-dailydouble'); setTimeout(() => hostSay('Daily Double!'), 900); break;
    case 'roundBreak': playSound('quiz-roundbreak'); setTimeout(() => hostSay('Double round! Every clue is worth twice as much.'), 900); break;
    case 'final': playSound('quiz-final'); break;
    case 'finalClue': hostSay(m.q); setTimeout(() => playSound('quiz-think'), 1200); break;
    case 'finalReveal': hushSounds(); break;
    case 'lock': playSound('lock'); break;
    case 'champ': hushSounds(); setTimeout(() => playSound('quiz-champ'), 300); break;
    case 'join': playSound('join'); break;
  }
}
loadCustomSounds();

/* ---------- tools ---------- */
$('#btnEnd').onclick = () => { if (confirm('Skip the rest of this board?')) cmd('endRound'); };
$('#btnLobby').onclick = () => { if (confirm('End this game and go back to the lobby?')) cmd('lobby'); };
$('#btnSound').onclick = () => {
  FS.on = FX.on = !FS.on;
  $('#btnSound').textContent = FS.on ? 'Sound on' : 'Sound off';
  if (FS.on) { unlockFeudAudio(); playSound('quiz-right'); } else { try { speechSynthesis.cancel(); } catch (e) {} hushSounds(); }
};
$('#btnVoice').onclick = () => { FS.voice = !FS.voice; $('#btnVoice').textContent = FS.voice ? 'Host voice on' : 'Host voice off'; if (FS.voice) hostSay('This is Answer Board!'); };
if (!window.speechSynthesis) $('#btnVoice').hidden = true;
$('#btnFull').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch (e) { $('#btnFull').textContent = 'Use your browser’s full screen'; }
};
if (!document.fullscreenEnabled) $('#btnFull').hidden = true;

connect(false);

// Family Face-Off on the TV: the board, the families, and the host's controls.
const $ = s => document.querySelector(s);
const V = { view: null, hostKey: null, ws: null, phase: '', clock: null, lastSec: -1, open: new Set(), qText: '', code: '' };
try { V.hostKey = localStorage.getItem('hangman-host'); } catch (e) {}

/* ---------- connection (same handshake as the Hangman TV) ---------- */
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
      if (m.view.game !== 'feud') { V.leaving = true; location.replace('/tv'); return; }
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
function toast(text) {
  if (V.phase === 'lobby') { $('#lobbyErr').textContent = text; return; }
  const m = V.phase.startsWith('fast') ? $('#fastMsg') : $('#msg');
  m.textContent = text;
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const nameOf = id => ((V.view && V.view.players.find(p => p.id === id)) || {}).name || '';

/* ---------- render ---------- */
function render(v) {
  const prev = V.phase;
  V.view = v; V.phase = v.phase;
  $('#joinUrl').textContent = location.host; $('#lobbyUrl').textContent = location.host;
  $('#joinCode').textContent = v.code; $('#lobbyCode').textContent = v.code;
  if (V.code !== v.code) { V.code = v.code; $('#joinQr').src = $('#lobbyQr').src = '/qr.svg?c=' + v.code; }

  $('#ovLobby').hidden = v.phase !== 'lobby';
  $('#ovPick').hidden = v.phase !== 'fastPick';
  $('#ovChamp').hidden = v.phase !== 'champ';
  $('#fastView').hidden = !['fastReady', 'fast', 'fastHalf', 'fastDone'].includes(v.phase);
  $('#btnLobby').hidden = v.phase === 'lobby';
  $('#btnStrike').hidden = !(v.phase === 'play' || (v.phase === 'faceoff' && v.faceoff && v.faceoff.answering));

  if (v.phase === 'lobby') renderLobby(v, prev !== 'lobby');
  renderMain(v);
  if (v.phase === 'fastPick') renderPick(v);
  if (!$('#fastView').hidden) renderFast(v);
  if (v.phase === 'champ') renderChamp(v, prev !== 'champ');
  setClock(v);
}

function renderMain(v) {
  const m = v.multiplier;
  $('#roundInfo').innerHTML = '';
  if (v.round) {
    $('#roundInfo').append(`Round ${v.round}`);
    if (m > 1) $('#roundInfo').append(el('span', 'mult', m === 2 ? 'Double' : 'Triple'));
  }
  $('#bank').textContent = v.bank;
  $('#question').textContent = v.question;
  renderBoard(v);
  $('#strikes').innerHTML = '';
  for (let i = 0; i < v.strikes; i++) $('#strikes').append(el('span', '', '✕'));
  $('#msg').textContent = v.msg;

  // Face-off: the two contenders and what they said
  const fo = $('#faceoff');
  fo.hidden = !(v.faceoff && v.faceoff.contenders.length && v.phase === 'faceoff');
  if (!fo.hidden) {
    fo.innerHTML = '';
    v.faceoff.contenders.forEach((id, i) => {
      if (i) fo.append(el('span', 'vs', 'VS'));
      const s = el('div', 'side' + (v.faceoff.answering === id ? ' now' : ''));
      s.append(el('b', '', nameOf(id)));
      const a = v.faceoff.answers[id];
      s.append(el('i', '', a ? `“${a.text}” ${a.idx >= 0 ? '✓' : '✕'}` : v.faceoff.answering === id ? 'answering…' : 'waiting'));
      fo.append(s);
    });
  }

  // Families along the bottom
  const fams = $('#families'); fams.innerHTML = '';
  v.players.forEach(p => {
    const f = el('div', 'fam');
    if (p.id === v.controlId && ['decide', 'play', 'steal'].includes(v.phase)) f.classList.add('ctrl');
    if (v.faceoff && v.faceoff.contenders.includes(p.id)) f.classList.add('buzz');
    if (v.steal && v.steal.locked.includes(p.id) && v.phase === 'steal') f.classList.add('locked');
    if (!p.connected) f.classList.add('away');
    f.append(el('div', 'nm', p.name), el('div', 'sc', String(p.score)));
    fams.append(f);
  });

  renderFix(v);
  const act = $('#actions'); act.innerHTML = '';
  if (v.phase === 'reveal') {
    const b = el('button', 'btn primary', v.players.some(p => p.score >= v.target) ? 'On to Fast Money' : 'Next round');
    b.onclick = () => cmd('next'); act.append(b);
  }
}

function renderBoard(v) {
  const b = $('#board');
  const newQ = v.question !== V.qText;
  if (newQ || !b.children.length) {
    V.qText = v.question; V.open = new Set();
    b.innerHTML = '';
    b.style.gridTemplateRows = 'repeat(4,1fr)';
    b.style.gridAutoFlow = 'column';
    for (let i = 0; i < 8; i++) {
      const t = el('div', 'tile');
      const front = el('div', 'face front'), back = el('div', 'face back');
      back.append(el('span', 'txt'), el('span', 'pts'));
      t.append(front, back);
      b.append(t);
    }
  }
  [...b.children].forEach((t, i) => {
    const a = v.board[i];
    const front = t.querySelector('.front');
    t.classList.toggle('empty', !a);
    front.innerHTML = '';
    if (!a) { t.classList.remove('open'); return; }
    front.append(el('span', 'num', String(a.n)));
    if (a.text) {
      t.querySelector('.txt').textContent = a.text;
      t.querySelector('.pts').textContent = a.points;
      t.classList.toggle('missed', !a.found);
      if (!V.open.has(i)) {
        V.open.add(i);
        // Unfound answers at the end of a round flip one after another.
        const delay = a.found ? 0 : 250 * [...v.board.slice(0, i)].filter(x => x && !x.found).length;
        setTimeout(() => t.classList.add('open'), delay);
      }
    } else { t.classList.remove('open', 'missed'); V.open.delete(i); }
  });
}

// "That counts": when the matcher misses, the TV can credit a board answer.
function renderFix(v) {
  const fix = $('#fix');
  const m = v.lastMiss;
  const hidden = v.board.map((a, i) => ({ a, i })).filter(x => x.a && !x.a.found);
  const stealFix = m && m.kind === 'steal' && v.phase === 'reveal' && v.steal && v.steal.answers;
  const show = m && hidden.length && ((m.kind === 'faceoff' && v.phase === 'faceoff') || (m.kind === 'play' && ['play', 'steal'].includes(v.phase)) || stealFix);
  fix.hidden = !show;
  if (!show) { V.fixKey = ''; return; }
  const key = JSON.stringify([m, v.phase, hidden.map(x => x.i)]);
  if (V.fixKey === key) return;
  V.fixKey = key;
  fix.innerHTML = '';
  const ans = el('select');
  ans.append(new Option('pick the answer…', ''));
  hidden.forEach(({ i }) => ans.append(new Option(`${i + 1}`, i)));
  let who = null;
  if (stealFix) {
    who = el('select');
    Object.entries(v.steal.answers).forEach(([id, a]) => who.append(new Option(`${nameOf(id)}: “${a.text}”`, id)));
    fix.append(el('span', '', 'Should a steal count?'), who, el('span', '', 'as answer'), ans);
  } else {
    fix.append(el('span', '', `${nameOf(m.id)} said “${m.text}”. Count it as answer`), ans);
  }
  const go = el('button', 'btn', 'That counts');
  go.onclick = () => { if (ans.value !== '') cmd('override', { idx: +ans.value, id: who ? who.value : undefined }); };
  fix.append(go);
}

/* ---------- lobby ---------- */
function renderLobby(v, entering) {
  if (entering) $('#lobbyErr').textContent = '';
  const list = $('#plist'); list.innerHTML = '';
  $('#plistTitle').textContent = v.players.length ? `Families (${v.players.length} of 8)` : 'Families';
  if (!v.players.length) list.append(el('li', '', 'Nobody yet. Join on a phone to play.'));
  v.players.forEach(p => {
    const li = el('li', p.connected ? '' : 'away');
    const rm = el('button', 'btn', 'Remove'); rm.onclick = () => cmd('kick', { id: p.id });
    li.append(el('span', 'dot'), el('span', 'n', p.name + (p.connected ? '' : ' (phone off)')), rm);
    list.append(li);
  });
  if (document.activeElement !== $('#target')) $('#target').value = String(v.settings.target);
  $('#timerOn').checked = v.settings.timerOn;
  $('#startGame').disabled = v.players.length < 2;
  $('#startGame').textContent = v.players.length < 2 ? 'Need 2 players' : 'Start the game';
}
$('#target').onchange = e => cmd('settings', { settings: { target: +e.target.value } });
$('#timerOn').onchange = e => cmd('settings', { settings: { timerOn: e.target.checked } });
$('#startGame').onclick = () => { unlockAudio(); cmd('start'); };
$('#toHangman').onclick = () => cmd('switchGame', { to: 'hangman' });

/* ---------- Fast Money ---------- */
function renderPick(v) {
  $('#pickTitle').textContent = `${nameOf(v.fast.winnerId)}, pick your Fast Money partner`;
  const list = $('#pickList'); list.innerHTML = '';
  v.players.forEach(p => {
    const b = el('button', 'btn' + (p.id === v.fast.winnerId ? '' : ' primary'), p.id === v.fast.winnerId ? `${p.name} plays both halves` : p.name);
    b.onclick = () => cmd('pickPartner', { id: p.id });
    list.append(b);
  });
}

function renderFast(v) {
  const f = v.fast;
  const p1 = nameOf(f.ids[0]), p2 = nameOf(f.ids[1]);
  $('#fastWho').textContent = f.ids[0] === f.ids[1] ? `${p1} plays both halves` : `${p1} then ${p2}`;
  $('#fastQ').textContent = v.phase === 'fast' ? f.question : '';
  const scored = ['fastHalf', 'fastDone'].includes(v.phase);
  // Reveal the half that just finished one answer at a time, then the total.
  const revealKey = scored ? v.phase : '';
  const revealing = revealKey && revealKey !== V.fastReveal;
  V.fastReveal = revealKey;
  const revPart = v.phase === 'fastHalf' ? 0 : 1;
  const STEP = 900;
  ['#fastA', '#fastB'].forEach((sel, part) => {
    const col = $(sel); col.innerHTML = '';
    f.rows.forEach((r, qi) => {
      const a = r.a[part];
      const row = el('div', 'frow');
      const txt = el('div', '', a ? a.text : '');
      const pts = el('div', 'p', a && a.points != null ? String(a.points) : '');
      if (a && a.points === 0 && a.text) pts.classList.add('zero');
      if (revealing && part === revPart && a) {
        pts.classList.add('rev');
        pts.style.animationDelay = `${qi * STEP}ms`;
        setTimeout(() => (a.points ? SOUNDS.reveal : SOUNDS.dupe)(), qi * STEP);
      }
      // Fix a missed match after a half, before the total counts.
      if (scored && a && a.text && a.points === 0 && r.options) {
        const s = el('select');
        s.append(new Option('counts as…', ''));
        r.options.forEach((o, i) => s.append(new Option(o, i)));
        s.onchange = () => { if (s.value !== '') cmd('fastFix', { part, q: qi, idx: +s.value }); };
        txt.append(s);
      }
      row.append(txt, pts);
      col.append(row);
    });
  });
  const showTotal = () => {
    $('#fastSum').textContent = f.total;
    $('#fastTotal').classList.toggle('win', f.total >= f.goal && scored);
    if (revealing && f.total >= f.goal && v.phase === 'fastDone') { SOUNDS.champ(); confetti(true); }
  };
  clearTimeout(V.totalTimer);
  if (revealing) V.totalTimer = setTimeout(showTotal, f.rows.length * STEP); else showTotal();
  $('#fastMsg').textContent = v.msg;
  const act = $('#fastActions'); act.innerHTML = '';
  const btn = (t, c, cls = 'btn primary') => { const b = el('button', cls, t); b.onclick = () => { unlockAudio(); cmd(c); }; act.append(b); };
  if (v.phase === 'fastReady') btn(`Start the clock for ${nameOf(f.ids[f.part])}`, 'fastGo');
  if (v.phase === 'fastHalf') btn(`${p2}’s turn`, 'fastNext');
  if (v.phase === 'fastDone') btn('See the final scores', 'finish');
  $('#fastClock').hidden = v.phase !== 'fast';
}

function renderChamp(v, entering) {
  $('#champTitle').textContent = v.champ.title;
  $('#champFast').textContent = v.champ.fast;
  const ol = $('#podium'); ol.innerHTML = '';
  v.champ.rows.forEach(r => ol.append(el('li', '', `${r.name}: ${r.score}`)));
  if (entering && v.champ.won) confetti(true);
}
$('#newGame').onclick = () => cmd('lobby');

/* ---------- clock ---------- */
function setClock(v) {
  V.clock = v.timer ? { total: v.timer.total, end: Date.now() + v.timer.remaining } : null;
  V.lastSec = -1;
  tick();
}
function tick() {
  const c = V.clock;
  const row = $('#clockRow');
  if (!c) { row.hidden = true; $('#fastNum').textContent = ''; return; }
  const ms = Math.max(0, c.end - Date.now()), sec = Math.ceil(ms / 1000);
  row.hidden = V.phase === 'fast';
  $('#clock').classList.toggle('low', sec <= 5);
  $('#clockBar').style.transform = `scaleX(${Math.min(1, ms / c.total)})`;
  $('#clockNum').textContent = sec;
  $('#fastNum').textContent = sec;
  if (sec !== V.lastSec) { V.lastSec = sec; if (sec <= 5 && sec > 0) tone(1250, 0, 0.06, 'square', 0.05); }
}
setInterval(tick, 100);

/* ---------- sounds ---------- */
function tone(f, start, dur, type = 'triangle', vol = 0.18) {
  if (!FX.on) return;
  try {
    FX.ctx = FX.ctx || new (window.AudioContext || window.webkitAudioContext)();
    const a = FX.ctx, t0 = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + start);
    g.gain.linearRampToValueAtTime(vol, t0 + start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    o.connect(g).connect(a.destination); o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
  } catch (e) {}
}
const SOUNDS = {
  reveal: () => { tone(1568, 0, 0.5, 'sine', 0.22); tone(2093, 0.02, 0.6, 'sine', 0.12); },
  strike: () => { tone(110, 0, 0.9, 'sawtooth', 0.18); tone(116, 0, 0.9, 'square', 0.1); tone(55, 0, 0.9, 'sawtooth', 0.12); },
  buzz: () => tone(880, 0, 0.18, 'square', 0.1),
  control: () => [523, 659, 784].forEach((f, k) => tone(f, k * 0.08, 0.2)),
  round: () => [392, 523, 659, 784, 1047].forEach((f, k) => tone(f, k * 0.09, 0.3, 'square', 0.07)),
  win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, k) => tone(f, k * 0.12, 0.35)),
  keep: () => [523, 440].forEach((f, k) => tone(f, k * 0.15, 0.3)),
  lock: () => tone(660, 0, 0.08, 'square', 0.06),
  dupe: () => { tone(300, 0, 0.15, 'square', 0.1); tone(300, 0.2, 0.15, 'square', 0.1); },
  fastStart: () => [784, 1047].forEach((f, k) => tone(f, k * 0.1, 0.25, 'square', 0.08)),
  fastEnd: () => tone(220, 0, 0.7, 'sawtooth', 0.12),
  champ: () => [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, k) => tone(f, k * 0.14, 0.32, 'square', 0.07)),
  join: () => [523, 784].forEach((f, k) => tone(f, k * 0.08, 0.18, 'triangle', 0.1)),
};
function onFx(m) {
  if (SOUNDS[m.kind]) SOUNDS[m.kind]();
  if (m.kind === 'strike') showX(m.count);
  if (m.kind === 'win') confetti(false);
}
function showX(n) {
  const x = $('#bigX'); x.innerHTML = '';
  for (let i = 0; i < n; i++) x.append(el('span', '', '✕'));
  setTimeout(() => { if (x.firstChild && x.firstChild.getAnimations && !x.firstChild.getAnimations().length) x.innerHTML = ''; }, 1400);
}

/* ---------- tools ---------- */
$('#btnStrike').onclick = () => cmd('strike');
$('#btnLobby').onclick = () => { if (confirm('End this game and go back to the lobby?')) cmd('lobby'); };
$('#btnSound').onclick = () => { FX.on = !FX.on; $('#btnSound').textContent = FX.on ? 'Sound on' : 'Sound off'; if (FX.on) { unlockAudio(); SOUNDS.reveal(); } };
$('#btnFull').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch (e) { $('#btnFull').textContent = 'Use your browser’s full screen'; }
};
if (!document.fullscreenEnabled) $('#btnFull').hidden = true;
document.addEventListener('fullscreenchange', () => { $('#btnFull').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });

connect(false);

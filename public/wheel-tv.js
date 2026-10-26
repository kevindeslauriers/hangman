// Spin & Solve on the TV: the puzzle board, the wheel and the contestants.
const $ = s => document.querySelector(s);
const V = { view: null, hostKey: null, ws: null, phase: '', code: '', board: null, shown: null, anim: null, clock: null, lastSec: -1 };
try { V.hostKey = localStorage.getItem('hangman-host'); } catch (e) {}
const money = n => '$' + Number(n).toLocaleString('en-US');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const nameOf = id => ((V.view && V.view.players.find(p => p.id === id)) || {}).name || '';

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
      if (m.view.game !== 'wheel') { V.leaving = true; location.replace(m.view.game === 'feud' ? '/feud-tv' : '/tv'); return; }
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

/* ---------- the wheel ---------- */
const COLORS = ['#e3262f', '#f58220', '#ffd200', '#2eb34a', '#1f6fd1', '#7b3fa0', '#ef5ba1', '#00a19a'];
function drawWheel(wedges) {
  const key = wedges.join(',');
  if (V.wheelKey === key) return;
  V.wheelKey = key;
  const g = $('#wheelRot'), NS = 'http://www.w3.org/2000/svg';
  g.innerHTML = '';
  const R = 500, pt = (r, deg) => [r * Math.sin(deg * Math.PI / 180), -r * Math.cos(deg * Math.PI / 180)];
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  g.append(mk('circle', { r: 515, fill: '#d4a017', stroke: '#6b4a00', 'stroke-width': 8 }));
  wedges.forEach((w, i) => {
    const a0 = i * 15, a1 = a0 + 15;
    const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1);
    const fill = w === 'BANKRUPT' ? '#111' : w === 'LOSE A TURN' ? '#fff' : i === 0 ? '#c9ced6' : COLORS[i % COLORS.length];
    g.append(mk('path', { d: `M0 0 L${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Z`, fill, stroke: '#2a1a00', 'stroke-width': 3 }));
    // Labels are stacked letter by letter from the rim inward, each one
    // upright toward the rim, like the real wheel.
    const label = typeof w === 'number' ? '$' + w : w.replace(/ /g, '');
    const size = typeof w === 'number' ? 58 : w === 'BANKRUPT' ? 40 : 32;
    const step = size * 0.92;
    const ink = w === 'BANKRUPT' ? '#fff' : w === 'LOSE A TURN' ? '#111' : (fill === '#ffd200' || fill === '#c9ced6' ? '#111' : '#fff');
    [...label].forEach((ch, k) => {
      const t = mk('text', {
        transform: `rotate(${a0 + 7.5}) translate(0 ${-R + 22 + size * 0.8 + k * step})`,
        'text-anchor': 'middle', 'font-family': 'Anton, sans-serif', 'font-size': size, fill: ink,
        stroke: ink === '#fff' ? 'rgba(0,0,0,.35)' : 'none', 'stroke-width': 2,
      });
      t.textContent = ch;
      g.append(t);
    });
    const [px, py] = pt(R - 10, a0);
    g.append(mk('circle', { cx: px, cy: py, r: 9, fill: '#fff6c8', stroke: '#6b4a00', 'stroke-width': 3 }));
  });
  g.append(mk('circle', { r: 95, fill: 'url(#hub)', stroke: '#6b4a00', 'stroke-width': 8 }));
  const defs = mk('defs', {});
  defs.innerHTML = '<radialGradient id="hub" cx="40%" cy="35%"><stop offset="0" stop-color="#fff6c8"/><stop offset=".6" stop-color="#ffd23f"/><stop offset="1" stop-color="#b8860b"/></radialGradient>';
  $('#wheel').prepend(defs);
}

function setAngle(a) { $('#wheelRot').setAttribute('transform', `rotate(${a})`); }

// The wheel slows like a real one, and the flapper clicks on every peg.
function animateSpin(s) {
  const id = `${s.from}:${s.to}`;
  if (V.anim && V.anim.id === id) return;
  const t0 = performance.now() - (s.elapsed || 0);
  let lastPeg = Math.floor(s.from / 15), lastTick = 0;
  V.anim = { id };
  $('#wheelWrap').classList.add('big');
  $('#dim').classList.add('on');
  centreWheel();
  const frame = now => {
    if (!V.anim || V.anim.id !== id) return;
    const p = Math.min(1, (now - t0) / s.duration);
    const eased = 1 - Math.pow(1 - p, 3);
    const a = s.from + (s.to - s.from) * eased;
    setAngle(a);
    const peg = Math.floor(a / 15);
    if (peg !== lastPeg && now - lastTick > 28) {
      lastPeg = peg; lastTick = now;
      playSound('wheel-tick');
      const ptr = $('#pointer'); ptr.classList.remove('flick'); void ptr.offsetWidth; ptr.classList.add('flick');
    }
    if (p < 1) requestAnimationFrame(frame);
    else setTimeout(() => { if (V.anim && V.anim.id === id) { V.anim = null; $('#wheelWrap').classList.remove('big'); $('#dim').classList.remove('on'); } }, 1600);
  };
  requestAnimationFrame(frame);
}
// Slide the wheel to the middle of the screen while it spins.
function centreWheel() {
  const r = $('#wheelWrap').getBoundingClientRect();
  $('#wheelWrap').style.setProperty('--bx', `${innerWidth / 2 - (r.left + r.width / 2)}px`);
  $('#wheelWrap').style.setProperty('--by', `${innerHeight / 2 - (r.top + r.height / 2)}px`);
}

/* ---------- the puzzle board ---------- */
function renderBoard(v) {
  const b = $('#pboard');
  if (!b.children.length) for (let i = 0; i < 56; i++) b.append(el('div', 'pc'));
  const rows = v.board || ['#............#', '..............', '..............', '#............#'];
  const flat = rows.join('');
  const prev = V.board;
  const sameShape = prev && prev.replace(/[A-Z_]/g, '_') === flat.replace(/[A-Z_]/g, '_');
  const fresh = [];
  [...flat].forEach((ch, i) => {
    const c = b.children[i];
    const was = sameShape ? prev[i] : null;
    if (ch === '#') { c.className = 'pc off'; c.textContent = ''; return; }
    if (ch === '.') { c.className = 'pc green'; c.textContent = ''; return; }
    if (ch === '_') { c.className = 'pc tile'; c.textContent = ''; return; }
    if (was === '_' && /[A-Z]/.test(ch)) { fresh.push([c, ch]); return; }
    if (c.dataset.anim) return;
    c.className = 'pc tile'; c.textContent = ch;
  });
  V.board = flat;
  if (!fresh.length) return;
  // Called letters light up blue, then turn one by one with a ding each.
  // Letters shown at the end of a round (or in a toss-up) just pop on.
  const slow = V.dingNext;
  V.dingNext = false;
  fresh.forEach(([c]) => { c.className = 'pc tile lit'; c.textContent = ''; c.dataset.anim = '1'; });
  fresh.forEach(([c, ch], k) => {
    setTimeout(() => {
      c.className = 'pc tile turn'; c.textContent = ch; delete c.dataset.anim;
      if (slow) playSound('wheel-ding');
    }, slow ? 650 + k * 650 : 40 + k * 45);
  });
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
  $('#btnSkip').hidden = !['turn', 'consonant', 'vowel', 'solving'].includes(v.phase);
  if (v.phase === 'lobby') renderLobby(v, prev !== 'lobby');
  if (v.phase === 'champ') renderChamp(v, prev !== 'champ');

  drawWheel(v.wedges);
  if (v.spin) animateSpin(v.spin); else if (!V.anim) setAngle(v.angle);
  renderBoard(v);

  const info = $('#roundInfo'); info.innerHTML = '';
  if (v.round) info.append(`Round ${v.round} of ${v.settings.rounds}`);
  if (v.phase.startsWith('bonus')) { info.textContent = 'Bonus Round'; }
  $('#category').textContent = v.category || ' ';
  if (v.category && v.category !== V.saidCat && v.phase === 'turn') {
    V.saidCat = v.category;
    setTimeout(() => hostSay(`The category is ${v.category}.`), 900);
  }

  const banner = v.phase === 'tossup' || v.phase === 'tossDone' ? `Toss-up · ${money(v.toss.value)}`
    : v.phase.startsWith('bonus') ? 'Bonus Round' : '';
  $('#banner').textContent = banner;
  const landed = $('#landed');
  const prize = v.phase === 'bonusDone' && v.bonus.prize;
  landed.hidden = !((v.phase === 'consonant' && v.spinValue) || prize);
  if (!landed.hidden) landed.textContent = money(prize || v.spinValue);
  $('#msg').textContent = v.msg;

  const pods = $('#pods'); pods.innerHTML = '';
  v.players.forEach((p, i) => {
    const d = el('div', `pod c${i % 4}`);
    if (p.id === v.turnId || (v.toss && v.toss.buzzer === p.id) || (v.bonus && v.bonus.playerId === p.id && v.phase.startsWith('bonus'))) d.classList.add('now');
    if (!p.connected) d.classList.add('away');
    d.append(el('div', 'nm', p.name), el('div', 'bk', money(p.bank)), el('div', 'tt', `Total ${money(p.score)}`));
    pods.append(d);
  });

  const ub = $('#usedBoard'); ub.innerHTML = '';
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].forEach(L => ub.append(el('span', ('AEIOU'.includes(L) ? 'v' : '') + (v.used.includes(L) ? ' u' : ''), L)));
  ub.hidden = !v.board || ['tossup', 'tossDone', 'bonusDone'].includes(v.phase);

  const act = $('#actions'); act.innerHTML = '';
  const btn = (t, c) => { const b = el('button', 'btn primary', t); b.onclick = () => { unlockFeudAudio(); cmd(c); }; act.append(b); };
  if (v.phase === 'roundEnd') btn(v.round < v.settings.rounds ? 'Next round' : v.settings.bonus ? 'On to the Bonus Round' : 'Final scores', 'next');
  if (v.phase === 'bonusPick') act.append(el('span', '', `${nameOf(v.bonus.playerId)} is picking 3 consonants and a vowel on their phone…`));
  if (v.phase === 'bonusDone') btn('Final scores', 'finish');
  V.clock = v.timer ? { total: v.timer.total, end: Date.now() + v.timer.remaining } : null;
  V.lastSec = -1;
  tick();
}

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
  $('#tossups').checked = s.tossups; $('#bonus').checked = s.bonus; $('#timerOn').checked = s.timerOn;
  $('#startGame').disabled = !v.players.length;
}
const setting = o => cmd('settings', { settings: o });
$('#rounds').onchange = e => setting({ rounds: +e.target.value });
$('#tossups').onchange = e => setting({ tossups: e.target.checked });
$('#bonus').onchange = e => setting({ bonus: e.target.checked });
$('#timerOn').onchange = e => setting({ timerOn: e.target.checked });
$('#startGame').onclick = () => { unlockFeudAudio(); cmd('start'); };
document.querySelectorAll('.gamepick [data-game]').forEach(b => { b.onclick = () => cmd('switchGame', { to: b.dataset.game }); });

function renderChamp(v, entering) {
  $('#champTitle').textContent = v.champ.title;
  const ol = $('#podium'); ol.innerHTML = '';
  v.champ.rows.forEach(r => ol.append(el('li', '', `${r.name}: ${money(r.score)}`)));
  if (entering) confetti(true);
}
$('#newGame').onclick = () => cmd('lobby');

/* ---------- clock ---------- */
function tick() {
  const c = V.clock, out = $('#clock');
  const hide = !c || ['spinning', 'tossDone', 'roundEnd', 'bonusDone', 'lobby', 'champ'].includes(V.phase);
  if (hide) { out.textContent = ''; return; }
  const ms = Math.max(0, c.end - Date.now()), sec = Math.ceil(ms / 1000);
  out.textContent = sec;
  out.classList.toggle('low', sec <= 5);
  if (sec !== V.lastSec) { V.lastSec = sec; if (sec > 0 && (sec <= 5 || V.phase === 'bonusSolve')) playSound('tick'); }
}
setInterval(tick, 100);

/* ---------- sounds and the host ---------- */
function onFx(m) {
  switch (m.kind) {
    case 'round': playSound('wheel-round'); break;
    case 'puzzle': playSound('wheel-puzzle'); break;
    case 'tossLetter': playSound('wheel-tossup'); break;
    case 'buzz': playSound('wheel-buzzin'); break;
    case 'letters':
      V.dingNext = true;
      if (m.letter) setTimeout(() => hostSay(m.count === 1 ? `One ${m.letter}.` : `${m.count} ${m.letter}'s!`), 250);
      break;
    case 'noLetter': playSound('wheel-buzz'); if (m.letter) setTimeout(() => hostSay(`Sorry, no ${m.letter}.`), 500); break;
    case 'wrong': playSound('wheel-wrong'); break;
    case 'bankrupt': playSound('wheel-bankrupt'); setTimeout(() => hostSay('Bankrupt!'), 150); break;
    case 'loseTurn': playSound('wheel-loseturn'); setTimeout(() => hostSay('Lose a turn.'), 300); break;
    case 'landed': setTimeout(() => hostSay(`${m.value} dollars.`), 200); break;
    case 'vowel': playSound('wheel-vowel'); break;
    case 'solve': playSound('wheel-solve'); confetti(false); setTimeout(() => hostSay('Yes! That’s it!'), 300); break;
    case 'nobody': playSound('wheel-buzz'); break;
    case 'bonus': playSound('wheel-bonus'); break;
    case 'bonusWin': playSound('wheel-bonuswin'); confetti(true); setTimeout(() => hostSay('You did it!'), 400); break;
    case 'bonusLose': playSound('wheel-bonuslose'); break;
    case 'champ': playSound('champ'); break;
    case 'join': playSound('join'); break;
  }
}
loadCustomSounds();

/* ---------- tools ---------- */
$('#btnSkip').onclick = () => cmd('skip');
$('#btnLobby').onclick = () => { if (confirm('End this game and go back to the lobby?')) cmd('lobby'); };
$('#btnSound').onclick = () => {
  FS.on = FX.on = !FS.on;
  $('#btnSound').textContent = FS.on ? 'Sound on' : 'Sound off';
  if (FS.on) { unlockFeudAudio(); playSound('wheel-ding'); } else { try { speechSynthesis.cancel(); } catch (e) {} }
};
$('#btnVoice').onclick = () => { FS.voice = !FS.voice; $('#btnVoice').textContent = FS.voice ? 'Host voice on' : 'Host voice off'; if (FS.voice) hostSay('Spin the wheel!'); };
if (!window.speechSynthesis) $('#btnVoice').hidden = true;
$('#btnFull').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch (e) { $('#btnFull').textContent = 'Use your browser’s full screen'; }
};
if (!document.fullscreenEnabled) $('#btnFull').hidden = true;

connect(false);

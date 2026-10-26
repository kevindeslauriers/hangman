// The TV: shows the board and the lobby, and runs the settings. Phones play.
const $ = s => document.querySelector(s);
const V = { view: null, hostKey: null, ws: null, themes: [], word: '', round: -1, phase: '', endTimer: null, clock: null, lastSec: -1 };
try { V.hostKey = localStorage.getItem('hangman-host'); } catch (e) {}

/* ---------- connection ---------- */
let retry = 0;
function connect(takeover) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  V.ws = ws;
  ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: 'hello', role: 'tv', hostKey: V.hostKey, takeover: !!takeover })); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'host') { V.hostKey = m.hostKey; try { localStorage.setItem('hangman-host', m.hostKey); } catch (e) {} $('#ovBusy').hidden = true; $('#ovConnect').hidden = true; }
    else if (m.t === 'busy') { $('#ovConnect').hidden = true; showBusy(false); }
    else if (m.t === 'replaced') { V.replaced = true; showBusy(true); }
    else if (m.t === 'state') {
      if (m.view.game !== 'hangman') { V.leaving = true; location.replace(m.view.game === 'feud' ? '/feud-tv' : '/wheel-tv'); return; }
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
function showBusy(replaced) {
  $('#ovBusy').hidden = false;
  $('#ovBusy h2').textContent = replaced ? 'The game moved to another screen' : 'A game is already on another screen';
}
$('#takeover').onclick = () => { V.replaced = false; $('#ovBusy').hidden = true; if (V.ws) { V.ws.onclose = null; V.ws.close(); } connect(true); };

function toast(text) {
  if (V.phase === 'lobby') { $('#lobbyErr').textContent = text; return; }
  const m = $('#msg'); m.textContent = text; m.classList.remove('hot');
}

/* ---------- rendering ---------- */
const ROWS = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ'];
(function buildKeys() {
  const box = $('#keys');
  ROWS.forEach(r => {
    const row = document.createElement('div'); row.className = 'row';
    [...r].forEach(L => { const k = document.createElement('div'); k.className = 'key'; k.textContent = L; k.dataset.l = L; row.append(k); });
    box.append(row);
  });
})();

function render(v) {
  const prevPhase = V.phase;
  V.view = v; V.phase = v.phase;
  const joinUrl = `${location.host}`;
  $('#joinUrl').textContent = joinUrl; $('#lobbyUrl').textContent = joinUrl;
  $('#joinCode').textContent = v.code; $('#lobbyCode').textContent = v.code;
  if (V.code !== v.code) { V.code = v.code; const src = '/qr.svg?c=' + v.code; $('#joinQr').src = src; $('#lobbyQr').src = src; }

  renderScores(v);
  $('#goal').textContent = v.round ? `Round ${v.round}` + (v.settings.target && v.players.length > 1 ? `, first to ${v.settings.target} wins` : '') : '';
  $('#btnSkip').hidden = !(v.phase === 'play' && v.multi);
  $('#btnNew').hidden = !['play', 'secret', 'end'].includes(v.phase);
  $('#btnLobby').hidden = v.phase === 'lobby';
  $('#joinBadge').hidden = v.phase === 'lobby';

  if (v.phase === 'play' || v.phase === 'end') renderBoard(v);
  else if (v.phase === 'lobby' && prevPhase !== 'lobby') clearBoard();

  $('#ovLobby').hidden = v.phase !== 'lobby';
  $('#ovSecret').hidden = v.phase !== 'secret';
  $('#ovChamp').hidden = v.phase !== 'champ';
  if (v.phase === 'lobby') renderLobby(v, prevPhase !== 'lobby');
  if (v.phase === 'secret') $('#secretTitle').textContent = `${v.setterName} is typing a secret phrase`;
  if (v.phase === 'champ') renderChamp(v);
  if (v.phase === 'end') {
    renderEnd(v);
    // Let the last letters land before the round-over card covers them.
    if (prevPhase !== 'end') { clearTimeout(V.endTimer); V.endTimer = setTimeout(() => { if (V.phase === 'end') $('#ovEnd').hidden = false; }, v.end.won ? 1100 : 1600); }
  } else { clearTimeout(V.endTimer); $('#ovEnd').hidden = true; }
  setClock(v);
}

function renderScores(v) {
  const ul = $('#scores'); ul.innerHTML = '';
  v.players.forEach(p => {
    const li = document.createElement('li');
    const cls = [];
    if (v.multi && p.id === v.turnId) cls.push('turn');
    if (v.leaders.includes(p.id)) cls.push('leader');
    if (p.id === v.turnId && v.fire) cls.push('fire');
    if (!p.connected) cls.push('away');
    if (p.id === v.setterId) cls.push('setter');
    li.className = cls.join(' ');
    const name = document.createElement('span'); name.textContent = p.name;
    const score = document.createElement('b'); score.textContent = p.score;
    li.append(name, score); ul.append(li);
  });
}

function clearBoard() {
  $('#word').innerHTML = ''; $('#hint').textContent = ''; $('#msg').textContent = ''; $('#misses').textContent = '';
  document.querySelectorAll('.part').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('#keys .key').forEach(k => { k.className = 'key'; });
  $('#art').classList.remove('lost');
  V.word = ''; V.round = -1;
}

function renderBoard(v) {
  const el = $('#word');
  if (V.round !== v.round || V.word.length !== v.word.length) {
    el.innerHTML = '';
    v.word.split(' ').forEach(part => {
      const w = document.createElement('span'); w.className = 'w';
      [...part].forEach(ch => {
        const l = document.createElement('span'); l.className = 'l';
        if (ch !== '_' && !/[A-Z]/.test(ch)) { l.textContent = ch; l.classList.add('punct'); }
        w.append(l);
      });
      el.append(w);
    });
    V.word = v.word.replace(/[A-Z]/g, '_');
    V.round = v.round;
    $('#art').classList.remove('lost');
    requestAnimationFrame(fitWord);
  }
  const spots = [...el.querySelectorAll('.l')];
  const chars = [...v.word].filter(ch => ch !== ' ');
  let n = 0;
  chars.forEach((ch, i) => {
    const s = spots[i];
    if (!s || s.classList.contains('punct')) return;
    if (/[A-Z]/.test(ch) && !s.textContent) {
      const missed = v.revealed && !v.revealed[charIndex(v.word, i)];
      setTimeout(() => { s.textContent = ch; s.classList.add('pop'); if (missed) s.classList.add('missed'); }, (n++) * 90);
    }
  });
  V.word = v.word;
  $('#hint').textContent = v.hint ? `Hint: ${v.hint}` : '';
  const m = $('#msg'); m.textContent = v.msg; m.classList.toggle('hot', v.hot);
  const misses = v.misses.length;
  document.querySelectorAll('.part').forEach((p, i) => p.classList.toggle('on', i < misses));
  $('#art').classList.toggle('lost', v.phase === 'end' && !v.end.won);
  $('#misses').innerHTML = (misses ? v.misses.map(x => `<s>${esc(x)}</s>`).join('') + '&nbsp; ' : '') + `${v.left} ${v.left === 1 ? 'guess' : 'guesses'} left`;
  document.querySelectorAll('#keys .key').forEach(k => {
    const L = k.dataset.l;
    k.className = 'key' + (v.hits.includes(L) ? ' hit' : v.misses.includes(L) ? ' miss' : '');
  });
  $('#solving').hidden = !v.solving;
  if (v.solving) $('#solving').textContent = `${(v.players.find(p => p.id === v.turnId) || {}).name || 'Someone'} is typing a solve…`;
}
// Index into the full phrase (with spaces) of the i-th non-space character.
function charIndex(word, i) {
  let k = -1;
  for (let j = 0; j < word.length; j++) { if (word[j] !== ' ') k++; if (k === i) return j; }
  return -1;
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

function fitWord() {
  const el = $('#word'); if (!V.word) return;
  const longest = Math.max(...V.word.split(' ').map(w => w.length));
  const w = el.clientWidth || 600;
  let fs = w / (longest + (longest - 1) * 0.16 + 0.2);
  fs = Math.max(22, Math.min(fs, window.innerHeight * 0.13, 140));
  el.style.setProperty('--fs', fs + 'px');
  const play = el.parentElement; let guard = 0;
  while (play.scrollHeight > play.clientHeight + 2 && fs > 22 && guard++ < 25) { fs *= 0.93; el.style.setProperty('--fs', fs + 'px'); }
}
window.addEventListener('resize', fitWord);
try { document.fonts.ready.then(fitWord); } catch (e) {}

/* ---------- shot clock ---------- */
function setClock(v) {
  V.clock = v.timer ? { mode: v.timer.mode, total: v.timer.total, end: Date.now() + v.timer.remaining } : null;
  V.lastSec = -1;
  tick();
}
function tick() {
  const c = V.clock, clock = $('#clock');
  if (!c || V.phase !== 'play') { clock.hidden = true; return; }
  const ms = Math.max(0, c.end - Date.now()), sec = Math.ceil(ms / 1000);
  clock.hidden = false; clock.classList.toggle('low', sec <= 5);
  $('#clockNum').textContent = sec;
  $('#clockBar').style.transform = `scaleX(${Math.min(1, ms / c.total)})`;
  if (sec !== V.lastSec) { V.lastSec = sec; if (sec <= 5 && sec > 0) sfx('tick'); }
}
setInterval(tick, 100);

/* ---------- lobby ---------- */
async function loadThemes() {
  try { V.themes = await (await fetch('/api/themes')).json(); } catch (e) { V.themes = []; }
  if (V.view) renderLobby(V.view, false);
}
function renderLobby(v, entering) {
  if (entering) { loadThemes(); $('#lobbyErr').textContent = ''; }
  const list = $('#plist'); list.innerHTML = '';
  $('#plistTitle').textContent = v.players.length ? `Players (${v.players.length} of 8)` : 'Players';
  if (!v.players.length) { const li = document.createElement('li'); li.textContent = 'Nobody yet. Join on a phone to play.'; li.style.color = 'var(--chalk-soft)'; list.append(li); }
  v.players.forEach(p => {
    const li = document.createElement('li'); if (!p.connected) li.className = 'away';
    const dot = document.createElement('span'); dot.className = 'dot';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = p.name + (p.score ? `: ${p.score}` : '') + (p.connected ? '' : ' (phone off)');
    const rm = document.createElement('button'); rm.className = 'btn'; rm.textContent = 'Remove';
    rm.onclick = () => cmd('kick', { id: p.id });
    li.append(dot, n, rm); list.append(li);
  });
  const s = v.settings;
  const theme = $('#theme');
  if (document.activeElement !== theme) {
    theme.innerHTML = '';
    V.themes.forEach(t => theme.append(new Option(`${t.name} (${t.count} phrases)`, t.id)));
    theme.value = s.themeId;
  }
  const t = V.themes.find(x => x.id === s.themeId);
  const cat = $('#category');
  if (document.activeElement !== cat) {
    cat.innerHTML = '';
    cat.append(new Option('Any category', 'Anything'));
    (t ? t.categories : []).forEach(c => cat.append(new Option(`${c.name} (${c.count})`, c.name)));
    cat.value = s.category;
  }
  document.querySelectorAll('input[name=mode]').forEach(r => { r.checked = r.value === s.mode; });
  $('#showtime').checked = s.showtime;
  $('#timerOn').checked = s.timerOn;
  $('#target').value = String(s.target);
  $('#startGame').disabled = !v.players.length;
  $('#resetScores').hidden = !v.players.some(p => p.score);
}
const setting = obj => { $('#lobbyErr').textContent = ''; cmd('settings', { settings: obj }); };
$('#theme').onchange = e => setting({ themeId: e.target.value });
$('#category').onchange = e => setting({ category: e.target.value });
document.querySelectorAll('input[name=mode]').forEach(r => { r.onchange = () => setting({ mode: r.value }); });
$('#showtime').onchange = e => setting({ showtime: e.target.checked });
$('#timerOn').onchange = e => setting({ timerOn: e.target.checked });
$('#target').onchange = e => setting({ target: +e.target.value });
$('#startGame').onclick = () => { unlockAudio(); cmd('start'); };
$('#resetScores').onclick = () => cmd('resetScores');
$('#toFeud').onclick = () => cmd('switchGame', { to: 'feud' });
$('#toWheel').onclick = () => cmd('switchGame', { to: 'wheel' });

/* ---------- round over and champion ---------- */
function renderEnd(v) {
  const E = v.end;
  $('#endTitle').textContent = E.title;
  $('#endText').textContent = E.text;
  $('#endWord').textContent = E.word;
  const S = E.show;
  $('#show').hidden = !S;
  if (S) {
    $('#showWho').textContent = `Showtime for ${S.performerName}`;
    $('#showPrompt').textContent = S.prompt;
    $('#showTally').textContent = S.done ? '' : `Everyone else, vote on your phone: ${S.voted.length} of ${S.voters.length} voted.`;
    $('#showResult').textContent = S.result;
    $('#showSwap').hidden = S.done || S.voted.length > 0;
  }
  $('#nextRound').textContent = E.champion ? 'See who won' : 'Next round';
}
function renderChamp(v) {
  $('#champTitle').textContent = v.champ.title;
  const ol = $('#podium'); ol.innerHTML = '';
  v.champ.rows.forEach(r => { const li = document.createElement('li'); li.textContent = `${r.name}: ${r.score}`; ol.append(li); });
}
$('#nextRound').onclick = () => cmd('next');
$('#showSwap').onclick = () => cmd('swap');
$('#rematch').onclick = () => cmd('rematch');
$('#champLobby').onclick = () => cmd('lobby');
$('#secretRandom').onclick = () => cmd('secretRandom');

/* ---------- tools ---------- */
$('#btnNew').onclick = () => cmd('newWord');
$('#btnSkip').onclick = () => cmd('skip');
$('#btnLobby').onclick = () => { if (V.phase === 'lobby' || confirm('Go back to the lobby? Scores are kept.')) cmd('lobby'); };
$('#btnSound').onclick = () => { FX.on = !FX.on; $('#btnSound').textContent = FX.on ? 'Sound on' : 'Sound off'; if (FX.on) { unlockAudio(); sfx('cheer'); } };
$('#btnFull').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch (e) { $('#btnFull').textContent = 'Use your browser’s full screen'; }
};
if (!document.fullscreenEnabled) $('#btnFull').hidden = true;
document.addEventListener('fullscreenchange', () => {
  $('#btnFull').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  setTimeout(fitWord, 100);
});

/* ---------- sounds from the game ---------- */
function onFx(m) {
  switch (m.kind) {
    case 'hit': for (let i = 0; i < m.count; i++) setTimeout(() => sfx('ding', i, m.streak), i * 120); break;
    case 'miss': case 'timeout': sfx('buzz'); break;
    case 'win': sfx('win'); setTimeout(() => confetti(false), 1100); break;
    case 'lose': sfx('lose'); break;
    case 'cheer': sfx('cheer'); if (m.big) confetti(false); break;
    case 'lead': sfx('lead'); break;
    case 'champ': sfx('champ'); confetti(true); break;
    case 'join': sfx('join'); break;
    case 'vote': sfx('vote'); break;
  }
}

connect(false);

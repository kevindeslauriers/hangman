// Sound effects and confetti for the TV.
const FX = { on: true, ctx: null, keepAlive: null };

function sfx(kind, i = 0, streak = 0) {
  if (!FX.on) return;
  try {
    FX.ctx = FX.ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (FX.ctx.state !== 'running') FX.ctx.resume();
    const actx = FX.ctx, t0 = actx.currentTime;
    const tone = (f, start, dur, type = 'triangle', vol = 0.18) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.linearRampToValueAtTime(vol, t0 + start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(g).connect(actx.destination); o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
    };
    if (kind === 'ding') tone(660 * Math.pow(1.122, Math.min(i + streak, 10)), 0, 0.25);
    if (kind === 'tick') tone(1250, 0, 0.06, 'square', 0.06);
    if (kind === 'buzz') { tone(140, 0, 0.4, 'sawtooth', 0.12); tone(104, 0.05, 0.4, 'sawtooth', 0.1); }
    if (kind === 'win') [523, 659, 784, 1047].forEach((f, k) => tone(f, k * 0.11, 0.35));
    if (kind === 'lose') [392, 330, 262, 196].forEach((f, k) => tone(f, k * 0.2, 0.4, 'sine'));
    if (kind === 'cheer') [784, 988, 1175, 1568].forEach((f, k) => tone(f, k * 0.07, 0.3));
    if (kind === 'lead') [660, 880, 1100].forEach((f, k) => tone(f, k * 0.09, 0.2, 'square', 0.06));
    if (kind === 'join') [523, 784].forEach((f, k) => tone(f, k * 0.08, 0.18, 'triangle', 0.1));
    if (kind === 'vote') tone(880, 0, 0.12, 'triangle', 0.08);
    if (kind === 'champ') [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, k) => tone(f, k * 0.14, 0.32, 'square', 0.07));
  } catch (e) {}
}

// iPhone or iPad driving the TV over AirPlay: play through the silent switch.
function silentWav() {
  const n = 8000, buf = new Uint8Array(44 + n), dv = new DataView(buf.buffer);
  const str = (o, s) => [...s].forEach((c, i) => { buf[o + i] = c.charCodeAt(0); });
  str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  str(36, 'data'); dv.setUint32(40, n, true); buf.fill(128, 44);
  let bin = ''; buf.forEach(b => { bin += String.fromCharCode(b); });
  return 'data:audio/wav;base64,' + btoa(bin);
}
function unlockAudio() {
  if (!FX.on) return;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  try {
    FX.ctx = FX.ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (FX.ctx.state !== 'running') FX.ctx.resume();
  } catch (e) {}
  try {
    if (!FX.keepAlive) { FX.keepAlive = new Audio(silentWav()); FX.keepAlive.loop = true; FX.keepAlive.setAttribute('playsinline', ''); }
    if (FX.keepAlive.paused) FX.keepAlive.play().catch(() => {});
  } catch (e) {}
}
['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, unlockAudio, { passive: true }));

function confetti(big) {
  const c = document.getElementById('confetti'); if (!c) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = c.getContext('2d'); const W = c.width = innerWidth, H = c.height = innerHeight;
  const cols = ['#F4D56E', '#F0A1B1', '#A9D4E9', '#F2EEE3', '#9FE0B0'];
  const ps = Array.from({ length: big ? 280 : 130 }, () => ({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3, s: 8 + Math.random() * 10, c: cols[Math.floor(Math.random() * cols.length)] }));
  const end = performance.now() + (big ? 5000 : 2800);
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
    if (t < end) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  })(performance.now());
}

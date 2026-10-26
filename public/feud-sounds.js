// Family Face-Off sound effects, built from scratch with Web Audio: the bell
// ding, the "ehhhn" strike buzzer, brass stings, the Fast Money buzzer and
// a crowd. Any of them can be replaced with a recording: put an .mp3 with
// the same name in public/sounds/ (see README) and it plays instead.

const FS = { ctx: null, out: null, on: true, voice: true, custom: {}, noise: null };
const SOUND_NAMES = ['ding', 'strike', 'buzzin', 'flip', 'round', 'control', 'steal', 'win', 'keep', 'applause',
  'fastStart', 'fastEnd', 'fastZero', 'dupe', 'champ', 'join', 'lock', 'tick', 'theme'];

function fsCtx() {
  if (!FS.ctx) {
    FS.ctx = new (window.AudioContext || window.webkitAudioContext)();
    // A gentle compressor keeps stacked sounds (ding + applause) from clipping.
    const comp = FS.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    FS.out = FS.ctx.createGain(); FS.out.gain.value = 0.9;
    FS.out.connect(comp).connect(FS.ctx.destination);
  }
  if (FS.ctx.state !== 'running') FS.ctx.resume().catch(() => {});
  return FS.ctx;
}

function noiseBuffer() {
  if (FS.noise) return FS.noise;
  const a = fsCtx(), len = a.sampleRate * 2;
  const b = a.createBuffer(1, len, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return (FS.noise = b);
}

// One oscillator with an attack/decay envelope.
function osc(type, freq, t, dur, vol, { attack = 0.005, dest, detune = 0, release } = {}) {
  const a = fsCtx(), o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq; o.detune.value = detune;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  if (release) { g.gain.setValueAtTime(vol, t + dur - release); g.gain.linearRampToValueAtTime(0.0001, t + dur); }
  else g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest || FS.out);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}

function noise(t, dur, vol, { type = 'bandpass', freq = 1500, q = 1, to, attack = 0.002, dest } = {}) {
  const a = fsCtx(), s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = noiseBuffer(); s.loop = true;
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(dest || FS.out);
  s.start(t, Math.random()); s.stop(t + dur + 0.05);
}

// The right-answer bell: a struck metal bar, bright and ringing.
function bell(t, f0 = 1318.5, vol = 0.5) {
  [[1, 1, 1.9], [2.0, 0.42, 1.2], [2.76, 0.3, 0.9], [5.4, 0.16, 0.5], [8.93, 0.08, 0.3]]
    .forEach(([r, v, d]) => osc('sine', f0 * r, t, d, vol * v, { attack: 0.002 }));
  noise(t, 0.03, vol * 0.5, { type: 'highpass', freq: 4000 });
}

// The wrong-answer buzzer: a low, nasal, distorted "EHHHN".
function buzzer(t, dur = 0.95, vol = 0.17, f0 = 146) {
  const a = fsCtx();
  const shape = a.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3.2); }
  shape.curve = curve;
  const pre = a.createGain(); pre.gain.value = 0.9;
  const f1 = a.createBiquadFilter(); f1.type = 'peaking'; f1.frequency.value = 650; f1.Q.value = 2; f1.gain.value = 12;
  const f2 = a.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 1650; f2.Q.value = 3; f2.gain.value = 9;
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.setValueAtTime(vol, t + dur - 0.07);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  pre.connect(shape).connect(f1).connect(f2).connect(lp).connect(g).connect(FS.out);
  [[f0, 'sawtooth', 0], [f0, 'sawtooth', 9], [f0 / 2, 'square', 0], [f0 * 2, 'square', -6]].forEach(([fr, type, det]) => {
    const o = a.createOscillator(); o.type = type; o.frequency.value = fr; o.detune.value = det;
    o.connect(pre); o.start(t); o.stop(t + dur + 0.05);
  });
}

// Brass section: detuned saws through a filter that opens on each note.
function brass(t, freqs, dur, vol = 0.09) {
  const a = fsCtx();
  freqs.forEach(fr => {
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(Math.min(5200, fr * 6), t + 0.06);
    f.frequency.exponentialRampToValueAtTime(Math.min(2600, fr * 3.5), t + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol * 0.85, t + Math.max(0.05, dur - 0.08));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(FS.out);
    [-7, 0, 7].forEach(det => {
      const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    });
  });
}

function timpani(t, f = 98, vol = 0.35) {
  const a = fsCtx(), o = a.createOscillator(), g = a.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  o.connect(g).connect(FS.out); o.start(t); o.stop(t + 1.2);
  noise(t, 0.12, vol * 0.4, { type: 'lowpass', freq: 600 });
}

function cymbal(t, dur = 1.6, vol = 0.12) {
  noise(t, dur, vol, { type: 'highpass', freq: 6000, q: 0.5 });
  noise(t, dur * 0.6, vol * 0.6, { type: 'bandpass', freq: 9000, q: 0.8 });
}

// A studio audience: hundreds of claps over a noisy bed that swells and fades.
function crowd(t, dur = 3.2, vol = 0.5, cheer = true) {
  const a = fsCtx();
  const bed = a.createGain();
  bed.gain.setValueAtTime(0.0001, t);
  bed.gain.linearRampToValueAtTime(vol * 0.9, t + 0.35);
  bed.gain.setValueAtTime(vol * 0.9, t + dur * 0.55);
  bed.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  bed.connect(FS.out);
  noise(t, dur, 0.5, { type: 'bandpass', freq: 1800, q: 0.4, attack: 0.3, dest: bed });
  const n = Math.round(dur * 140);
  for (let i = 0; i < n; i++) {
    const at = t + Math.pow(Math.random(), 1.3) * dur * 0.92;
    const fade = 1 - (at - t) / dur;
    noise(at, 0.012 + Math.random() * 0.02, vol * (0.6 + Math.random() * 0.8) * fade,
      { type: 'bandpass', freq: 900 + Math.random() * 2200, q: 1.2 + Math.random() * 2 });
  }
  if (cheer) {
    // A few whoops from the crowd.
    for (let k = 0; k < 3; k++) {
      const at = t + 0.15 + Math.random() * 0.8, f = 500 + Math.random() * 300;
      const o = a.createOscillator(), g = a.createGain(), bp = a.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f, at); o.frequency.linearRampToValueAtTime(f * 1.6, at + 0.25); o.frequency.linearRampToValueAtTime(f * 1.2, at + 0.6);
      bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 3;
      g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(vol * 0.05, at + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.65);
      o.connect(bp).connect(g).connect(FS.out); o.start(at); o.stop(at + 0.7);
    }
  }
}

const N = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, Bb4: 466.16, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, C6: 1046.5 };

const SYNTH = {
  ding: t => bell(t),
  strike: t => buzzer(t),
  // Face-off podium buzzer: short and electric.
  buzzin: t => { osc('square', 1046.5, t, 0.32, 0.12, { release: 0.04 }); osc('square', 1054, t, 0.32, 0.08, { release: 0.04 }); noise(t, 0.05, 0.1, { type: 'highpass', freq: 3000 }); },
  // A tile turning over at the end of a round.
  flip: t => { noise(t, 0.24, 0.45, { freq: 500, to: 2600, q: 1.2 }); osc('triangle', 220, t, 0.08, 0.12); },
  // Round sting: timpani and a rising brass flourish, then a chord.
  round: t => {
    timpani(t, 98); timpani(t + 0.12, 98, 0.25);
    brass(t, [N.G4], 0.12); brass(t + 0.13, [N.G4], 0.12); brass(t + 0.26, [N.C5], 0.12);
    brass(t + 0.39, [N.C5, N.E5, N.G5], 0.9, 0.08); cymbal(t + 0.39, 1.4);
  },
  control: t => { brass(t, [N.E5], 0.1); brass(t + 0.11, [N.G4, N.C5, N.E5], 0.45, 0.07); },
  // Steal: a low, tense pulse.
  steal: t => { [0, 0.5, 1.0].forEach(d => { timpani(t + d, 73.4, 0.3); brass(t + d, [N.D4 / 2, N.D4], 0.35, 0.05); }); },
  win: t => {
    timpani(t, 98); brass(t, [N.C5, N.E5, N.G5], 0.16, 0.08); brass(t + 0.18, [N.C5, N.E5, N.G5], 0.16, 0.08);
    brass(t + 0.36, [N.D5, N.F5, N.A5], 0.16, 0.08); brass(t + 0.54, [N.E5, N.G5, N.C6], 1.1, 0.08); cymbal(t + 0.54);
    crowd(t + 0.3, 3.4, 0.5);
  },
  keep: t => { brass(t, [N.G4, N.C5], 0.25, 0.06); brass(t + 0.28, [N.F4, N.A4, N.C5], 0.6, 0.06); crowd(t + 0.2, 2.2, 0.3, false); },
  applause: t => crowd(t, 3.5, 0.55),
  fastStart: t => { brass(t, [N.C5, N.E5, N.G5], 0.12, 0.08); brass(t + 0.14, [N.C5, N.E5, N.G5, N.C6], 0.4, 0.08); },
  // Fast Money's clock runs out: a two-tone horn.
  fastEnd: t => { buzzer(t, 0.32, 0.15, 330); buzzer(t + 0.36, 0.5, 0.15, 262); },
  // A Fast Money answer worth nothing.
  fastZero: t => { buzzer(t, 0.22, 0.14, 196); buzzer(t + 0.26, 0.3, 0.14, 196); },
  // "Already said": two quick blips.
  dupe: t => { osc('square', 330, t, 0.13, 0.2, { release: 0.03 }); osc('square', 330, t + 0.18, 0.13, 0.2, { release: 0.03 }); },
  champ: t => {
    timpani(t, 98); timpani(t + 0.15, 98, 0.25); timpani(t + 0.3, 98, 0.25);
    const seq = [[N.G4, 0.15], [N.C5, 0.15], [N.E5, 0.15], [N.G5, 0.45], [N.E5, 0.15], [N.G5, 1.3]];
    let d = 0.45;
    seq.forEach(([f, len]) => { brass(t + d, [f, f / 2, f * 1.26], len, 0.07); d += len + 0.02; });
    cymbal(t + d - 1.3, 2);
    crowd(t + 0.4, 5, 0.6);
  },
  join: t => { osc('triangle', N.C5, t, 0.15, 0.25); osc('triangle', N.G5, t + 0.08, 0.2, 0.25); },
  lock: t => { osc('square', 880, t, 0.06, 0.14); osc('square', 1320, t + 0.05, 0.08, 0.12); },
  tick: t => { noise(t, 0.035, 0.6, { type: 'bandpass', freq: 2500, q: 3 }); osc('sine', 1800, t, 0.03, 0.08); },
  theme: () => {},
};

// Recordings in public/sounds/ win over the built-in sounds.
async function loadCustomSounds() {
  try {
    const names = await (await fetch('/api/sounds')).json();
    for (const n of names) {
      try {
        const buf = await (await fetch(`/sounds/${n}.mp3`)).arrayBuffer();
        FS.custom[n] = await fsCtx().decodeAudioData(buf);
      } catch (e) {}
    }
  } catch (e) {}
}

function playSound(name, delay = 0) {
  if (!FS.on) return;
  try {
    const a = fsCtx(), t = a.currentTime + 0.02 + delay;
    if (FS.custom[name]) {
      const s = a.createBufferSource(); s.buffer = FS.custom[name]; s.connect(FS.out); s.start(t);
      return;
    }
    if (SYNTH[name]) SYNTH[name](t);
  } catch (e) {}
}

// The host. Uses the browser's built-in voice; off if the TV has none.
let hostVoice = null;
function pickVoice() {
  try {
    const vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
    const pref = ['Google US English', 'Microsoft Guy', 'Microsoft David', 'Daniel', 'Alex', 'Fred', 'Aaron', 'Microsoft Mark'];
    hostVoice = pref.map(p => vs.find(v => v.name.includes(p))).find(Boolean) || vs.find(v => /male/i.test(v.name)) || vs[0] || null;
  } catch (e) {}
}
try { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; } catch (e) {}

function hostSay(text) {
  if (!FS.on || !FS.voice || !window.speechSynthesis) return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (hostVoice) u.voice = hostVoice;
    u.rate = 1.0; u.pitch = 0.8; u.volume = 1;
    speechSynthesis.speak(u);
    return true;
  } catch (e) { return false; }
}

function unlockFeudAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  try { fsCtx(); } catch (e) {}
}
['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, unlockFeudAudio, { passive: true }));

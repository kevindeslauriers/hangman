// Answer Board sounds, built on the Face-Off sound engine (feud-sounds.js).
// The final-round "thinking" tune is an original, not the TV show's.
// public/sounds/quiz-<name>.mp3 replaces any of them.

// A soft mallet note (marimba-ish): a sine with a quick decay and a touch of overtone.
function mallet(t, f, vol = 0.16, dur = 0.5) {
  vol *= 1.8;
  osc('sine', f, t, dur, vol, { attack: 0.004 });
  osc('sine', f * 4, t, dur * 0.25, vol * 0.18, { attack: 0.002 });
}

Object.assign(SYNTH, {
  // The board filling in: a flurry of little pops.
  'quiz-board': t => { for (let k = 0; k < 30; k++) mallet(t + k * 0.045, 600 + ((k * 7) % 12) * 60, 0.2, 0.18); },
  // Picking a clue: a quick rising whoosh.
  'quiz-pick': t => { noise(t, 0.3, 0.9, { freq: 400, to: 3000, q: 1.2 }); osc('sine', 660, t + 0.05, 0.25, 0.22); },
  'quiz-buzz': t => { osc('square', 1318, t, 0.08, 0.28); osc('square', 1760, t + 0.07, 0.12, 0.28); },
  'quiz-right': t => { bell(t, 1318.5, 0.32); bell(t + 0.12, 1975.5, 0.22); },
  'quiz-wrong': t => { osc('triangle', 220, t, 0.35, 0.45); osc('triangle', 207, t + 0.05, 0.35, 0.35); },
  // Time's up: three falling tones.
  'quiz-timesup': t => { [880, 740, 587].forEach((f, k) => { osc('sine', f, t + k * 0.28, 0.26, 0.25, { release: 0.06 }); osc('square', f, t + k * 0.28, 0.26, 0.04, { release: 0.06 }); }); },
  // Daily Double: a laser sweep and sparkles.
  'quiz-dailydouble': t => {
    const a = fsCtx(), o = a.createOscillator(), g = a.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(1760, t + 0.6); o.frequency.exponentialRampToValueAtTime(440, t + 1.1);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.1, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g).connect(FS.out); o.start(t); o.stop(t + 1.25);
    for (let k = 0; k < 8; k++) bell(t + 0.5 + k * 0.07, 2000 + k * 260, 0.08);
    brass(t + 0.6, [N.C5, N.E5, N.G5, N.C6], 0.7, 0.06);
  },
  'quiz-roundbreak': t => SYNTH.round(t),
  'quiz-final': t => { timpani(t, 98); timpani(t + 0.4, 98); brass(t + 0.8, [N.F4, N.A4, N.C5, N.F5], 1.4, 0.07); cymbal(t + 0.8, 2); },
  // The thinking tune: 30 seconds of a gentle mallet waltz with a ticking clock.
  'quiz-think': t => {
    const beat = 0.5;
    const tune = [
      [N.C5, N.A4, N.F4], [N.D5, N.Bb4, N.F4], [N.C5, N.A4, N.F4], [N.G4, N.E4, N.C4],
      [N.A4, N.F4, N.C4], [N.Bb4, N.G4, N.D4], [N.C5, N.A4, N.F4], [N.E5, N.C5, N.G4],
    ];
    const bars = 20;                       // 20 bars of 3 beats = 30 seconds
    for (let b = 0; b < bars; b++) {
      const [hi, mid, low] = tune[b % tune.length];
      const t0 = t + b * 3 * beat;
      mallet(t0, low / 2, 0.14, 0.9);
      mallet(t0 + beat, mid, 0.09, 0.4); mallet(t0 + beat, hi, 0.09, 0.4);
      mallet(t0 + 2 * beat, mid, 0.09, 0.4); mallet(t0 + 2 * beat, hi, 0.09, 0.4);
      if (b % 2 === 1) mallet(t0 + 2.5 * beat, hi * 1.5, 0.06, 0.25);
      for (let k = 0; k < 3; k++) noise(t0 + k * beat, 0.03, k ? 0.25 : 0.4, { type: 'bandpass', freq: k ? 3200 : 2200, q: 4 });
    }
    // Time: a low bong.
    const end = t + bars * 3 * beat;
    bell(end, 196, 0.4); osc('sine', 98, end, 1.5, 0.25);
  },
  'quiz-champ': t => SYNTH.champ(t),
});

// Fade out whatever is playing (the thinking tune when everyone answers early).
function hushSounds() {
  if (!FS.ctx || !FS.out) return;
  const a = FS.ctx, old = FS.out;
  old.gain.setTargetAtTime(0.0001, a.currentTime, 0.08);
  setTimeout(() => { try { old.disconnect(); } catch (e) {} }, 600);
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  FS.out = a.createGain(); FS.out.gain.value = 0.9;
  FS.out.connect(comp).connect(a.destination);
}

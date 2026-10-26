// Spin & Solve sounds, built on the Face-Off sound engine (feud-sounds.js):
// pegs clicking past the flapper, a ding for every letter turned, the buzzer,
// the Bankrupt "wah-wah", a cash register for vowels and the solve jingle.
// Like the others, public/sounds/wheel-<name>.mp3 replaces any of them.

Object.assign(SYNTH, {
  // A peg slapping the rubber flapper.
  'wheel-tick': t => { noise(t, 0.022, 1.6, { type: 'bandpass', freq: 3000, q: 1.8 }); osc('square', 2100, t, 0.014, 0.12); osc('sine', 190, t, 0.035, 0.3); },
  // Each letter turning over.
  'wheel-ding': t => bell(t, 1567.98, 0.42),
  // No such letter.
  'wheel-buzz': t => buzzer(t, 0.55, 0.15, 196),
  'wheel-wrong': t => buzzer(t, 0.4, 0.14, 165),
  // Bankrupt: a sad descending horn, then the audience groans.
  'wheel-bankrupt': t => {
    [[392, 0], [370, 0.32], [349, 0.64]].forEach(([f, d]) => brass(t + d, [f / 2, f], 0.28, 0.11));
    const a = fsCtx(), o = a.createOscillator(), g = a.createGain(), lp = a.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(330, t + 0.96); o.frequency.linearRampToValueAtTime(300, t + 2.1);
    const lfo = a.createOscillator(), lg = a.createGain(); lfo.frequency.value = 6; lg.gain.value = 9; lfo.connect(lg).connect(o.frequency);
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t + 0.96); g.gain.linearRampToValueAtTime(0.14, t + 1.02); g.gain.linearRampToValueAtTime(0.0001, t + 2.2);
    o.connect(lp).connect(g).connect(FS.out); o.start(t + 0.96); o.stop(t + 2.3); lfo.start(t + 0.96); lfo.stop(t + 2.3);
    noise(t + 0.9, 1.5, 0.35, { type: 'bandpass', freq: 520, to: 300, q: 1.5, attack: 0.15 });
  },
  'wheel-loseturn': t => { brass(t, [440, 220], 0.22, 0.08); brass(t + 0.26, [349, 175], 0.45, 0.08); },
  // Puzzle solved: a bright run up, a chime and applause.
  'wheel-solve': t => {
    [N.C5, N.E5, N.G5, N.C6, N.E5 * 2, N.G5 * 2].forEach((f, k) => osc('triangle', f, t + k * 0.06, 0.4, 0.12));
    bell(t + 0.38, 2093, 0.3);
    brass(t + 0.38, [N.C5, N.E5, N.G5], 0.8, 0.07);
    crowd(t + 0.3, 3.6, 0.55);
  },
  'wheel-round': t => {
    timpani(t, 110); brass(t, [N.D5], 0.12); brass(t + 0.13, [N.D5], 0.12); brass(t + 0.26, [N.G5], 0.12);
    brass(t + 0.39, [N.G4, N.B4, N.D5, N.G5], 0.9, 0.07); cymbal(t + 0.39, 1.4);
  },
  // A toss-up letter popping onto the board.
  'wheel-tossup': t => { osc('sine', 988, t, 0.14, 0.4); osc('sine', 1976, t, 0.09, 0.14); },
  'wheel-buzzin': t => SYNTH.buzzin(t),
  // Buying a vowel: the cash register.
  'wheel-vowel': t => { noise(t, 0.05, 0.4, { type: 'highpass', freq: 2500 }); bell(t + 0.04, 2637, 0.25); bell(t + 0.1, 3520, 0.18); },
  'wheel-bonus': t => {
    for (let k = 0; k < 10; k++) timpani(t + k * 0.07, 98, 0.08 + k * 0.02);
    brass(t + 0.75, [N.C5, N.E5, N.G5, N.C6], 1.1, 0.07); cymbal(t + 0.75, 1.8);
  },
  'wheel-bonuswin': t => SYNTH.champ(t),
  'wheel-bonuslose': t => SYNTH.keep(t),
  // The puzzle board lighting up for a new round.
  'wheel-puzzle': t => { [N.C6, N.G5, N.E5, N.C5, N.G5, N.C6].forEach((f, k) => osc('sine', f, t + k * 0.05, 0.5, 0.14)); },
});

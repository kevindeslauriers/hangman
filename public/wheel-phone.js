// Spin & Solve on a phone. phone.js handles joining and calls wheelScreen()
// with the game's view; the helpers (h, btn, draft, send, nameOf) live there.
const W$ = n => '$' + Number(n).toLocaleString('en-US');

function wheelBoard(v) {
  if (!v.board) return null;
  return h('div', { className: 'mboard' }, v.board.join('').split('').map(ch =>
    h('span', { className: ch === '#' ? 'off' : ch === '.' ? 'g' : 't', textContent: /[A-Z'&-]/.test(ch) ? ch : '' })));
}

function wheelInput(label, cmdName) {
  const go = () => { const a = (P.drafts.wa || '').trim(); if (!a) return; P.drafts.wa = ''; send(cmdName, { a }); };
  const inp = draft('wa', { type: 'text', placeholder: 'Type the whole puzzle', aria: 'Your answer', autocapitalize: 'characters', enterKeyHint: 'send' });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  setTimeout(() => { const n = document.getElementById('wa'); if (n && document.activeElement !== n) n.focus(); }, 0);
  return h('div', { className: 'panel' }, inp, btn(label, go, 'btn primary'));
}

function letterPad(letters, used, onPick, picked = '') {
  return h('div', { className: 'keys' }, [...letters].map(L => {
    const b = h('button', { className: 'key' + (picked.includes(L) ? ' hit' : ''), textContent: L, aria: L, disabled: used.includes(L) });
    b.onclick = () => onPick(L, b);
    return b;
  }));
}

// Press and hold to wind up; let go to spin. Longer hold, harder spin.
function spinButton() {
  const meter = h('i', { className: 'meter' });
  const b = h('button', { className: 'bigspin', aria: 'Spin the wheel' }, h('span', { textContent: 'SPIN' }), h('small', { textContent: 'hold, then let go' }), meter);
  let t0 = 0, raf = 0;
  const power = () => Math.min(1, (performance.now() - t0) / 1500);
  const grow = () => { meter.style.transform = `scaleX(${power()})`; raf = requestAnimationFrame(grow); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); t0 = performance.now(); buzz(20); grow(); });
  const release = () => { if (!t0) return; cancelAnimationFrame(raf); const p = power(); t0 = 0; buzz(60); send('spin', { power: p }); };
  b.addEventListener('pointerup', release);
  b.addEventListener('pointerleave', release);
  b.addEventListener('contextmenu', e => e.preventDefault());
  return b;
}

function wheelScreen(v) {
  const me = P.me;
  const meP = v.players.find(p => p.id === me) || {};
  const out = [];
  let myTurn = false;
  out.push(h('ul', { className: 'scores' }, v.players.map(p => h('li', { className: p.id === v.turnId ? 'now' : '' },
    h('span', { textContent: p.name + ' ' }), h('b', { textContent: W$(p.bank) })))));
  if (v.category) out.push(h('p', { className: 'small', textContent: `${v.phase.startsWith('toss') ? 'Toss-up' : v.phase.startsWith('bonus') ? 'Bonus Round' : `Round ${v.round}`} · ${v.category}` }));
  out.push(wheelBoard(v));
  out.push(h('p', { className: 'clock', id: 'clock' }));
  const say = t => out.push(h('p', { className: 'msg', textContent: t }));
  const CONS = 'BCDFGHJKLMNPQRSTVWXYZ', VOW = 'AEIOU';

  if (v.phase === 'tossup') {
    const t = v.toss;
    if (t.buzzer === me) { myTurn = true; out.push(h('p', { className: 'turn mine', textContent: 'Solve it!' }), wheelInput('Lock it in', 'tossSolve')); }
    else if (!t.buzzer && !t.locked.includes(me)) out.push(h('button', { className: 'bigbuzz', textContent: 'BUZZ', on: { click: () => { buzz(40); playSound('wheel-buzzin'); send('buzz'); } } }));
    else if (t.locked.includes(me)) say('You had your try. Watch the others!');
    say(v.msg);
  } else if (['turn', 'spinning', 'consonant', 'vowel', 'solving'].includes(v.phase)) {
    const mine = v.turnId === me;
    if (!mine) {
      out.push(h('p', { className: 'turn', textContent: v.phase === 'spinning' ? `${nameOf(v.turnId)} is spinning…` : `${nameOf(v.turnId)}’s turn` }));
      say(v.msg);
    } else {
      myTurn = v.phase !== 'spinning';
      if (v.phase === 'turn') {
        out.push(h('p', { className: 'turn mine', textContent: 'Your turn!' }));
        say(v.msg);
        if (v.canSpin) out.push(spinButton()); else out.push(h('p', { className: 'small', textContent: 'Only vowels are left. Buy a vowel or solve!' }));
        out.push(h('div', { className: 'row2' },
          btn(`Buy a vowel ${W$(v.vowelCost)}`, () => send('buyVowel'), 'btn', { disabled: !v.canVowel }),
          btn('Solve', () => send('solveStart'), 'btn green')));
      } else if (v.phase === 'spinning') {
        out.push(h('p', { className: 'turn mine', textContent: 'Spinning…' }), h('p', { className: 'small', textContent: 'Watch the TV!' }));
      } else if (v.phase === 'consonant') {
        out.push(h('p', { className: 'turn mine', textContent: `${W$(v.spinValue)}! Call a consonant` }));
        out.push(letterPad(CONS, v.used, L => send('consonant', { l: L })));
      } else if (v.phase === 'vowel') {
        out.push(h('p', { className: 'turn mine', textContent: 'Pick a vowel' }));
        out.push(letterPad(VOW, v.used, L => send('vowel', { l: L })), btn('Never mind', () => send('cancelPick'), 'btn'));
      } else if (v.phase === 'solving') {
        out.push(h('p', { className: 'turn mine', textContent: 'Solve the puzzle' }), wheelInput('Solve', 'solve'), btn('Never mind', () => send('solveCancel'), 'btn'));
      }
    }
    if (v.used) out.push(h('p', { className: 'small', textContent: `Called: ${v.used.split('').join(' ') || 'nothing yet'}` }));
  } else if (v.phase === 'tossDone' || v.phase === 'roundEnd') {
    out.push(h('p', { className: 'turn mine', textContent: v.msg }));
    if (v.phase === 'roundEnd') out.push(btn(v.round < v.settings.rounds ? 'Next round' : v.settings.bonus ? 'On to the Bonus Round' : 'Final scores', () => send('next'), 'btn primary'));
  } else if (v.phase === 'bonusPick') {
    if (v.bonus.playerId === me) {
      myTurn = true;
      const picks = P.drafts.bonusPicks || '';
      const toggle = (L, set) => {
        let cur = P.drafts.bonusPicks || '';
        if (cur.includes(L)) cur = cur.replace(L, '');
        else if ([...cur].filter(c => set.includes(c)).length < (set === VOW ? 1 : 3)) cur += L;
        P.drafts.bonusPicks = cur; render();
      };
      const given = v.bonus.given;
      out.push(h('p', { className: 'turn mine', textContent: 'Pick 3 consonants' }),
        letterPad([...CONS].filter(c => !given.includes(c)).join(''), '', L => toggle(L, CONS), picks),
        h('p', { className: 'turn mine', textContent: 'and 1 vowel' }),
        letterPad([...VOW].filter(c => !given.includes(c)).join(''), '', L => toggle(L, VOW), picks),
        btn(`Lock in ${picks.split('').join(' ') || '…'}`, () => { send('bonusPick', { letters: picks }); P.drafts.bonusPicks = ''; }, 'btn primary', { disabled: picks.length !== 4 }));
    } else say(`${nameOf(v.bonus.playerId)} is picking letters for the Bonus Round…`);
  } else if (v.phase === 'bonusSolve') {
    if (v.bonus.playerId === me) { myTurn = true; out.push(h('p', { className: 'turn mine', textContent: 'Solve it! Keep guessing!' }), wheelInput('Guess', 'bonusGuess')); }
    else say(`${nameOf(v.bonus.playerId)} has 10 seconds…`);
  } else if (v.phase === 'bonusDone') {
    out.push(h('p', { className: 'turn mine', textContent: v.msg }), btn('Final scores', () => send('finish'), 'btn primary'));
  } else if (v.phase === 'champ') {
    out.push(h('p', { className: 'turn mine', textContent: v.champ.title }),
      h('ol', { className: 'podium' }, v.champ.rows.map(r => h('li', { textContent: `${r.name}: ${W$(r.score)}` }))),
      btn('New game', () => send('newGame'), 'btn primary'));
  }
  out.push(h('p', { className: 'small', textContent: `Your total: ${W$(meP.score || 0)}` }));

  const key = myTurn ? v.phase + v.round : '';
  if (key && key !== P.wheelTurn) buzz([80, 60, 80]);
  P.wheelTurn = key;
  return out.filter(Boolean);
}

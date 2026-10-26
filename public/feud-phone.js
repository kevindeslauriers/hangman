// Family Face-Off on a phone. phone.js handles joining and calls feudScreen()
// with the game's view; the helpers (h, btn, draft, send, nameOf) live there.

function feudAnswerBox(label, cmdName, extra = {}) {
  const go = () => {
    const a = (P.drafts.fa || '').trim();
    if (!a) return;
    P.drafts.lastAnswer = a;
    P.drafts.fa = '';
    send(cmdName, { a, ...extra });
  };
  const inp = draft('fa', { type: 'text', placeholder: 'Type your answer', aria: 'Your answer', autocapitalize: 'characters', enterKeyHint: 'send' });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  setTimeout(() => { const n = document.getElementById('fa'); if (n && document.activeElement !== n) n.focus(); }, 0);
  return h('div', { className: 'panel' }, inp, btn(label, go, 'btn primary'));
}

function feudBoard(v) {
  if (!v.board.length) return null;
  return h('ol', { className: 'mini' }, v.board.map(a => h('li', { className: a.text ? (a.found ? 'on' : 'off') : '' },
    h('span', { textContent: a.text || String(a.n) }), h('b', { textContent: a.text ? String(a.points) : '' }))));
}

function feudScreen(v) {
  const me = P.me;
  const out = [];
  const famList = h('ul', { className: 'scores' }, v.players.map(p => h('li', { className: p.id === v.controlId ? 'now' : '' },
    h('span', { textContent: p.name + ' ' }), h('b', { textContent: String(p.score) }))));
  const header = () => {
    out.push(famList);
    if (v.round) out.push(h('p', { className: 'small', textContent: `Round ${v.round}${v.multiplier > 1 ? (v.multiplier === 2 ? ' · DOUBLE POINTS' : ' · TRIPLE POINTS') : ''} · Bank ${v.bank}` }));
    if (v.question) out.push(h('p', { className: 'q', textContent: v.question }));
    out.push(h('p', { className: 'clock', id: 'clock' }));
  };
  const strikes = () => h('p', { className: 'xs', textContent: '✕'.repeat(v.strikes) || ' ' });
  const say = t => out.push(h('p', { className: 'msg', textContent: t }));
  let myTurn = false;

  if (v.phase === 'faceoff') {
    header();
    const f = v.faceoff;
    if (f.answering === me) {
      myTurn = true;
      out.push(h('p', { className: 'turn mine', textContent: 'Face-off! Your answer?' }), feudAnswerBox('Lock it in', 'faceoff'));
    } else if (f.open && !f.contenders.includes(me)) {
      out.push(h('button', { className: 'bigbuzz', textContent: 'BUZZ', on: { click: () => { buzz(40); playSound('buzzin'); send('buzz'); } } }));
      say(v.msg);
    } else {
      say(v.msg);
      if (f.contenders.includes(me)) out.push(h('p', { className: 'small', textContent: 'You’re in the face-off. Wait for your turn.' }));
    }
    out.push(feudBoard(v));
  } else if (v.phase === 'decide') {
    header();
    if (v.controlId === me) {
      myTurn = true;
      out.push(h('p', { className: 'turn mine', textContent: 'You won the face-off!' }),
        h('div', { className: 'row2' }, btn('Play', () => send('decide', { choice: 'play' }), 'btn primary big'), btn('Pass', () => send('decide', { choice: 'pass' }), 'btn big')));
    } else say(v.msg);
    out.push(feudBoard(v));
  } else if (v.phase === 'play') {
    header();
    out.push(strikes());
    if (v.controlId === me) {
      myTurn = true;
      out.push(h('p', { className: 'turn mine', textContent: 'Name an answer!' }), feudAnswerBox('Survey says…', 'answer'));
    } else out.push(h('p', { className: 'turn', textContent: `${nameOf(v.controlId)} is playing` }));
    say(v.msg);
    out.push(feudBoard(v));
  } else if (v.phase === 'steal') {
    header();
    out.push(strikes());
    if (v.controlId === me) out.push(h('p', { className: 'turn', textContent: 'Three strikes! Everyone else is trying to steal…' }));
    else if (v.steal.locked.includes(me)) out.push(h('p', { className: 'turn', textContent: `Locked in: ${(P.drafts.lastAnswer || '').toUpperCase()}` }));
    else {
      myTurn = true;
      out.push(h('p', { className: 'turn mine', textContent: `Steal the ${v.bank} points!` }), feudAnswerBox('Steal it!', 'steal'));
    }
    out.push(feudBoard(v));
  } else if (v.phase === 'reveal') {
    header();
    out.push(h('p', { className: 'turn mine', textContent: v.msg }));
    if (v.steal && v.steal.answers) {
      out.push(h('ul', { className: 'small' }, Object.entries(v.steal.answers).map(([id, a]) => h('li', { textContent: `${nameOf(id)} tried “${a.text}” ${a.idx >= 0 ? '✓' : '✕'}` }))));
    }
    out.push(feudBoard(v));
    out.push(btn(v.players.some(p => p.score >= v.target) ? 'On to Fast Money' : 'Next round', () => send('next'), 'btn primary'));
  } else if (v.phase === 'fastPick') {
    out.push(famList, h('p', { className: 'turn mine', textContent: 'Fast Money!' }));
    if (v.fast.winnerId === me) {
      myTurn = true;
      out.push(h('p', { textContent: 'Pick your partner:' }));
      v.players.forEach(p => out.push(btn(p.id === me ? 'I’ll play both halves' : p.name, () => send('pickPartner', { id: p.id }), p.id === me ? 'btn' : 'btn primary')));
    } else say(`${nameOf(v.fast.winnerId)} is picking a partner…`);
  } else if (['fastReady', 'fast', 'fastHalf', 'fastDone'].includes(v.phase)) {
    const f = v.fast;
    const playing = f.ids[f.part];
    out.push(h('p', { className: 'turn mine', textContent: 'Fast Money' }), h('p', { className: 'clock', id: 'clock' }));
    if (v.phase === 'fastReady') {
      if (playing === me) {
        myTurn = true;
        out.push(h('p', { textContent: `Five questions, ${f.part === 0 ? 20 : 25} seconds. Type fast, press Enter, or Pass to come back to one.${f.part === 1 ? ' Don’t repeat an answer from the first half!' : ''}` }),
          btn('Start the clock', () => send('fastGo'), 'btn primary big'));
      } else say(`${nameOf(playing)} is getting ready…`);
    } else if (v.phase === 'fast') {
      if (playing === me) {
        myTurn = true;
        const pass = () => { P.drafts.fa = ''; send('fast', { pass: true }); };
        out.push(h('p', { className: 'small', textContent: `Question ${f.cur + 1} of 5` }), h('p', { className: 'q big', textContent: f.question }),
          feudAnswerBox('Next', 'fast'), btn('Pass', pass, 'btn'));
      } else say(`${nameOf(playing)} is playing Fast Money!`);
    } else {
      out.push(h('p', { className: 'q big', textContent: `Total: ${f.total}` }));
      say(v.msg);
      if (v.phase === 'fastHalf') out.push(btn(`${nameOf(f.ids[1])} is ready`, () => send('fastNext'), 'btn primary'));
      else out.push(btn('See the final scores', () => send('finish'), 'btn primary'));
    }
  } else if (v.phase === 'champ') {
    out.push(h('p', { className: 'turn mine', textContent: v.champ.title }), h('p', { textContent: v.champ.fast }),
      h('ol', { className: 'podium' }, v.champ.rows.map(r => h('li', { textContent: `${r.name}: ${r.score}` }))),
      btn('New game', () => send('newGame'), 'btn primary'));
  }

  // A buzz in the pocket when it's your move.
  const key = myTurn ? v.phase + v.round + (v.fast ? v.fast.part : '') : '';
  if (key && key !== P.feudTurn) buzz([80, 60, 80]);
  P.feudTurn = key;
  return out.filter(Boolean);
}

// Answer Board on a phone. phone.js handles joining and calls quizScreen()
// with the game's view; the helpers (h, btn, draft, send, nameOf) live there.
const Q$ = n => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US');

function quizAnswer(cmdName, choices) {
  if (choices) {
    return h('div', { className: 'panel' }, choices.map(ch => btn(ch, () => { P.drafts.lastAnswer = ch; send(cmdName, { a: ch }); }, 'btn big choice')));
  }
  const go = () => { const a = (P.drafts.qa || '').trim(); if (!a) return; P.drafts.lastAnswer = a; P.drafts.qa = ''; send(cmdName, { a }); };
  const inp = draft('qa', { type: 'text', placeholder: 'Type your answer', aria: 'Your answer', autocapitalize: 'characters', enterKeyHint: 'send' });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  setTimeout(() => { const n = document.getElementById('qa'); if (n && document.activeElement !== n) n.focus(); }, 0);
  return h('div', { className: 'panel' }, inp, btn('Lock it in', go, 'btn primary'));
}

function quizWager(cmdName, max, label) {
  const go = () => { const n = parseInt(P.drafts.qw, 10); if (!(n >= 0)) return; send(cmdName, { amount: n }); };
  const inp = draft('qw', { type: 'number', inputMode: 'numeric', placeholder: `${cmdName === 'ddWager' ? 5 : 0} to ${max}`, aria: 'Your wager', min: 0, max });
  const quick = v => btn(v === max ? `All ${Q$(max)}` : Q$(v), () => { P.drafts.qw = String(v); render(); }, 'btn');
  return h('div', { className: 'panel' },
    h('p', { className: 'small', textContent: label }),
    h('div', { className: 'row2' }, quick(Math.max(cmdName === 'ddWager' ? 5 : 0, 0)), quick(Math.round(max / 2))),
    quick(max), inp, btn('Lock in my wager', go, 'btn primary'));
}

function quizScreen(v) {
  const me = P.me;
  const out = [];
  let myTurn = false;
  const c = v.clue, f = v.final;
  out.push(h('ul', { className: 'scores' }, v.players.map(p => h('li', { className: p.id === v.controlId ? 'now' : '' },
    h('span', { textContent: p.name + ' ' }), h('b', { textContent: Q$(p.score) })))));
  out.push(h('p', { className: 'clock', id: 'clock' }));
  const say = t => out.push(h('p', { className: 'msg', textContent: t }));
  const clueText = () => { if (c && c.q) out.push(h('p', { className: 'small', textContent: `${c.category} · ${Q$(c.dd ? c.wager || c.value : c.value)}` }), h('p', { className: 'q big', textContent: c.q })); };

  if (v.phase === 'board') {
    if (v.controlId === me) {
      myTurn = true;
      out.push(h('p', { className: 'turn mine', textContent: 'Pick a clue!' }));
      v.board.cats.forEach((cat, ci) => {
        out.push(h('p', { className: 'qcatp', textContent: cat }));
        out.push(h('div', { className: 'qvals' }, v.board.values.map((val, r) => {
          const used = v.board.taken.includes(`${ci},${r}`);
          return btn(used ? '' : Q$(val), () => send('choose', { c: ci, r }), 'btn qv', { disabled: used });
        })));
      });
    } else say(`${nameOf(v.controlId)} is picking a clue…`);
  } else if (v.phase === 'reading') {
    clueText();
    out.push(h('button', { className: 'bigbuzz wait', textContent: 'WAIT…', disabled: true }));
    say('Listen to the host…');
  } else if (v.phase === 'open') {
    clueText();
    if (v.tried.includes(me)) say('You had your go. Fingers crossed for the others!');
    else { myTurn = true; out.push(h('button', { className: 'bigbuzz', textContent: 'BUZZ', on: { click: () => { buzz(40); playSound('quiz-buzz'); send('buzz'); } } })); }
  } else if (v.phase === 'answering') {
    clueText();
    if (v.buzzer === me) { myTurn = true; out.push(h('p', { className: 'turn mine', textContent: 'Your answer?' }), quizAnswer('answer', c.choices)); }
    else say(`${nameOf(v.buzzer)} is answering…`);
  } else if (v.phase === 'reveal') {
    clueText();
    if (v.last) out.push(h('p', { className: 'turn' + (v.last.right ? ' mine' : ''), textContent: `${nameOf(v.last.id)}: ${v.last.right ? 'right!' : 'not quite'}` }));
    out.push(h('p', { className: 'q big', textContent: `Answer: ${c.a}` }));
  } else if (v.phase === 'ddWager') {
    out.push(h('p', { className: 'turn mine', textContent: 'Daily Double!' }), h('p', { className: 'small', textContent: `Category: ${c.category}` }));
    if (c.ddPlayer === me) { myTurn = true; out.push(quizWager('ddWager', c.ddMax, `How much do you bet you know it? $5 to ${Q$(c.ddMax)}.`)); }
    else say(`${nameOf(c.ddPlayer)} is making a wager…`);
  } else if (v.phase === 'ddAnswer') {
    clueText();
    if (c.ddPlayer === me) { myTurn = true; out.push(quizAnswer('ddAnswer', c.choices)); }
    else say(`${nameOf(c.ddPlayer)} is answering for ${Q$(c.wager)}…`);
  } else if (v.phase === 'roundBreak') {
    out.push(h('p', { className: 'turn mine', textContent: 'Double round!' }), h('p', { textContent: 'Every clue is worth twice as much.' }));
  } else if (v.phase === 'finalWager') {
    out.push(h('p', { className: 'turn mine', textContent: 'Final round' }), h('p', { className: 'q big', textContent: f.category }));
    if (f.wagered.includes(me)) say('Wager locked in. Waiting for the others…');
    else { myTurn = true; out.push(quizWager('finalWager', f.maxes[me] || 0, `Bet up to ${Q$(f.maxes[me] || 0)}. Nobody sees it until the end.`)); }
  } else if (v.phase === 'finalClue') {
    out.push(h('p', { className: 'small', textContent: `Final round · ${f.category}` }), h('p', { className: 'q big', textContent: f.q }));
    if (f.answered.includes(me)) say('Answer locked in!');
    else { myTurn = true; out.push(quizAnswer('finalAnswer', f.choices)); }
  } else if (v.phase === 'finalReveal') {
    out.push(h('p', { className: 'turn mine', textContent: 'The final answers…' }), h('p', { className: 'q', textContent: f.q }));
    if (f.a) out.push(h('p', { className: 'q big', textContent: `Answer: ${f.a}` }));
    say(v.msg);
  } else if (v.phase === 'champ') {
    out.push(h('p', { className: 'turn mine', textContent: v.champ.title }), h('p', { className: 'small', textContent: v.champ.answer }),
      h('ol', { className: 'podium' }, v.champ.rows.map(r => h('li', { textContent: `${r.name}: ${Q$(r.score)}` }))),
      btn('New game', () => send('newGame'), 'btn primary'));
  }

  const key = myTurn ? v.phase + (c ? `${c.c},${c.r}` : '') : '';
  if (key && key !== P.quizTurn && v.phase !== 'open') buzz([80, 60, 80]);
  P.quizTurn = key;
  return out.filter(Boolean);
}

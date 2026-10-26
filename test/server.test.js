'use strict';
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { createServer } = require('../server');

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', d => {
    const m = JSON.parse(d);
    inbox.push(m);
    waiters.slice().forEach(w => { if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } });
  });
  return {
    ws,
    open: () => new Promise(r => ws.once('open', r)),
    send: m => ws.send(JSON.stringify(m)),
    // Next message matching pred, including ones already received.
    wait(pred) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise(resolve => waiters.push({ pred, resolve }));
    },
    clear() { inbox.length = 0; },
  };
}

test('a TV and two phones play over the socket', async () => {
  const { server, game } = createServer({ gameOpts: { code: 'WXYZ' } });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const tv = client(port); await tv.open();
    tv.send({ t: 'hello', role: 'tv' });
    const { hostKey } = await tv.wait(m => m.t === 'host');
    assert.ok(hostKey);

    const second = client(port); await second.open();
    second.send({ t: 'hello', role: 'tv' });
    await second.wait(m => m.t === 'busy');
    second.ws.close();

    const ann = client(port); await ann.open();
    ann.send({ t: 'hello', role: 'phone', code: 'nope', name: 'Ann' });
    await ann.wait(m => m.t === 'error');
    ann.send({ t: 'hello', role: 'phone', code: 'wxyz', name: 'Ann' });
    const annJoin = await ann.wait(m => m.t === 'joined');
    const ben = client(port); await ben.open();
    ben.send({ t: 'hello', role: 'phone', code: 'WXYZ', name: 'Ben' });
    await ben.wait(m => m.t === 'joined');

    const list = await (await fetch(`${base}/api/themes`)).json();
    assert.ok(list.some(t => t.id === 'game-night'));

    tv.send({ t: 'settings', settings: { themeId: 'game-night', category: 'Animals' } });
    tv.send({ t: 'start' });
    const st = await ann.wait(m => m.t === 'state' && m.view.phase === 'play');
    assert.equal(st.view.hint, 'Animals');
    assert.equal(st.view.turnId, annJoin.id);
    assert.ok(!JSON.stringify(st.view).includes(game.word), 'phrase stays hidden');

    // Ben can't play out of turn; Ann guesses a letter that is in no animal.
    ben.send({ t: 'guess', l: 'A' });
    const err = await ben.wait(m => m.t === 'error');
    assert.match(err.msg, /Ann’s turn/);
    ann.clear(); ben.clear();
    ann.send({ t: 'guess', l: 'Q' });
    const after = await ben.wait(m => m.t === 'state' && m.view.misses.length === 1);
    assert.equal(after.view.players.find(p => p.name === 'Ben').id, after.you);
    assert.equal(after.view.turnId, after.you);

    // Back to the lobby, then over to Family Face-Off: everyone comes along.
    tv.send({ t: 'lobby' });
    await tv.wait(m => m.t === 'state' && m.view.phase === 'lobby');
    ann.clear();
    tv.send({ t: 'switchGame', to: 'feud' });
    const fs = await ann.wait(m => m.t === 'state' && m.view.game === 'feud');
    assert.deepEqual(fs.view.players.map(p => p.name), ['Ann', 'Ben']);
    tv.send({ t: 'start' });
    await ben.wait(m => m.t === 'state' && m.view.game === 'feud' && m.view.phase === 'faceoff');
    ben.send({ t: 'buzz' });
    const buzzed = await ann.wait(m => m.t === 'state' && m.view.faceoff && m.view.faceoff.contenders.length === 1);
    assert.equal(buzzed.view.faceoff.answering, buzzed.view.players.find(p => p.name === 'Ben').id);
    ann.send({ t: 'guess', l: 'A' }); // a Hangman command does nothing in Face-Off
    tv.send({ t: 'switchGame', to: 'hangman' });
    const err2 = await tv.wait(m => m.t === 'error');
    assert.match(err2.msg, /from the lobby/);

    const qr = await fetch(`${base}/qr.svg`);
    assert.match(await qr.text(), /<svg/);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    [tv, ann, ben].forEach(c => c.ws.close());
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

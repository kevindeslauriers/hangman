'use strict';
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { Game, GameError } = require('./lib/game');
const { ThemeStore } = require('./lib/themes');

function createServer({ gameOpts = {} } = {}) {
  const themes = new ThemeStore({ dir: path.join(__dirname, 'themes') });

  const clients = new Set(); // { ws, role: 'tv'|'phone', playerId }
  const host = { key: null };
  let pending = false;

  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const broadcast = msg => clients.forEach(c => c.role && send(c.ws, msg));

  // Coalesce the several changes one command can make into one state push.
  const scheduleState = () => {
    if (pending) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      const v = game.view();
      clients.forEach(c => {
        if (c.role === 'tv') send(c.ws, { t: 'state', view: v });
        else if (c.role === 'phone') send(c.ws, { t: 'state', view: v, you: c.playerId });
      });
    });
  };

  const game = new Game({ themes, onChange: scheduleState, fx: fx => broadcast({ t: 'fx', ...fx }), ...gameOpts });

  const hostSockets = () => [...clients].filter(c => c.role === 'tv');
  const isHostKey = k => !!host.key && k === host.key;

  function syncConnected(playerId) {
    const on = [...clients].some(c => c.role === 'phone' && c.playerId === playerId);
    game.setConnected(playerId, on);
  }

  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (req, res) => res.send('ok'));
  app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  app.get('/qr.svg', async (req, res) => {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
    const url = `${proto}://${req.get('host')}/?code=${game.code}`;
    res.type('image/svg+xml').set('Cache-Control', 'no-store')
      .send(await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#24372D', light: '#F2EEE3' } }));
  });

  app.get('/api/themes', (req, res) => res.json(themes.list()));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  const TV_CMDS = {
    settings: m => game.updateSettings(m.settings || {}),
    start: () => game.start(),
    resetScores: () => game.resetScores(),
    lobby: () => game.toLobby(),
    newWord: () => game.newWord(),
    skip: () => game.skip(),
    secretRandom: () => game.useRandomWord(),
    swap: () => game.swap(),
    next: () => game.next(),
    rematch: () => game.rematch(),
    kick: m => {
      clients.forEach(c => { if (c.role === 'phone' && c.playerId === m.id) { send(c.ws, { t: 'kicked' }); c.playerId = null; c.role = null; } });
      game.remove(m.id);
    },
  };
  const PHONE_CMDS = {
    guess: (m, id) => game.guess(id, m.l),
    solveStart: (m, id) => game.solveStart(id),
    solveCancel: (m, id) => game.solveCancel(id),
    solve: (m, id) => game.solve(id, m.a),
    secret: (m, id) => game.submitSecret(id, m.w, m.h),
    secretRandom: (m, id) => { if (id !== game.setterId) throw new GameError('It’s someone else’s turn to pick.'); game.useRandomWord(); },
    vote: (m, id) => game.vote(id, m.pts),
    swap: (m, id) => {
      if (!game.end || !game.end.show || game.end.show.performerId !== id) throw new GameError('Only the performer can swap the challenge.');
      game.swap();
    },
    next: () => game.next(),
    rematch: () => game.rematch(),
    leave: (m, id, c) => { c.playerId = null; c.role = null; game.remove(id); send(c.ws, { t: 'left' }); },
  };

  function helloTv(c, m) {
    const busy = hostSockets().filter(x => x !== c).length > 0;
    if (!isHostKey(m.hostKey) && busy && !m.takeover) { send(c.ws, { t: 'busy' }); return; }
    if (!isHostKey(m.hostKey) || m.takeover) {
      // A new screen takes over: the old one is told and stops being the TV.
      host.key = crypto.randomBytes(16).toString('hex');
      hostSockets().forEach(x => { if (x !== c) { send(x.ws, { t: 'replaced' }); x.role = null; } });
    }
    c.role = 'tv';
    send(c.ws, { t: 'host', hostKey: m.hostKey && isHostKey(m.hostKey) && !m.takeover ? m.hostKey : host.key });
    send(c.ws, { t: 'state', view: game.view() });
  }

  function helloPhone(c, m) {
    let p = m.token ? game.players.find(x => x.token === m.token) : null;
    if (!p) {
      if (!m.name) { send(c.ws, { t: 'needJoin' }); return; }
      if (String(m.code || '').trim().toUpperCase() !== game.code) throw new GameError('That code doesn’t match the one on the TV.');
      p = game.join(m.name);
    }
    if (c.playerId && c.playerId !== p.id) { const old = c.playerId; c.playerId = null; syncConnected(old); }
    c.role = 'phone';
    c.playerId = p.id;
    send(c.ws, { t: 'joined', token: p.token, id: p.id, name: p.name });
    syncConnected(p.id);
    send(c.ws, { t: 'state', view: game.view(), you: p.id });
  }

  wss.on('connection', ws => {
    const c = { ws, role: null, playerId: null, alive: true };
    clients.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', data => {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      try {
        if (m.t === 'hello' && m.role === 'tv') return helloTv(c, m);
        if (m.t === 'hello' && m.role === 'phone') return helloPhone(c, m);
        if (c.role === 'tv' && TV_CMDS[m.t]) return TV_CMDS[m.t](m);
        if (c.role === 'phone' && c.playerId && PHONE_CMDS[m.t]) return PHONE_CMDS[m.t](m, c.playerId, c);
      } catch (e) {
        if (e instanceof GameError) return send(ws, { t: 'error', msg: e.message });
        console.error(e);
        send(ws, { t: 'error', msg: 'Something went wrong.' });
      }
    });
    ws.on('close', () => {
      clients.delete(c);
      if (c.playerId) syncConnected(c.playerId);
    });
  });

  // Keep connections open through Render's proxy, and notice phones that vanished.
  const beat = setInterval(() => {
    clients.forEach(c => {
      if (!c.alive) { c.ws.terminate(); return; }
      c.alive = false;
      try { c.ws.ping(); } catch {}
    });
  }, 25000);
  beat.unref();
  server.on('close', () => { clearInterval(beat); game.stopTimer(); });

  return { server, game, themes };
}

module.exports = { createServer };

if (require.main === module) {
  const { server } = createServer();
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`Hangman on http://localhost:${port}`));
}

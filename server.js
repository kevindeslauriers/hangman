'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { Game, GameError } = require('./lib/game');
const { Feud, FeudError } = require('./lib/feud');
const { ThemeStore } = require('./lib/themes');
const { SurveyStore } = require('./lib/survey');

function createServer({ gameOpts = {} } = {}) {
  const themes = new ThemeStore({ dir: path.join(__dirname, 'themes') });
  const surveys = new SurveyStore({ dir: path.join(__dirname, 'surveys') });

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
      const v = { ...cur().view(), game: mode };
      clients.forEach(c => {
        if (c.role === 'tv') send(c.ws, { t: 'state', view: v });
        else if (c.role === 'phone') send(c.ws, { t: 'state', view: v, you: c.playerId });
      });
    });
  };

  // One game runs at a time; the TV switches between them from the lobby.
  const fx = f => broadcast({ t: 'fx', ...f });
  const game = new Game({ themes, onChange: scheduleState, fx, ...gameOpts });
  const feud = new Feud({ surveys, onChange: scheduleState, fx, ...gameOpts, code: game.code });
  const games = { hangman: game, feud };
  let mode = 'hangman';
  const cur = () => games[mode];
  const view = () => ({ ...cur().view(), game: mode });

  function switchGame(to) {
    if (!games[to]) throw new GameError('Unknown game.');
    if (to === mode) return;
    if (cur().phase !== 'lobby') throw new GameError('Switch games from the lobby.');
    const from = cur();
    from.stopTimer();
    games[to].adoptPlayers(from.players, from.nextId);
    mode = to;
    cur().toLobby();
  }

  const hostSockets = () => [...clients].filter(c => c.role === 'tv');
  const isHostKey = k => !!host.key && k === host.key;

  function syncConnected(playerId) {
    const on = [...clients].some(c => c.role === 'phone' && c.playerId === playerId);
    cur().setConnected(playerId, on);
  }

  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (req, res) => res.send('ok'));
  app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  app.get('/qr.svg', async (req, res) => {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
    const url = `${proto}://${req.get('host')}/?code=${cur().code}`;
    res.type('image/svg+xml').set('Cache-Control', 'no-store')
      .send(await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#24372D', light: '#F2EEE3' } }));
  });

  app.get('/api/themes', (req, res) => res.json(themes.list()));

  // Recordings that replace Face-Off's built-in sounds (public/sounds/<name>.mp3).
  const SOUND_NAMES = ['ding', 'strike', 'buzzin', 'flip', 'round', 'control', 'steal', 'win', 'keep', 'applause',
    'fastStart', 'fastEnd', 'fastZero', 'dupe', 'champ', 'join', 'lock', 'tick', 'theme'];
  app.get('/api/sounds', (req, res) => {
    const dir = path.join(__dirname, 'public', 'sounds');
    let files = [];
    try { files = fs.readdirSync(dir); } catch (e) {}
    res.json(SOUND_NAMES.filter(n => files.includes(n + '.mp3')));
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  const kick = id => {
    clients.forEach(c => { if (c.role === 'phone' && c.playerId === id) { send(c.ws, { t: 'kicked' }); c.playerId = null; c.role = null; } });
    cur().remove(id);
  };
  const leave = (m, id, c) => { c.playerId = null; c.role = null; cur().remove(id); send(c.ws, { t: 'left' }); };

  const FEUD_TV = {
    switchGame: m => switchGame(m.to),
    settings: m => feud.updateSettings(m.settings || {}),
    start: () => feud.start(),
    lobby: () => feud.toLobby(),
    next: () => feud.next(),
    override: m => feud.override(+m.idx, m.id),
    strike: () => feud.forceStrike(),
    pickPartner: m => feud.pickPartner(null, m.id),
    fastGo: () => feud.fastGo(),
    fastNext: () => feud.fastNext(),
    fastFix: m => feud.fastFix(+m.part, +m.q, +m.idx),
    finish: () => feud.finish(),
    kick: m => kick(m.id),
  };
  const FEUD_PHONE = {
    buzz: (m, id) => feud.buzz(id),
    faceoff: (m, id) => feud.faceoffAnswer(id, m.a),
    decide: (m, id) => feud.decide(id, m.choice === 'pass' ? 'pass' : 'play'),
    answer: (m, id) => feud.answer(id, m.a),
    steal: (m, id) => feud.stealAnswer(id, m.a),
    next: () => feud.next(),
    pickPartner: (m, id) => feud.pickPartner(id, m.id),
    fastGo: (m, id) => { if (!feud.fast || feud.fast.ids[feud.fast.part] !== id) throw new FeudError('It’s not your turn.'); feud.fastGo(); },
    fastNext: () => feud.fastNext(),
    fast: (m, id) => feud.fastAnswer(id, m.a, !!m.pass),
    finish: () => feud.finish(),
    newGame: () => { if (feud.phase !== 'champ') throw new FeudError('The game isn’t over.'); feud.toLobby(); },
    leave,
  };

  const TV_CMDS = {
    switchGame: m => switchGame(m.to),
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
    kick: m => kick(m.id),
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
    leave,
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
    send(c.ws, { t: 'state', view: view() });
  }

  function helloPhone(c, m) {
    let p = m.token ? cur().players.find(x => x.token === m.token) : null;
    if (!p) {
      if (!m.name) { send(c.ws, { t: 'needJoin' }); return; }
      if (String(m.code || '').trim().toUpperCase() !== cur().code) throw new GameError('That code doesn’t match the one on the TV.');
      p = cur().join(m.name);
    }
    if (c.playerId && c.playerId !== p.id) { const old = c.playerId; c.playerId = null; syncConnected(old); }
    c.role = 'phone';
    c.playerId = p.id;
    send(c.ws, { t: 'joined', token: p.token, id: p.id, name: p.name });
    syncConnected(p.id);
    send(c.ws, { t: 'state', view: view(), you: p.id });
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
        const tv = mode === 'feud' ? FEUD_TV : TV_CMDS;
        const phone = mode === 'feud' ? FEUD_PHONE : PHONE_CMDS;
        if (c.role === 'tv' && tv[m.t]) return tv[m.t](m);
        if (c.role === 'phone' && c.playerId && phone[m.t]) return phone[m.t](m, c.playerId, c);
      } catch (e) {
        if (e instanceof GameError || e instanceof FeudError) return send(ws, { t: 'error', msg: e.message });
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
  server.on('close', () => { clearInterval(beat); game.stopTimer(); feud.stopTimer(); });

  return { server, game, feud, themes };
}

module.exports = { createServer };

if (require.main === module) {
  const { server } = createServer();
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`Game night on http://localhost:${port}`));
}

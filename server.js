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
const { Wheel, WheelError } = require('./lib/wheel');
const { Quiz, QuizError, ClueStore } = require('./lib/quiz');
const { Bank, ClassError } = require('./lib/classroom');
const { ClassRooms } = require('./lib/classrooms');
const { ThemeStore } = require('./lib/themes');
const { SurveyStore } = require('./lib/survey');

function createServer({ gameOpts = {}, classOpts = {} } = {}) {
  const themes = new ThemeStore({ dir: path.join(__dirname, 'themes') });
  const surveys = new SurveyStore({ dir: path.join(__dirname, 'surveys') });
  const clues = new ClueStore({ dir: path.join(__dirname, 'clues') });
  const bank = new Bank({ dir: path.join(__dirname, 'class-clues') });

  const clients = new Set(); // { send, role: 'tv'|'phone', playerId, room }; room is set for classroom clients
  const host = { key: null };
  let pending = false;

  const send = (c, msg) => c.send(msg);
  // Family games only; classroom rooms broadcast to their own clients.
  const family = () => [...clients].filter(c => !c.room);
  const broadcast = msg => family().forEach(c => c.role && send(c, msg));

  // Coalesce the several changes one command can make into one state push.
  const scheduleState = () => {
    if (pending) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      const v = { ...cur().view(), game: mode };
      family().forEach(c => {
        if (c.role === 'tv') send(c, { t: 'state', view: v });
        else if (c.role === 'phone') send(c, { t: 'state', view: v, you: c.playerId });
      });
    });
  };

  // One game runs at a time; the TV switches between them from the lobby.
  const fx = f => broadcast({ t: 'fx', ...f });
  const game = new Game({ themes, onChange: scheduleState, fx, ...gameOpts });
  const feud = new Feud({ surveys, onChange: scheduleState, fx, ...gameOpts, code: game.code });
  const wheel = new Wheel({ themes, onChange: scheduleState, fx, ...gameOpts, code: game.code });
  const quiz = new Quiz({ clues, onChange: scheduleState, fx, ...gameOpts, code: game.code });
  const games = { hangman: game, feud, wheel, quiz };
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

  // Class Board: every teacher's projector gets a room of its own.
  const classes = new ClassRooms({ bank, reserved: () => [game.code], gameOpts: classOpts });

  const hostSockets = () => family().filter(c => c.role === 'tv');
  const isHostKey = k => !!host.key && k === host.key;

  function syncConnected(playerId) {
    const on = family().some(c => c.role === 'phone' && c.playerId === playerId);
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

  app.get('/class/qr.svg', async (req, res) => {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
    const code = String(req.query.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
    const url = `${proto}://${req.get('host')}/join?code=${code}`;
    res.type('image/svg+xml').set('Cache-Control', 'no-store')
      .send(await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0b1a4a', light: '#ffffff' } }));
  });
  // The end-of-game report. Nothing is kept: it comes from the room in memory.
  app.get('/class/report.csv', (req, res) => {
    const csv = classes.report(req.query.code, String(req.query.key || ''));
    if (csv == null) return res.status(404).send('That game has closed.');
    const day = new Date().toISOString().slice(0, 10);
    res.type('text/csv').set('Content-Disposition', `attachment; filename="class-board-${day}.csv"`).set('Cache-Control', 'no-store').send(csv);
  });
  app.get('/api/class-units', (req, res) => res.json(bank.list()));

  app.get('/api/themes', (req, res) => res.json(themes.list()));

  // Recordings that replace Face-Off's built-in sounds (public/sounds/<name>.mp3).
  const SOUND_NAMES = ['quiz-board', 'quiz-pick', 'quiz-buzz', 'quiz-right', 'quiz-wrong', 'quiz-timesup', 'quiz-dailydouble',
    'quiz-think', 'quiz-final', 'quiz-roundbreak', 'quiz-champ', 'wheel-tick', 'wheel-ding', 'wheel-buzz', 'wheel-bankrupt', 'wheel-loseturn', 'wheel-solve', 'wheel-round',
    'wheel-tossup', 'wheel-buzzin', 'wheel-puzzle', 'wheel-vowel', 'wheel-bonus', 'wheel-bonuswin', 'wheel-bonuslose', 'wheel-wrong',
    'ding', 'strike', 'buzzin', 'flip', 'round', 'control', 'steal', 'win', 'keep', 'applause',
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
    family().forEach(c => { if (c.role === 'phone' && c.playerId === id) { send(c, { t: 'kicked' }); c.playerId = null; c.role = null; } });
    cur().remove(id);
  };
  const leave = (m, id, c) => { c.playerId = null; c.role = null; cur().remove(id); send(c, { t: 'left' }); };

  const QUIZ_TV = {
    switchGame: m => switchGame(m.to),
    settings: m => quiz.updateSettings(m.settings || {}),
    start: () => quiz.start(),
    lobby: () => quiz.toLobby(),
    choose: m => quiz.choose(null, m.c, m.r),
    endRound: () => quiz.endRound(),
    kick: m => kick(m.id),
  };
  const QUIZ_PHONE = {
    choose: (m, id) => quiz.choose(id, m.c, m.r),
    buzz: (m, id) => quiz.buzz(id),
    answer: (m, id) => quiz.answer(id, m.a),
    ddWager: (m, id) => quiz.ddWager(id, m.amount),
    ddAnswer: (m, id) => quiz.ddAnswer(id, m.a),
    finalWager: (m, id) => quiz.finalWager(id, m.amount),
    finalAnswer: (m, id) => quiz.finalAnswer(id, m.a),
    newGame: () => { if (quiz.phase !== 'champ') throw new QuizError('The game isn’t over.'); quiz.toLobby(); },
    leave,
  };

  const WHEEL_TV = {
    switchGame: m => switchGame(m.to),
    settings: m => wheel.updateSettings(m.settings || {}),
    start: () => wheel.start(),
    lobby: () => wheel.toLobby(),
    next: () => wheel.next(),
    skip: () => { if (!wheel.turnPhase()) throw new WheelError('Nobody’s turn to skip.'); wheel.passTurn(`Skipped ${wheel.cur().name}.`); },
    bonusPick: m => wheel.bonusPick(null, m.letters),
    finish: () => wheel.finish(),
    kick: m => kick(m.id),
  };
  const WHEEL_PHONE = {
    spin: (m, id) => wheel.doSpin(id, m.power),
    consonant: (m, id) => wheel.callConsonant(id, m.l),
    buyVowel: (m, id) => wheel.buyVowel(id),
    vowel: (m, id) => wheel.callVowel(id, m.l),
    cancelPick: (m, id) => wheel.cancelPick(id),
    solveStart: (m, id) => wheel.solveStart(id),
    solveCancel: (m, id) => wheel.solveCancel(id),
    solve: (m, id) => wheel.solve(id, m.a),
    buzz: (m, id) => wheel.buzzToss(id),
    tossSolve: (m, id) => wheel.solveToss(id, m.a),
    next: () => wheel.next(),
    bonusPick: (m, id) => wheel.bonusPick(id, m.letters),
    bonusGuess: (m, id) => wheel.bonusGuess(id, m.a),
    finish: () => wheel.finish(),
    newGame: () => { if (wheel.phase !== 'champ') throw new WheelError('The game isn’t over.'); wheel.toLobby(); },
    leave,
  };

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
    if (!isHostKey(m.hostKey) && busy && !m.takeover) { send(c, { t: 'busy' }); return; }
    if (!isHostKey(m.hostKey) || m.takeover) {
      // A new screen takes over: the old one is told and stops being the TV.
      host.key = crypto.randomBytes(16).toString('hex');
      hostSockets().forEach(x => { if (x !== c) { send(x, { t: 'replaced' }); x.role = null; } });
    }
    c.role = 'tv';
    send(c, { t: 'host', hostKey: m.hostKey && isHostKey(m.hostKey) && !m.takeover ? m.hostKey : host.key });
    send(c, { t: 'state', view: view() });
  }

  function helloPhone(c, m) {
    let p = m.token ? cur().players.find(x => x.token === m.token) : null;
    if (!p) {
      if (!m.name) { send(c, { t: 'needJoin' }); return; }
      if (String(m.code || '').trim().toUpperCase() !== cur().code) throw new GameError('That code doesn’t match the one on the TV.');
      p = cur().join(m.name);
    }
    if (c.playerId && c.playerId !== p.id) { const old = c.playerId; c.playerId = null; syncConnected(old); }
    c.role = 'phone';
    c.playerId = p.id;
    send(c, { t: 'joined', token: p.token, id: p.id, name: p.name });
    syncConnected(p.id);
    send(c, { t: 'state', view: view(), you: p.id });
  }

  // Every connection, WebSocket or the polling fallback, comes through here.
  function onMessage(c, m) {
    if (!m || typeof m !== 'object') return;
    try {
      if (m.t === 'hello' && m.role === 'classTv') return classes.helloTv(c, m);
      if (c.room) return classes.handle(c, m);
      if (m.t === 'hello' && m.role === 'tv') return helloTv(c, m);
      if (m.t === 'hello' && m.role === 'student') return classes.helloStudent(c, m);
      if (m.t === 'hello' && m.role === 'phone') {
        // Someone typed a class code on the family join page.
        if (m.name && classes.has(m.code)) return send(c, { t: 'goto', url: `/join?code=${String(m.code).trim().toUpperCase()}` });
        return helloPhone(c, m);
      }
      const tv = { feud: FEUD_TV, wheel: WHEEL_TV, quiz: QUIZ_TV }[mode] || TV_CMDS;
      const phone = { feud: FEUD_PHONE, wheel: WHEEL_PHONE, quiz: QUIZ_PHONE }[mode] || PHONE_CMDS;
      if (c.role === 'tv' && tv[m.t]) return tv[m.t](m);
      if (c.role === 'phone' && c.playerId && phone[m.t]) return phone[m.t](m, c.playerId, c);
    } catch (e) {
      if (e instanceof GameError || e instanceof FeudError || e instanceof WheelError || e instanceof QuizError || e instanceof ClassError) return send(c, { t: 'error', msg: e.message });
      console.error(e);
      send(c, { t: 'error', msg: 'Something went wrong.' });
    }
  }

  function onClose(c) {
    if (!clients.delete(c)) return;
    if (c.room) return classes.left(c);
    if (c.playerId) syncConnected(c.playerId);
  }

  wss.on('connection', ws => {
    const c = { ws, kind: 'ws', role: null, playerId: null, room: null, alive: true,
      send: msg => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); } };
    clients.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', data => { let m; try { m = JSON.parse(data); } catch { return; } onMessage(c, m); });
    ws.on('close', () => onClose(c));
  });

  // Fallback for networks that block WebSockets (some school firewalls do):
  // the browser opens a session, posts messages and long-polls for replies.
  const polls = new Map();
  app.post('/rt/open', (req, res) => {
    const sid = crypto.randomBytes(16).toString('hex');
    const p = { queue: [], waiter: null, last: Date.now() };
    const flush = () => { if (p.waiter && p.queue.length) { const w = p.waiter; p.waiter = null; clearTimeout(w.t); w.res.json(p.queue.splice(0)); } };
    p.c = { kind: 'poll', role: null, playerId: null, room: null, send: msg => { p.queue.push(msg); if (p.queue.length > 500) p.queue.shift(); flush(); } };
    p.flush = flush;
    polls.set(sid, p);
    clients.add(p.c);
    res.json({ sid });
  });
  app.get('/rt/poll', (req, res) => {
    const p = polls.get(String(req.query.sid));
    if (!p) return res.status(410).json({ error: 'gone' });
    p.last = Date.now();
    res.set('Cache-Control', 'no-store');
    if (p.queue.length) return res.json(p.queue.splice(0));
    if (p.waiter) { clearTimeout(p.waiter.t); p.waiter.res.json([]); }
    p.waiter = { res, t: setTimeout(() => { if (p.waiter && p.waiter.res === res) { p.waiter = null; res.json([]); } }, 25000) };
  });
  app.post('/rt/send', express.json({ limit: '16kb' }), (req, res) => {
    const p = polls.get(String(req.query.sid));
    if (!p) return res.status(410).json({ error: 'gone' });
    p.last = Date.now();
    onMessage(p.c, req.body);
    res.json({ ok: true });
  });
  app.post('/rt/close', (req, res) => {
    const sid = String(req.query.sid), p = polls.get(sid);
    if (p) { polls.delete(sid); if (p.waiter) { clearTimeout(p.waiter.t); p.waiter.res.status(410).json({ error: 'gone' }); p.waiter = null; } onClose(p.c); }
    res.json({ ok: true });
  });
  const sweep = setInterval(() => {
    const now = Date.now();
    polls.forEach((p, sid) => { if (now - p.last > 45000 && !p.waiter) { polls.delete(sid); onClose(p.c); } });
  }, 10000);
  server.on('close', () => polls.forEach(p => { if (p.waiter) clearTimeout(p.waiter.t); }));
  sweep.unref();

  // Keep connections open through Render's proxy, and notice phones that vanished.
  const beat = setInterval(() => {
    clients.forEach(c => {
      if (c.kind !== 'ws') return;
      if (!c.alive) { c.ws.terminate(); return; }
      c.alive = false;
      try { c.ws.ping(); } catch {}
    });
  }, 25000);
  beat.unref();
  server.on('close', () => { clearInterval(beat); clearInterval(sweep); classes.stop(); game.stopTimer(); feud.stopTimer(); wheel.stopTimer(); wheel.stopStep(); quiz.stopTimer(); });

  return { server, game, feud, wheel, quiz, themes, classes };
}

module.exports = { createServer };

if (require.main === module) {
  const { server } = createServer();
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`Game night on http://localhost:${port}`));
}

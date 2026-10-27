'use strict';
// Class Board rooms. Each teacher's projector opens its own room with its own
// code, so several classes (and the family game at home) never meet.

const crypto = require('crypto');
const { Classroom, ClassError } = require('./classroom');

const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
const EMPTY_FOR = 3 * 60 * 60 * 1000;   // a room nobody is connected to closes after 3 hours
const IDLE_FOR = 12 * 60 * 60 * 1000;   // and any room closes after 12 quiet hours

class ClassRooms {
  constructor({ bank, reserved = () => [], now = Date.now, gameOpts = {} }) {
    this.bank = bank;
    this.reserved = reserved;
    this.now = now;
    this.gameOpts = gameOpts;
    this.rooms = new Map();
    this.sweeper = setInterval(() => this.sweep(), 60 * 1000);
    this.sweeper.unref();
  }

  stop() {
    clearInterval(this.sweeper);
    this.rooms.forEach(r => r.game.stopTimer());
  }

  makeCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 5; i++) code += LETTERS[crypto.randomInt(LETTERS.length)];
      if (!this.rooms.has(code) && !this.reserved().includes(code)) return code;
    }
  }

  create() {
    const code = this.makeCode();
    const room = { code, key: crypto.randomBytes(16).toString('hex'), clients: new Set(), last: this.now(), empty: null, pending: false };
    room.game = new Classroom({
      bank: this.bank, code, ...this.gameOpts,
      onChange: () => this.push(room),
      fx: f => room.clients.forEach(c => { if (c.role === 'teacher') c.send({ t: 'fx', ...f }); }),
    });
    this.rooms.set(code, room);
    return room;
  }

  has(code) { return this.rooms.has(String(code || '').trim().toUpperCase()); }

  // One state push per room per tick, however many changes a command made.
  push(room) {
    if (room.pending) return;
    room.pending = true;
    setImmediate(() => {
      room.pending = false;
      if (!this.rooms.has(room.code)) return;
      let tv = null;
      room.clients.forEach(c => {
        if (c.role === 'teacher') c.send({ t: 'state', view: tv || (tv = room.game.teacherView()) });
        else if (c.role === 'student') c.send({ t: 'state', view: room.game.studentView(c.sid) });
      });
    });
  }

  attach(c, room, role) {
    if (c.room && c.room !== room) this.left(c);
    c.room = room;
    c.role = role;
    room.clients.add(c);
    room.last = this.now();
    room.empty = null;
  }

  helloTv(c, m) {
    let room = m.code ? this.rooms.get(String(m.code).toUpperCase()) : null;
    if (!room || m.key !== room.key) room = this.create();
    this.attach(c, room, 'teacher');
    c.send({ t: 'classHost', code: room.code, key: room.key });
    c.send({ t: 'state', view: room.game.teacherView() });
  }

  findToken(token) {
    if (!token) return null;
    for (const room of this.rooms.values()) {
      const s = room.game.students.find(x => x.token === token);
      if (s) return { room, s };
    }
    return null;
  }

  helloStudent(c, m) {
    let found = this.findToken(m.token);
    if (!found) {
      if (!m.name) { c.send({ t: 'needJoin' }); return; }
      const room = this.rooms.get(String(m.code || '').trim().toUpperCase());
      if (!room) throw new ClassError('No class has that code. Check the code on the board.');
      const team = m.team == null || m.team === '' ? null : +m.team;
      found = { room, s: room.game.join(m.name, team) };
    }
    const { room, s } = found;
    const old = c.sid;
    this.attach(c, room, 'student');
    c.sid = s.id;
    if (old && old !== s.id) this.syncConnected(room, old);
    c.send({ t: 'joined', token: s.token, id: s.id, name: s.name, code: room.code });
    this.syncConnected(room, s.id);
    c.send({ t: 'state', view: room.game.studentView(s.id) });
  }

  syncConnected(room, sid) {
    const on = [...room.clients].some(c => c.role === 'student' && c.sid === sid);
    room.game.setConnected(sid, on);
    // A student who drops out shouldn't hold up the clue.
    if (!on) room.game.maybeAllAnswered();
  }

  left(c) {
    const room = c.room;
    if (!room) return;
    room.clients.delete(c);
    c.room = null;
    if (c.role === 'student' && c.sid) this.syncConnected(room, c.sid);
    if (!room.clients.size) room.empty = this.now();
  }

  handle(c, m) {
    const room = c.room;
    const g = room.game;
    room.last = this.now();
    if (c.role === 'teacher') {
      const f = TEACHER[m.t];
      if (f) f(g, m, this, room);
      return;
    }
    if (c.role === 'student') {
      if (!g.student(c.sid)) { c.send({ t: 'kicked' }); c.role = null; return; }
      const f = STUDENT[m.t];
      if (f) f(g, m, c.sid, c, this, room);
    }
  }

  kick(room, sid) {
    room.clients.forEach(c => { if (c.role === 'student' && c.sid === sid) { c.send({ t: 'kicked' }); c.role = null; c.sid = null; } });
    room.game.remove(sid);
  }

  report(code, key) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (!room || room.key !== key) return null;
    return room.game.report();
  }

  sweep() {
    const now = this.now();
    this.rooms.forEach((room, code) => {
      if ((room.empty && now - room.empty > EMPTY_FOR) || now - room.last > IDLE_FOR) {
        room.clients.forEach(c => { c.send({ t: 'closed' }); c.room = null; c.role = null; });
        room.game.stopTimer();
        this.rooms.delete(code);
      }
    });
  }
}

const num = v => (v == null || v === '' ? null : +v);

const TEACHER = {
  settings: (g, m) => g.updateSettings(m.settings || {}),
  start: g => g.start(),
  lobby: g => g.toLobby(),
  choose: (g, m) => g.choose(null, m.c, m.r),
  ddWager: (g, m) => g.ddWager(null, m.amount),
  close: g => g.close(false),
  pause: g => g.pause(),
  skip: g => g.skip(),
  accept: (g, m) => g.accept(String(m.key || '')),
  next: g => g.next(),
  endRound: g => g.endRound(),
  finalWager: (g, m) => g.finalWager(null, num(m.team), m.amount),
  finish: g => g.finish(),
  move: (g, m) => g.setTeam(+m.id, num(m.team)),
  rename: (g, m) => g.rename(+m.id, m.name),
  kick: (g, m, rooms, room) => rooms.kick(room, +m.id),
  balance: g => g.balance(),
};

const STUDENT = {
  team: (g, m, id) => g.setTeam(id, num(m.team), true),
  choose: (g, m, id) => g.choose(id, m.c, m.r),
  ddWager: (g, m, id) => g.ddWager(id, m.amount),
  answer: (g, m, id) => g.answer(id, m.a),
  finalWager: (g, m, id) => g.finalWager(id, null, m.amount),
  leave: (g, m, id, c) => { c.send({ t: 'left' }); c.role = null; c.sid = null; g.remove(id); },
};

module.exports = { ClassRooms };

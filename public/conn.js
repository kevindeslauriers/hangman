// A connection to the game server that acts like a WebSocket. Some school
// networks block WebSockets, so if one doesn't open within a few seconds it
// falls back to plain web requests (long polling), and remembers that choice.
function openSocket() {
  const sock = { readyState: 0, onopen: null, onmessage: null, onclose: null, mode: '' };
  let done = false;
  const opened = mode => { sock.mode = mode; sock.readyState = 1; if (sock.onopen) sock.onopen(); };
  const closed = () => { if (done) return; done = true; sock.readyState = 3; if (sock.onclose) sock.onclose(); };
  const deliver = msg => { if (sock.onmessage) sock.onmessage({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) }); };
  let usePoll = false;
  try { usePoll = sessionStorage.getItem('conn-mode') === 'poll'; } catch (e) {}

  function viaPolling() {
    let sid = null;
    const queue = [];
    let sending = false;
    sock.send = text => { queue.push(text); pump(); };
    sock.close = () => {
      if (sid) navigator.sendBeacon ? navigator.sendBeacon('/rt/close?sid=' + sid) : fetch('/rt/close?sid=' + sid, { method: 'POST' });
      closed();
    };
    function pump() {
      if (sending || !sid || !queue.length || done) return;
      sending = true;
      const body = queue.shift();
      fetch('/rt/send?sid=' + sid, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        .then(r => { if (r.status === 410) throw new Error('gone'); })
        .then(() => { sending = false; pump(); }, () => { sending = false; closed(); });
    }
    function poll() {
      if (done) return;
      fetch('/rt/poll?sid=' + sid, { cache: 'no-store' })
        .then(r => { if (!r.ok) throw new Error('gone'); return r.json(); })
        .then(list => { list.forEach(deliver); poll(); }, closed);
    }
    fetch('/rt/open', { method: 'POST' }).then(r => r.json()).then(j => { sid = j.sid; opened('poll'); poll(); pump(); }, closed);
  }

  if (usePoll || !('WebSocket' in window)) { viaPolling(); return sock; }

  let ws;
  try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); } catch (e) { viaPolling(); return sock; }
  let wsOpen = false;
  const fallback = () => {
    if (wsOpen || done || sock.mode) return;
    try { ws.onclose = null; ws.close(); } catch (e) {}
    try { sessionStorage.setItem('conn-mode', 'poll'); } catch (e) {}
    viaPolling();
  };
  const timer = setTimeout(fallback, 6000);
  ws.onopen = () => { wsOpen = true; clearTimeout(timer); sock.send = t => ws.readyState === 1 && ws.send(t); sock.close = () => ws.close(); opened('ws'); };
  ws.onmessage = e => deliver(e.data);
  ws.onclose = () => { clearTimeout(timer); if (wsOpen) closed(); else fallback(); };
  sock.send = () => {};
  sock.close = () => { clearTimeout(timer); try { ws.close(); } catch (e) {} closed(); };
  return sock;
}

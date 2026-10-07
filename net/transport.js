// The transport (Phase 7 Step 1; docs/MULTIPLAYER.md "Transport"): how a client's messages get to the real-time
// server and back. The game only ever sees this interface, so WebSockets (today, through Colyseus) can become
// WebTransport later (datagrams for car states, a stream for the rest) without the game noticing.
//
//   const T = createColyseusTransport(Colyseus)        Colyseus: the SDK module (net/vendor/colyseus.js in the
//                                                     browser, '@colyseus/sdk' in Node)
//   const conn = await T.join(endpoint, room, { ticket, ...options })  → a connection:
//     conn.send(type, bytes, { reliable })   reliable: must arrive (events); otherwise newest-wins (car states) — over
//                                            WebSockets everything arrives anyway, in order
//     conn.on(type, fn(bytes))   conn.onStatus(fn(status, info))   status: 'dropped' | 'back' | 'left' ({ code, reason })
//     conn.leave()   conn.kind ('websocket')   conn.unreliable (false: a lost state is resent, late)
//   withNetsim(conn, { up, down, unreliable })   the same connection through network simulator links (net/netsim.js);
//                                    unreliable: { up: [types], down: [types] } may be dropped in 'datagram' mode
//   A join refused rejects with { code, message } (protocol.CODES).

export function createColyseusTransport(Colyseus) {
  return {
    kind: 'websocket',
    async join(endpoint, roomName, { ticket, ...options }) {
      const client = new Colyseus.Client(endpoint);
      client.auth.token = ticket;
      let room;
      try { room = await client.joinOrCreate(roomName, options); }
      catch (e) {
        // (the server's refusals: '[4010] The game has been updated…' — our code, then the message)
        const m = /^\[(\d{4})\]\s*(.*)$/s.exec(e?.message ?? '');
        throw Object.assign(new Error(m ? m[2] : e?.message ?? 'join failed'), { code: m ? Number(m[1]) : e?.code ?? 0 });
      }
      // (reconnecting after a drop: straight away, however recently the room was joined, and on trying every few hundred
      // ms for as long as the server keeps the car — NET.reconnectSec)
      Object.assign(room.reconnection, { minUptime: 0, minDelay: 250, delay: 250, maxDelay: 2000, maxRetries: 30 });
      const handlers = new Map(), status = new Set();
      room.onMessage('*', (type, payload) => { const fn = handlers.get(Number(type)); if (fn && payload instanceof Uint8Array) fn(payload); });
      room.onDrop?.((code, reason) => { for (const f of status) f('dropped', { code, reason }); });
      room.onReconnect?.(() => { for (const f of status) f('back', {}); });
      room.onLeave((code, reason) => { for (const f of status) f('left', { code, reason }); });
      return {
        kind: 'websocket', unreliable: false,
        send(type, bytes) { room.sendBytes(type, bytes); },
        on(type, fn) { handlers.set(type, fn); },
        onStatus(fn) { status.add(fn); return () => status.delete(fn); },
        leave() { return room.leave(true); },
        get roomId() { return room.roomId; },
        get sessionId() { return room.sessionId; },
        // (the underlying socket closed without a word: what a dropped connection looks like — tests use it)
        breakConnection() { try { room.connection.transport.ws?.close?.(); } catch { /* already */ } },
        raw: room,
      };
    },
  };
}

// A connection with a bad network in between: what's sent waits on `up`, what arrives on `down`
export function withNetsim(conn, { up, down, unreliable = { up: [], down: [] } }) {
  if (!up && !down) return conn;
  const lossyUp = new Set(unreliable.up ?? []), lossyDown = new Set(unreliable.down ?? []);
  return {
    ...conn,
    send(type, bytes, opts = {}) { if (up) up.send(b => conn.send(type, b, opts), bytes, { reliable: !lossyUp.has(type) }); else conn.send(type, bytes, opts); },
    on(type, fn) { conn.on(type, b => { if (down) down.send(x => fn(x), b, { reliable: !lossyDown.has(type) }); else fn(b); }); },
    onStatus: conn.onStatus, leave: conn.leave, breakConnection: conn.breakConnection,
    get roomId() { return conn.roomId; }, get sessionId() { return conn.sessionId; }, raw: conn.raw, kind: conn.kind, unreliable: conn.unreliable,
  };
}

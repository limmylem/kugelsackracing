// @ts-nocheck — (werift's types are its own)
// A stand-in for Cloudflare Realtime's SFU, on this computer (voice chat's tests: server/tools/voice-browser.ts). The same
// HTTPS calls the real-time server makes to Cloudflare (server/src/rt/voice.ts createSfu) — sessions, a track pushed, others'
// tracks pulled (an offer to answer), renegotiation, tracks closed — answered by a WebRTC peer of its own (werift) for
// each session, relaying each pushed voice to every session that pulled it. Nothing like Cloudflare's scale: a test.
//
//   const sfu = await startFakeSfu({ port, token })   → { url, sessions(), stop() }   (the real-time server's voice.url)

import http from 'node:http';
import { RTCPeerConnection, RtpPacket } from 'werift';

export async function startFakeSfu({ port = 0, token = 'fake-sfu-token', log = (..._: any[]) => {} } = {}) {
  type Session = { id: string; pc: any; tracks: Map<string, any>; sends: Map<string, () => void>; packets: number; counts: Map<any, any> };
  const sessions = new Map<string, Session>();
  const published = new Map<string, any>();     // `${session}/${trackName}` → werift track (once it's arrived)
  let n = 0;
  const newPc = () => new RTCPeerConnection({ iceUseIpv4: true, iceUseIpv6: false });
  const sdpOf = (pc: any) => pc.localDescription?.sdp;
  // (each media section: its mid, port, direction and first codec — for FAKE_SFU_SDP=1)
  const summary = (sdp: string) => sdp.split(/\r?\nm=/).slice(1).map(m => `[${m.split(' ')[1]} mid=${m.match(/a=mid:(\S+)/)?.[1]} ${m.match(/a=(sendonly|recvonly|sendrecv|inactive)/)?.[1]} ${m.match(/a=rtpmap:(\d+ [^\r\n]+)/)?.[1]} ssrc=${m.match(/a=ssrc:(\d+)/)?.[1]}]`).join(' ');
  // (a packet passed on: a copy without the sender's header extensions — their ids, the mid's among them, are the sending
  // session's; this session's sender adds its own, as Cloudflare does)
  const forwarded = (rtp: any) => { const p = RtpPacket.deSerialize(rtp.serialize()); p.header.extension = false; p.header.extensions = []; return p; };
  // (a track appears when its RTP does: wait for it a little)
  const trackOf = async (key: string) => { for (let i = 0; i < 50 && !published.get(key); i++) await new Promise(r => setTimeout(r, 100)); return published.get(key) ?? null; };

  async function handle(method: string, path: string, body: any) {
    let m = path.match(/^\/v1\/apps\/[^/]+\/sessions\/new$/);
    if (m && method === 'POST') {
      const id = `s${++n}${Math.random().toString(36).slice(2, 8)}`, pc = newPc(), s: Session = { id, pc, tracks: new Map(), sends: new Map(), packets: 0, counts: new Map() };
      sessions.set(id, s);
      pc.ontrack = (ev: any) => {
        const mid = ev.transceiver?.mid, name = s.tracks.get(mid);
        ev.track.onReceiveRtp.subscribe(() => { s.packets++; });
        if (name) { published.set(`${id}/${name}`, ev.track); log('fake sfu: track', id, name); }
        else s.tracks.set(`pending:${mid}`, ev.track);
      };
      return { sessionId: id };
    }
    m = path.match(/^\/v1\/apps\/[^/]+\/sessions\/([^/]+)\/(tracks\/new|renegotiate|tracks\/close)$/);
    const s = m && sessions.get(m[1]);
    if (!s) return [404, { errorCode: 'session_not_found' }];
    const pc = s.pc;
    if (m[2] === 'tracks/new') {
      const local = body.tracks.filter((t: any) => t.location === 'local'), remote = body.tracks.filter((t: any) => t.location === 'remote');
      if (local.length) {
        for (const t of local) s.tracks.set(t.mid, t.trackName);
        await pc.setRemoteDescription(body.sessionDescription);
        await pc.setLocalDescription(await pc.createAnswer());
        // (a track already arrived before its name did)
        for (const t of local) { const early = s.tracks.get(`pending:${t.mid}`); if (early) published.set(`${s.id}/${t.trackName}`, early); }
        return { requiresImmediateRenegotiation: false, sessionDescription: { type: 'answer', sdp: sdpOf(pc) }, tracks: local.map((t: any) => ({ mid: t.mid, trackName: t.trackName })) };
      }
      const out: any[] = [];
      for (const t of remote) {
        const src = await trackOf(`${t.sessionId}/${t.trackName}`);
        if (!src) { out.push({ trackName: t.trackName, sessionId: t.sessionId, errorCode: 'not_found' }); continue; }
        const tr = pc.addTransceiver('audio', { direction: 'sendonly' }), count = { sent: 0, failed: 0, err: '' };
        const sub = src.onReceiveRtp.subscribe((rtp: any) => { count.sent++; void Promise.resolve().then(() => tr.sender.sendRtp(forwarded(rtp))).catch((e: any) => { count.failed++; count.err = String(e?.message ?? e).slice(0, 80); }); });
        s.counts.set(tr, count);
        out.push({ trackName: t.trackName, sessionId: t.sessionId, transceiver: tr, unsub: () => sub.unSubscribe() });
      }
      if (!out.some(t => t.transceiver)) return { requiresImmediateRenegotiation: false, tracks: out };
      await pc.setLocalDescription(await pc.createOffer());
      if (process.env.FAKE_SFU_SDP) console.log('fake sfu offer', s.id, summary(sdpOf(pc)));
      return { requiresImmediateRenegotiation: true, sessionDescription: { type: 'offer', sdp: sdpOf(pc) },
        tracks: out.map(t => { if (t.transceiver) s.sends.set(t.transceiver.mid, t.unsub); return t.transceiver ? { mid: t.transceiver.mid, trackName: t.trackName, sessionId: t.sessionId } : t; }) };
    }
    if (m[2] === 'renegotiate') { if (process.env.FAKE_SFU_SDP) console.log('fake sfu answer', s.id, summary(body.sessionDescription.sdp)); await pc.setRemoteDescription(body.sessionDescription); return {}; }
    // (closed by the game: its offer with them stopped)
    for (const t of body.tracks ?? []) { s.sends.get(t.mid)?.(); s.sends.delete(t.mid); }
    await pc.setRemoteDescription(body.sessionDescription);
    await pc.setLocalDescription(await pc.createAnswer());
    return { requiresImmediateRenegotiation: false, sessionDescription: { type: 'answer', sdp: sdpOf(pc) }, tracks: (body.tracks ?? []).map((t: any) => ({ mid: t.mid })) };
  }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', async () => {
      const reply = (status: number, json: any) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, PUT' }); res.end(JSON.stringify(json)); };
      if (req.method === 'OPTIONS') return reply(204, {});
      if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { errorCode: 'unauthorized' });
      try {
        const r = await handle(req.method!, new URL(req.url!, 'http://x').pathname, raw ? JSON.parse(raw) : {});
        return Array.isArray(r) ? reply(r[0], r[1]) : reply(200, r);
      } catch (e: any) { log('fake sfu: failed', e?.stack ?? e); return reply(500, { errorCode: 'internal', errorDescription: e?.message }); }
    });
  });
  await new Promise<void>(r => server.listen(port, '127.0.0.1', r));
  const at = (server.address() as any).port;
  return {
    url: `http://127.0.0.1:${at}/v1`,
    sessions: () => [...sessions.values()].map(s => ({ id: s.id, packets: s.packets, pulling: s.sends.size, sends: [...s.counts].map(([tr, c]) => ({ mid: tr.mid, dir: tr.currentDirection ?? tr.direction, stopped: !!tr.stopped, ...c })) })),
    async stop() { for (const s of sessions.values()) await s.pc.close().catch(() => {}); await new Promise(r => server.close(r)); },
  };
}

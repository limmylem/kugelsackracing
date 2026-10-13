// Voice chat in the game (docs/FREE_ROAM.md "Voice chat"): one WebRTC connection to Cloudflare Realtime's SFU, set up
// through the free-roam zone (server/src/rt/voice.ts — the SFU's key is the server's). It sends one voice, this player's —
// silence until their microphone's on and they're talking (open mic, over a level) or holding push to talk — and plays
// the voices the zone says they hear (mp/voice.js: their party, or the players near them), each at its distance's volume.
//
//   const V = createVoice({ RC, cfg, myPos, posOf, isMuted, onChange, toast })
//   V.hello() (asks the zone whether the server has voice chat: joins if so) · V.available(on) · V.start() · V.stop() · V.message(m) (the zone's)
//   V.setMic(on) · V.setMode('open' | 'ptt') · V.setVolume(0..1) · V.setPttKey(code) · V.ptt(down) · V.sync()
//   V.state → { available, joined, mic, live, mode, volume, pttKey, peers: [{ uid, name, d, party, playing, speaking }], why }
// The player's choices here (microphone, mode, volume, key) are kept in this browser; party and proximity voice are free
// roam's settings (the account's).

import { voiceGain } from '../mp/voice.js';

const PREFS = 'kr.voice', LOOKAHEAD = 0.06;
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) ?? '{}') ?? {}; } catch { return {}; } };

export function createVoice({ RC, cfg, myPos = () => null, posOf = () => null, isMuted = () => false, onChange = () => {}, toast = () => {} }) {
  const V = cfg.voice, saved = loadPrefs();
  const st = { available: false, joined: false, mic: !!saved.mic, live: false, mode: saved.mode === 'ptt' ? 'ptt' : 'open', volume: Number.isFinite(saved.volume) ? saved.volume : 1, pttKey: saved.pttKey || V.pttKey, voiceMode: 'off', why: '' };
  const save = () => { try { localStorage.setItem(PREFS, JSON.stringify({ ...saved, mic: st.mic, mode: st.mode, volume: st.volume, pttKey: st.pttKey })); } catch { /* private */ } };
  let pc = null, ctx = null, gate = null, dest = null, micStream = null, micSrc = null, micLevel = null, micDelay = null, wanted = false;
  let peers = [], lastList = 0, pttDown = false, openUntil = 0, opens = 0, retryAt = 0, req = 0, busy = null, again = false;
  const pulled = new Map();          // uid → { mid, el, stream, level, speaking }
  const byMid = new Map();           // mid → uid (a track arriving)
  const failed = new Map();          // uid → when it may be tried again
  const waits = new Map();           // req → { resolve, reject, timer }
  const changed = () => { try { onChange(api.state); } catch (e) { console.warn(e); } };

  // ---------- asking the zone ----------
  function ask(msg, ms = 15000) {
    const id = ++req;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waits.delete(id); reject(new Error('Voice chat didn\'t answer.')); }, ms);
      waits.set(id, { resolve, reject, timer });
      RC.send({ ...msg, req: id });
    });
  }
  function message(m) {
    if (m.t === 'voice-hello') { api.available(!!m.voice); if (m.voice) api.start(); return; }
    if (m.t === 'voice') {
      // (the home zone's word only: near a border another zone may know an older one)
      if (m.zone && m.zone !== RC.home) return;
      peers = m.peers ?? []; st.voiceMode = m.mode ?? 'off'; lastList = performance.now();
      void sync(); changed(); return;
    }
    const w = m.req != null && waits.get(m.req);
    if (!w) return;
    waits.delete(m.req); clearTimeout(w.timer);
    if (m.t === 'voice-error') w.reject(new Error(m.why || 'Voice chat didn\'t connect.')); else w.resolve(m);
  }

  // ---------- the audio ----------
  function audio() {
    if (ctx) return;
    ctx = new AudioContext();
    dest = ctx.createMediaStreamDestination();
    gate = ctx.createGain(); gate.gain.value = 0; gate.connect(dest);
    // (a click or key anywhere: the browser lets sound start)
    const wake = () => { void ctx?.resume().catch(() => {}); for (const p of pulled.values()) void p.el.play().catch(() => {}); };
    addEventListener('pointerdown', wake, true); addEventListener('keydown', wake, true);
    api._unwake = () => { removeEventListener('pointerdown', wake, true); removeEventListener('keydown', wake, true); };
  }
  const levelOf = an => { const a = new Float32Array(an.fftSize); an.getFloatTimeDomainData(a); let s = 0; for (const v of a) s += v * v; return 10 * Math.log10(s / a.length + 1e-12); };
  async function micOn() {
    if (micStream) return true;
    try {
      // (noise suppression on unless this browser's prefs say otherwise — the tests' fake microphone, a steady beep, it learns as noise)
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: saved.noiseSuppression !== false, autoGainControl: true, channelCount: 1 } });
    } catch (e) {
      st.mic = false; save(); st.why = e?.name === 'NotAllowedError' ? 'The browser wasn\'t allowed to use your microphone: allow it in the address bar, then turn it on again.' : 'No microphone found.';
      toast(st.why); changed(); return false;
    }
    audio();
    micSrc = ctx.createMediaStreamSource(micStream);
    micLevel = ctx.createAnalyser(); micLevel.fftSize = 256;
    // (the gate hears the sound LOOKAHEAD s before it lets it through: a word's start isn't cut off)
    micDelay = ctx.createDelay(1); micDelay.delayTime.value = LOOKAHEAD;
    micSrc.connect(micLevel); micSrc.connect(micDelay); micDelay.connect(gate);
    st.why = '';
    return true;
  }
  function micOff() {
    try { micSrc?.disconnect(); micDelay?.disconnect(); } catch { /* gone */ }
    micStream?.getTracks().forEach(t => t.stop());
    micStream = micSrc = micLevel = micDelay = null; st.live = false;
    if (gate) gate.gain.value = 0;
  }
  // (every 20 ms: the gate — open mic over the level, or push to talk)
  const gating = setInterval(() => {
    if (!gate || !micLevel) return;
    const now = performance.now();
    if (levelOf(micLevel) > V.gateDb) openUntil = now + V.gateHoldMs;
    const live = st.mode === 'ptt' ? pttDown : now < openUntil;
    if (live !== st.live) { st.live = live; if (live) opens++; gate.gain.setTargetAtTime(live ? 1 : 0, ctx.currentTime, 0.008); changed(); }
  }, 20);
  // (every 100 ms: each voice's volume and whether it's talking)
  const tick = setInterval(() => {
    const now = performance.now();
    const me = myPos();
    let talk = false;
    for (const [uid, p] of pulled) {
      const peer = peers.find(x => x.uid === uid);
      const there = posOf(uid), d = peer?.party ? null : (me && there ? Math.hypot(me[0] - there[0], me[1] - there[1]) : peer?.d ?? null);
      p.el.volume = Math.max(0, Math.min(1, voiceGain(d, cfg) * st.volume));
      // (talking: loud in the last half second — no flicker between words; the level as WebRTC measured it arriving)
      if ((p.audioLevel ?? 0) > 0.01) p.loudAt = now;
      const speaking = now - (p.loudAt ?? -1e9) < 500;
      if (speaking !== p.speaking) { p.speaking = speaking; talk = true; }
    }
    if (talk) changed();
    // (no word from the zone for a while: joined again — a lost connection, another process)
    if (st.joined && now - lastList > 10000) { void restart('quiet'); }
    if (wanted && !st.joined && !busy && now > retryAt) void join();
  }, 100);

  // (every 250 ms: how loud each voice is arriving — the connection's own measure, sound or not in the page's graph)
  const stats = setInterval(async () => {
    if (!pc || !pulled.size) return;
    try {
      const r = await pc.getStats();
      r.forEach(x => {
        if (x.type !== 'inbound-rtp' || x.kind !== 'audio') return;
        const uid = byMid.get(x.mid), p = uid && pulled.get(uid);
        if (!p) return;
        // (the level over the last 250 ms, from the energy that arrived: a short word isn't missed between samples)
        const e = x.totalAudioEnergy ?? 0, d = x.totalSamplesDuration ?? 0;
        p.audioLevel = p.dur != null && d > p.dur ? Math.sqrt(Math.max(0, e - p.energy) / (d - p.dur)) : 0;
        p.energy = e; p.dur = d; p.packets = x.packetsReceived ?? 0;
      });
    } catch { /* closed */ }
  }, 250);

  // ---------- the connection ----------
  async function join() {
    if (busy || st.joined || !st.available) return;
    busy = (async () => {
      try {
        audio();
        if (st.mic) await micOn();
        pc = new RTCPeerConnection({ iceServers: [{ urls: V.stun }], bundlePolicy: 'max-bundle' });
        const tx = pc.addTransceiver(dest.stream.getAudioTracks()[0], { direction: 'sendonly' });
        pc.ontrack = e => { const uid = byMid.get(e.transceiver?.mid); if (uid) attach(uid, e.transceiver.mid, e.track); };
        pc.onconnectionstatechange = () => { if (pc && ['failed', 'closed'].includes(pc.connectionState)) void restart('connection'); };
        await pc.setLocalDescription(await pc.createOffer());
        const r = await ask({ t: 'voice-join', sdp: pc.localDescription.sdp, mid: tx.mid, mic: !!micStream });
        // (Opus: mono, at V.bitrateBps, and nothing sent in silence — DTX)
        await pc.setRemoteDescription({ type: 'answer', sdp: opus(r.sdp) });
        try { const p = tx.sender.getParameters(); p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: V.bitrateBps }]; await tx.sender.setParameters(p); } catch { /* as it is */ }
        st.joined = true; st.why = ''; lastList = performance.now(); failed.clear();
      } catch (e) {
        st.why = e?.message ?? 'Voice chat didn\'t connect.'; retryAt = performance.now() + 8000;
        teardown(false);
      }
      changed();
    })();
    await busy; busy = null;
    if (st.joined) void sync();
  }
  const opus = sdp => String(sdp ?? '').replace(/a=fmtp:(\d+) ([^\r\n]*)/g, (line, pt, params) => /useinbandfec|minptime/.test(params) && !/usedtx/.test(params) ? `a=fmtp:${pt} ${params};usedtx=1;stereo=0;maxaveragebitrate=${V.bitrateBps}` : line);
  function attach(uid, mid, track) {
    const old = pulled.get(uid);
    if (old && old.mid !== mid) old.el.remove();
    const stream = new MediaStream([track]), el = new Audio();
    el.autoplay = true; el.srcObject = stream; el.dataset.voice = uid; el.volume = 0;
    el.style.display = 'none'; document.body.appendChild(el);
    void el.play().catch(() => {});
    pulled.set(uid, { mid, el, stream, speaking: false, audioLevel: 0, energy: 0, dur: null, packets: 0 });
    changed();
  }
  function teardown(say = true) {
    for (const p of pulled.values()) p.el.remove();
    pulled.clear(); byMid.clear();
    try { pc?.close(); } catch { /* gone */ }
    pc = null; st.joined = false;
    for (const w of waits.values()) { clearTimeout(w.timer); w.reject(new Error('Voice chat left.')); }
    waits.clear();
    if (say) changed();
  }
  async function restart(why) {
    if (busy) return;
    teardown();
    retryAt = performance.now() + (why === 'quiet' ? 0 : 3000);
  }

  // what's pulled made what the zone says: the new voices pulled, the gone ones closed (one change at a time)
  async function sync() {
    if (!st.joined || !pc) return;
    if (busy) { again = true; return; }
    busy = (async () => {
      do {
        again = false;
        const now = performance.now(), want = new Set(peers.filter(p => !isMuted(p.uid)).map(p => p.uid));
        const drop = [...pulled.entries()].filter(([uid]) => !want.has(uid));
        const pull = [...want].filter(uid => !pulled.has(uid) && ![...byMid.values()].includes(uid) && !(failed.get(uid) > now));
        try {
          if (drop.length) {
            const mids = drop.map(([, p]) => p.mid);
            for (const [uid, p] of drop) { p.el.remove(); pulled.delete(uid); byMid.delete(p.mid); }
            for (const t of pc.getTransceivers()) if (mids.includes(t.mid)) t.stop();
            await pc.setLocalDescription(await pc.createOffer());
            const r = await ask({ t: 'voice-drop', mids, sdp: pc.localDescription.sdp });
            if (r.sdp) await pc.setRemoteDescription({ type: 'answer', sdp: r.sdp });
          }
          if (pull.length && pc) {
            const r = await ask({ t: 'voice-pull', uids: pull });
            for (const t of r.tracks ?? []) { if (t.mid) byMid.set(t.mid, t.uid); else failed.set(t.uid, now + 5000); }
            if (r.sdp) {
              await pc.setRemoteDescription({ type: 'offer', sdp: r.sdp });
              await pc.setLocalDescription(await pc.createAnswer());
              await ask({ t: 'voice-answer', sdp: pc.localDescription.sdp });
            }
          }
        } catch (e) {
          // (out of step with the SFU: start again)
          console.warn('voice', e?.message ?? e);
          busy = null; await restart('sync'); return;
        }
      } while (again && st.joined);
    })();
    await busy; busy = null;
    changed();
  }

  // ---------- push to talk ----------
  const typing = e => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);
  const down = e => { if (e.code === st.pttKey && !typing(e) && st.mode === 'ptt') { e.preventDefault(); e.stopPropagation(); if (!pttDown) { pttDown = true; } } };
  const up = e => { if (e.code === st.pttKey) pttDown = false; };
  const blur = () => { pttDown = false; };
  addEventListener('keydown', down, true); addEventListener('keyup', up, true); addEventListener('blur', blur);

  const api = {
    message,
    hello() { RC.send({ t: 'voice-hello' }); },
    available(on) { st.available = !!on; if (!on) { st.why = 'Voice chat isn\'t set up on this server yet.'; teardown(); } else if (st.why === 'Voice chat isn\'t set up on this server yet.') st.why = ''; changed(); },
    start() { wanted = true; retryAt = 0; void join(); },
    stop() { wanted = false; if (st.joined) RC.send({ t: 'voice-leave' }); teardown(); micOff(); },
    async setMic(on) {
      st.mic = !!on; save();
      if (on) { if (!(await micOn())) return; if (!st.joined) { wanted = true; void join(); } }
      else micOff();
      if (st.joined) RC.send({ t: 'voice-mic', on: !!micStream });
      changed();
    },
    setMode(m) { st.mode = m === 'ptt' ? 'ptt' : 'open'; save(); changed(); },
    setVolume(v) { st.volume = Math.max(0, Math.min(1, Number(v) || 0)); save(); changed(); },
    setPttKey(code) { if (typeof code === 'string' && code) { st.pttKey = code; save(); changed(); } },
    ptt(on) { pttDown = !!on; },
    sync: () => sync(),
    get state() {
      return { available: st.available, joined: st.joined, mic: st.mic && !!micStream, live: st.live, mode: st.mode, volume: st.volume, pttKey: st.pttKey, voiceMode: st.voiceMode, why: st.why,
        peers: peers.map(p => ({ ...p, muted: isMuted(p.uid), playing: pulled.has(p.uid), speaking: !!pulled.get(p.uid)?.speaking })) };
    },
    // (the tests: what's playing, and how loud)
    debug: () => ({ pc: pc?.connectionState ?? null, pulled: [...pulled].map(([uid, p]) => ({ uid, mid: p.mid, volume: p.el.volume, audioLevel: p.audioLevel, energy: p.energy, packets: p.packets })), micLevel: micLevel ? levelOf(micLevel) : null, opens }),
    dispose() { api.stop(); clearInterval(tick); clearInterval(gating); clearInterval(stats); removeEventListener('keydown', down, true); removeEventListener('keyup', up, true); removeEventListener('blur', blur); api._unwake?.(); void ctx?.close().catch(() => {}); ctx = null; },
  };
  return api;
}

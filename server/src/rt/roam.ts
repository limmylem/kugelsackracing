// Free roam's zone servers (Phase 7 Step 4; docs/FREE_ROAM.md): one room per instance of a zone of a region — 'roam',
// filtered by { region, zone, group }. A zone is a square of Map v3 tiles (mp/roam.js); an instance holds at most
// roam.zones.capacity players (and friendSlots more, for friends and parties joining theirs). A player is in their HOME
// zone's instance and, near a border, the neighbour's too (the same group where it can be): the game sends its car to
// both and draws the cars of both, so driving over the border hands it over with nothing to load and nothing to see.
//
// It's Step 1's room (room.ts: cars relayed, checked, interest-managed, time-synced; reconnecting) with free roam on top:
//   - privacy and blocks: a player never sees someone blocked either way (no car, no roster entry, no chat); names by
//     the privacy setting (mp/roam.js nameFor); the region's map (every player in every zone, as each viewer may see
//     them) every mapEverySec from Redis presence; friends' status (free roam, where — or offline when hidden)
//   - collisions: ghost by default; touching only between players who both have contact on (or a party with party contact
//     on), never in passive mode (switching it waits), auto-ghosted or in another challenge — Step 3's referee agrees each
//     contact; at fault in too many hits, a player is ghosted for everyone and their safety rating drops (the API)
//   - challenges (mp/challenge.js): by the menu or by flashing headlights; the route on the road graph shown to both;
//     a rolling start; racers ghosted to everyone else; the record handed to the API, which checks it and pays (capped)
//   - chat: the wheel's presets, nearby text (within nearbyM, to those who have it on) and party chat (wherever they are)
//   - meets: parking in a meet spot's places, emotes, inspecting a car
//   - reports: a player reported with the last replaySec of both cars as this zone kept them
//   - where each player is, saved (the API) every saveEverySec and when they leave (from their home zone)
//
// The game's messages ('mp', JSON): settings { settings } · party { id } · home { home } · challenge { to, type, dest? } ·
//   challenge-answer { id, yes } · challenge-cancel { id } · chat { scope: 'nearby' | 'party', text } · wheel { id, scope } ·
//   emote { id } · inspect { uid } · report { uid, details } · meet-park { meet } · meet-leave · contact-report (Step 3)
// What it sends: hello · touch { with, passive, ghostUntil, … } · map { players } · challenge-invite / -sent / -start /
//   -event { id, event: { t: 'go' | 'hold' | 'checkpoint' | 'finish' | 'penalty' | 'dnf' | 'done' | … } } / -results / -declined · chat · emote · inspect · meet-spot · notice · contact / contact-rejected / ghosts / ramming

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { matchMaker, type Client } from '@colyseus/core';
import { LIGHT, S2C } from '../../../net/protocol.js';
import { encodeValue } from '../../../net/codec.js';
import { TestRoom, rtEnv, authorize, type Player } from './room.ts';
import { setStatus, clearStatus, toUser, onUser, getParty } from './mp.ts';
import { cleanChat } from '../names.ts';
import { MP, ROAM } from './mpData.ts';
import { REPO_DIR } from '../config.ts';
import { createReferee } from './contact.ts';
import { safetyTier, yawOf } from '../../../mp/contact.js';
import { createChatGate } from '../../../mp/lobby.js';
import { touches, nameFor, seesOnMap, createAutoGhost, mapPoint, toggleAllowed, zoneSize, zoneOf, meetSpots, nearestFreeSpot } from '../../../mp/roam.js';
import { createChallengeBook, createFlashDetector, sprintRoute, createChallengeRun } from '../../../mp/challenge.js';
import { createNetwork } from '../../../route/network.js';
import { transverseMercator } from '../../../map/build/format/projection.js';

const STOCK = { mass: 1300, box: { halfExtents: [0.9, 0.6, 2.2], centre: [0, 0.7, 0] } };
const SETTING_KEYS = ['location', 'appearOffline', 'nearbyChat', 'names', 'contact', 'passive', 'partyContact'] as const;
const MAP_KEY = (region: string) => `rt:roam:map:${region}`, GHOST_KEY = (uid: string) => `rt:roam:ghost:${uid}`;
const TRAIL_SEC = 20;

// the settings a player sent, made sensible (anything else ignored)
export function cleanSettings(s: any, base: any = ROAM.privacy.default) {
  const out: any = { ...base };
  if (!s || typeof s !== 'object') return out;
  if (ROAM.privacy.locations.includes(s.location)) out.location = s.location;
  for (const k of SETTING_KEYS) if (k !== 'location' && typeof s[k] === 'boolean') out[k] = s[k];
  return out;
}

// ---------- the road graphs (challenge routes), once a process ----------
const networks = new Map<string, any>();
export function networkOf(region: string) {
  if (networks.has(region)) return networks.get(region);
  let N: any = null;
  try {
    const dir = path.join(REPO_DIR, 'assets/map', region.replace(/[^a-z0-9_-]/gi, ''));
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const P = transverseMercator(m.projection.lat0, m.projection.lon0);
    N = createNetwork(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'graph.json.gz'))).toString()), { P, region, version: m.version, bbox: m.bbox } as any);
  } catch (e: any) { rtEnv.log('rt roam: no road graph', { region, err: e?.message }); }
  networks.set(region, N);
  return N;
}

// ---------- shared by every zone room in this process ----------
// the region's map: every player's place, as their home zone wrote it (one read a region per mapEverySec, shared)
const mapCache = new Map<string, { at: number; list: any[]; pending?: Promise<any[]> }>();
async function regionMap(region: string) {
  const c = mapCache.get(region), now = Date.now();
  if (c && now - c.at < ROAM.zones.mapEverySec * 900) return c.list;
  if (c?.pending) return c.pending;
  const pending = (async () => {
    const all = (await matchMaker.presence.hgetall(MAP_KEY(region))) ?? {};
    const list: any[] = [];
    for (const v of Object.values(all)) { try { const e = JSON.parse(String(v)); if (Date.now() - e.at < ROAM.zones.mapEverySec * 5000) list.push(e); } catch { /* bad */ } }
    mapCache.set(region, { at: Date.now(), list });
    return list;
  })();
  mapCache.set(region, { at: c?.at ?? 0, list: c?.list ?? [], pending });
  return pending;
}
// the automatic protection's record of hits, across this process's rooms (ghosts also go to Redis: every zone obeys them)
const autoGhost = createAutoGhost(ROAM);
// handoffs and numbers for the dashboard (reported to the API every few seconds: ./server.ts)
export const roamCounters = { handoffs: 0, joins: 0, challenges: 0, contacts: 0, autoGhosts: 0, reports: 0 };

type Roam = {
  uid: string; name: string; settings: any; friends: Set<string>; blocked: Set<string>; partyId: string | null; party: Set<string>;
  home: boolean; ghostUntil: number; challenge: string | null; toggles: Record<string, number>; chat: (now: number) => boolean;
  car: { instanceId?: string; carId?: string; name?: string; cls?: string; pr?: number; mass: number; box: any };
  lights: boolean; trail: number[][]; touchKey: string; meet: { id: string; spot: number } | null; reports: number[]; off: () => void; savedAt: number;
};

export class RoamRoom extends TestRoom {
  static live = new Set<RoamRoom>();
  scope = 'roam';
  region = 'local';
  zone = '0,0';
  group = 'g1';
  roam = new Map<string, Roam>();           // by uid
  book = createChallengeBook(ROAM);
  flashes = createFlashDetector(ROAM);
  runs = new Map<string, any>();
  meets = new Map<string, Map<number, string>>();   // meet id → spot → uid
  referee: ReturnType<typeof createReferee> | null = null;
  slowTicks = 0;

  // ("server full" refuses a player coming in, never one already here: a neighbouring zone, a handoff, a lost connection joined again)
  static async onAuth(token: string, options: any) { return authorize(token, options, { count: !(options?.extra || options?.handoff || options?.rejoin) }); }

  onCreate(options: any) {
    this.region = typeof options?.region === 'string' ? options.region.slice(0, 32) : 'local';
    this.zone = typeof options?.zone === 'string' && /^-?\d+,-?\d+$/.test(options.zone) ? options.zone : '0,0';
    this.group = typeof options?.group === 'string' ? options.group.slice(0, 24) : 'g1';
    super.onCreate({ world: `roam:${this.region}` });
    RoamRoom.live.add(this);
    this.maxClients = ROAM.zones.capacity + ROAM.zones.friendSlots;
    this.onMessage('mp', (c, m) => { void this.onMp(c, m).catch(e => rtEnv.log('rt roam message failed', { err: e?.message })); });
    this.referee = createReferee({
      cfg: MP.contact, mode: () => ROAM.contact.mode, now: () => this.roomNow(), course: null,
      car: uid => { const r = this.roam.get(uid); return r ? { uid, name: r.name, mass: r.car.mass, box: r.car.box } : null; },
      isRacer: uid => this.roam.has(uid), raceOf: () => null,
      send: (uid, msg) => { const p = this.playerOf(uid); if (p) this.sendTo(p, msg); },
      // (a contact goes to the two cars and anyone near enough to see or hear it)
      broadcast: msg => { const uids = Object.keys(msg?.other ?? {}); const at = this.posOf(uids[0]); for (const p of this.players.values()) if (uids.includes(p.t.uid) || (at && p.latestF && Math.hypot(p.latestF.pos[0] - at[0], p.latestF.pos[2] - at[2]) < 200)) this.sendTo(p, msg); },
      penalize: () => {}, saveEvidence: e => rtEnv.api ? rtEnv.api.saveEvidence({ ...e, kind: 'roam-ramming' }) : Promise.reject(new Error('no API')), raceId: () => null,
      pairAllowed: (a, b) => touches(this.touchOf(a), this.touchOf(b), Date.now()),
      onContact: (msg, bl) => this.onContact(msg, bl),
    });
    this.clock.setInterval(() => { try { this.roamTick(); } catch (e: any) { rtEnv.log('rt roam tick failed', { err: e?.stack ?? e?.message }); } }, 100);
    this.clock.setInterval(() => void this.slowTick().catch(e => rtEnv.log('rt roam tick failed', { err: e?.message })), ROAM.zones.mapEverySec * 1000);
    void this.meta();
  }
  onDispose() { super.onDispose(); RoamRoom.live.delete(this); for (const r of this.roam.values()) r.off(); }

  protected pageOf(options: any) { return typeof options?.page === 'string' ? options.page.slice(0, 40) : null; }
  protected hidden(viewer: Player, target: Player) {
    const v = this.roam.get(viewer.t.uid), t = this.roam.get(target.t.uid);
    return !!(v?.blocked.has(target.t.uid) || t?.blocked.has(viewer.t.uid));
  }
  protected entryFor(viewer: Player | null, p: Player) {
    const e = this.entry(p), r = this.roam.get(p.t.uid);
    if (!viewer || !r) return e;
    return { ...e, name: nameFor(viewer.t.uid, { uid: r.uid, name: r.name, settings: r.settings }, this.relOf(viewer.t.uid)) };
  }
  relOf(uid: string) { const r = this.roam.get(uid); return { friends: r?.friends ?? new Set<string>(), blocked: r?.blocked ?? new Set<string>(), party: r?.party ?? new Set<string>() }; }
  playerOf(uid: string) { for (const p of this.players.values()) if (p.t.uid === uid && p.status === 'here') return p; return null; }
  posOf(uid: string) { return this.playerOf(uid)?.latestF?.pos ?? null; }
  touchOf(uid: string) { const r = this.roam.get(uid); return r ? { uid, settings: r.settings, party: r.partyId, ghostUntil: r.ghostUntil, challenge: r.challenge } : null; }
  sendTo(p: Player, msg: any) { try { p.client.send('mp', msg); } catch { /* gone */ } }
  say(p: Player, text: string) { this.sendTo(p, { t: 'notice', text }); }

  // ---------- joining and leaving ----------
  // (before the roster goes out: who they are to free roam — their settings, friends, blocks — so names and blocks apply)
  protected joining(p: Player, options: any) {
    const t: any = p.t, mp = t.mp ?? {}, cur = (mp.cars ?? []).find((c: any) => c.current) ?? mp.cars?.[0] ?? null;
    const r: Roam = {
      uid: t.uid, name: t.name, settings: cleanSettings(options?.settings, cleanSettings(mp.roam?.settings)), friends: new Set(mp.friends ?? []), blocked: new Set(mp.blocked ?? []),
      partyId: null, party: new Set(), home: options?.home !== false, ghostUntil: Math.max(0, Number(mp.roam?.ghostUntil) || 0), challenge: null, toggles: {}, chat: createChatGate(ROAM.chat),
      car: { ...(cur ?? {}), mass: cur?.mass ?? STOCK.mass, box: cur?.box ?? STOCK.box }, lights: false, trail: [], touchKey: '', meet: null, reports: [], off: () => {}, savedAt: 0,
    };
    this.roam.get(t.uid)?.off();
    this.roam.set(t.uid, r);
  }
  protected joined(p: Player, options: any) {
    const t: any = p.t, r = this.roam.get(t.uid)!;
    roamCounters.joins++;
    if (options?.handoff) roamCounters.handoffs++;
    // (their friends and blocks changed elsewhere — the hub, the API: read again; an auto-ghost from another zone)
    r.off = onUser(t.uid, (msg: any) => { if (msg?.t === 'relations') void this.reloadRelations(r); });
    void Promise.resolve(matchMaker.presence.get(GHOST_KEY(t.uid))).then(v => { const until = Number(v); if (until > Date.now()) { r.ghostUntil = until; this.pushTouch(); } }).catch(() => {});
    if (typeof options?.party === 'string') void this.setParty(r, options.party);
    // (anyone blocked either way who's here: gone from each other's view — the hidden() check; their cars stop now)
    this.sendTo(p, { t: 'hello', you: t.uid, zone: this.zone, group: this.group, region: this.region, roomId: this.roomId, settings: r.settings, wheel: ROAM.chat.wheel, emotes: ROAM.meets.emotes });
    this.pushTouch();
    void this.meta();
    if (r.home) void this.status(r);
  }
  onLeave(client: Client) {
    const p = this.players.get(client.sessionId);
    super.onLeave(client);
    if (!p) return;
    const r = this.roam.get(p.t.uid);
    if (!r || this.playerOf(p.t.uid)) return;
    // (gone from this zone: a challenge here loses them; their meet spot is free; where they were saved — if it was home)
    for (const run of this.runs.values()) if (run.racers.includes(r.uid)) run.out(r.uid, 'left');
    if (r.meet) this.meets.get(r.meet.id)?.delete(r.meet.spot);
    r.off();
    this.roam.delete(p.t.uid);
    if (r.home && p.latestF) void this.save([{ r, p, f: p.latestF }]);
    if (r.home) { void Promise.resolve(matchMaker.presence.hdel(MAP_KEY(this.region), r.uid)).catch(() => {}); void clearStatusIfOurs(r.uid, this.roomId); }
    this.pushTouch();
    void this.meta();
  }
  async reloadRelations(r: Roam) {
    try {
      if (!rtEnv.api) return;
      const rel = await rtEnv.api.relations(r.uid);
      r.friends = new Set((rel.friends ?? []).map((f: any) => f.id));
      r.blocked = new Set([...(rel.blocked ?? []), ...(rel.blockedBy ?? [])]);
      // (anyone now blocked: their cars and entries gone at once, both ways)
      const me = this.playerOf(r.uid);
      for (const o of this.players.values()) if (me && o !== me && this.hidden(me, o)) { this.out(me, S2C.ROSTER, encodeValue({ leave: { id: o.id } }), true); this.out(o, S2C.ROSTER, encodeValue({ leave: { id: me.id } }), true); me.sentBase.delete(o.id); o.sentBase.delete(me.id); }
      this.pushTouch();
    } catch { /* as was */ }
  }
  async setParty(r: Roam, id: string | null) {
    if (!id) { r.partyId = null; r.party = new Set(); this.pushTouch(); return; }
    const party = await getParty(id).catch(() => null);
    if (!party?.members?.includes(r.uid)) { r.partyId = null; r.party = new Set(); }
    else { r.partyId = party.id; r.party = new Set(party.members.filter((u: string) => u !== r.uid)); }
    this.pushTouch();
  }
  async status(r: Roam) {
    const p = this.playerOf(r.uid), pos = p?.latestF?.pos;
    await setStatus(r.uid, { state: 'free roam', roam: { region: this.region, zone: this.zone, group: this.group, roomId: this.roomId }, hidden: !!r.settings.appearOffline, location: r.settings.location, pos: pos ? mapPoint(pos, ROAM) : null }).catch(() => {});
  }

  // ---------- the cars ----------
  protected carAccepted(p: Player, f: any) {
    const r = this.roam.get(p.t.uid);
    if (!r) return;
    const now = this.roomNow();
    this.referee?.onState(p.t.uid, f, now);
    if (!r.trail.length || f.time - r.trail.at(-1)![0] >= 100) { r.trail.push([Math.round(f.time), ...[f.pos[0], f.pos[1], f.pos[2], yawOf(f.rot), f.vel[0], f.vel[2]].map(v => Math.round(v * 100) / 100)]); while (r.trail.length && r.trail[0][0] < f.time - TRAIL_SEC * 1000) r.trail.shift(); }
    for (const run of this.runs.values()) if (run.racers.includes(r.uid)) run.state(r.uid, f, now);
    // headlights flashed at someone: a challenge (a sprint to somewhere, the route shown before they answer)
    const on = !!(f.flags & LIGHT.HEAD);
    if (on !== r.lights) {
      r.lights = on;
      this.flashes.lights(r.uid, on, now);
      // (only their home zone acts on it: near a border a car is in two zones, and both see the lights)
      if (on && r.home && !r.settings.passive && !r.challenge) {
        const others = [...this.players.values()].filter(o => o !== p && o.latestF && !this.hidden(p, o)).map(o => ({ uid: o.t.uid, pos: o.latestF.pos }));
        const target = this.flashes.target(r.uid, now, { pos: f.pos, heading: yawOf(f.rot) * 180 / Math.PI }, others);
        if (target) void this.challenge(p, { to: target, type: 'sprint', how: 'flash' });
      }
    }
  }
  protected carReset(p: Player) { this.referee?.onReset(p.t.uid); }

  // ---------- touching ----------
  // each player's list of the cars here they touch (sent when it changes): the game makes contact proxies only of those
  pushTouch() {
    const now = Date.now(), list = [...this.roam.values()];
    for (const r of list) {
      const p = this.playerOf(r.uid);
      if (!p) continue;
      const w = list.filter(o => o.uid !== r.uid && !r.blocked.has(o.uid) && !o.blocked.has(r.uid) && touches(this.touchOf(r.uid), this.touchOf(o.uid), now)).map(o => o.uid).sort();
      const msg = { t: 'touch', with: w, passive: !!r.settings.passive, contact: !!r.settings.contact, ghostUntil: r.ghostUntil > now ? r.ghostUntil : 0, challenge: r.challenge };
      const key = JSON.stringify(msg);
      if (key !== r.touchKey) { r.touchKey = key; this.sendTo(p, msg); }
    }
  }
  onContact(msg: any, bl: any) {
    roamCounters.contacts++;
    if (!bl?.fault) return;
    const res = autoGhost.hit({ uid: bl.fault, t: Date.now(), share: bl.share ?? 0, strength: bl.strength ?? msg?.result?.closing ?? 0 });
    if (!res.ghosted || !res.safetyHits) return;
    roamCounters.autoGhosts++;
    // ghosted for everyone, everywhere (every zone reads it), and their safety rating to drop
    void Promise.resolve(matchMaker.presence.setex(GHOST_KEY(bl.fault), String(res.until), Math.ceil((res.until - Date.now()) / 1000))).catch(() => {});
    void Promise.resolve(matchMaker.presence.publish('rt:roam:ghost', { uid: bl.fault, until: res.until })).catch(() => {});
    void rtEnv.api?.roamIncident?.({ uid: bl.fault, hits: res.safetyHits, drop: res.safetyDrop, until: new Date(res.until).toISOString() }).catch(() => {});
    rtEnv.log('rt roam auto-ghost', { uid: bl.fault, hits: res.safetyHits, until: res.until });
  }
  ghostEverywhere(uid: string, until: number) { const r = this.roam.get(uid); if (r) { r.ghostUntil = until; const p = this.playerOf(uid); if (p) this.say(p, `You've hit other players too often: you're a ghost to everyone for ${Math.round((until - Date.now()) / 60000)} min, and your safety rating has dropped.`); this.pushTouch(); } }

  // ---------- every 100 ms: challenges, contacts ----------
  roamTick() {
    const now = this.roomNow();
    this.referee?.tick();
    for (const inv of this.book.expire(now)) this.closed(inv);
    for (const [id, run] of this.runs) {
      const events = run.tick(now);
      for (const e of events) for (const u of run.racers) { const p = this.playerOf(u); if (p) this.sendTo(p, { t: 'challenge-event', id, event: e }); }
      if (run.phase === 'done') { this.runs.delete(id); void this.finishRun(run); }
    }
    if (now % 1000 < 100) this.pushTouch();      // (ghosts that ran out)
  }
  // ---------- every mapEverySec: the map, presence, saving, the room's listing ----------
  async slowTick() {
    const now = Date.now(), toSave: { r: Roam; p: Player; f: any }[] = [];
    this.slowTicks++;
    for (const r of this.roam.values()) {
      if (!r.home) continue;
      const p = this.playerOf(r.uid);
      if (!p?.latestF) continue;
      const f = p.latestF;
      await matchMaker.presence.hset(MAP_KEY(this.region), r.uid, JSON.stringify({ uid: r.uid, name: r.name, pos: mapPoint(f.pos, ROAM), heading: Math.round(yawOf(f.rot) * 180 / Math.PI), zone: this.zone, group: this.group, settings: { location: r.settings.location, appearOffline: !!r.settings.appearOffline }, party: r.partyId, at: now }));
      if (now - r.savedAt >= ROAM.persistence.saveEverySec * 1000) { r.savedAt = now; toSave.push({ r, p, f }); }
      if (this.slowTicks % Math.max(1, Math.round(30 / ROAM.zones.mapEverySec)) === 0) void this.status(r);
    }
    if (toSave.length) void this.save(toSave);
    // the map each player may see: everyone in the region (all zones) as their privacy settings say
    const map = await regionMap(this.region);
    for (const r of this.roam.values()) {
      if (!r.home) continue;
      const p = this.playerOf(r.uid);
      if (!p) continue;
      const rel = this.relOf(r.uid);
      const players = map.filter(e => e.uid !== r.uid && seesOnMap(r.uid, e, rel)).map(e => ({ uid: e.uid, name: nameFor(r.uid, e, rel), pos: e.pos, heading: e.heading, friend: rel.friends.has(e.uid), party: rel.party.has(e.uid) }));
      this.sendTo(p, { t: 'map', players, at: now });
    }
    await this.meta();
  }
  async save(list: { r: Roam; p: Player; f: any }[]) {
    if (!rtEnv.api?.roamSave) return;
    const at = new Date().toISOString();
    const rows = list.map(({ r, p, f }) => { return { uid: r.uid, region: this.region, pos: f.pos.map((v: number) => Math.round(v * 100) / 100), heading: Math.round(yawOf(f.rot) * 1800 / Math.PI) / 10, carId: p?.look?.carId ?? r.car.carId ?? null, instanceId: r.car.instanceId ?? null, damage: p?.look?.damage ?? null, events: (p?.events ?? []).slice(-32), at }; });
    await rtEnv.api.roamSave(rows).catch((e: any) => rtEnv.log('rt roam save failed', { err: e?.message }));
  }
  // the room's listing (placement reads it): who's in it and roughly where
  async meta() {
    const players = [...this.roam.values()];
    await this.setMetadata({ region: this.region, zone: this.zone, group: this.group, players: this.players.size, uids: players.map(r => r.uid),
      positions: players.map(r => this.posOf(r.uid)).filter(Boolean).map((p: any) => [Math.round(p[0] / 50) * 50, Math.round(p[2] / 50) * 50]) }).catch(() => {});
  }

  // ---------- the game's messages ----------
  async onMp(c: Client, m: any) {
    const p = this.players.get(c.sessionId);
    if (!p || !m || typeof m.t !== 'string') return;
    const r = this.roam.get(p.t.uid);
    if (!r) return;
    const now = this.roomNow();
    switch (m.t) {
      case 'settings': {
        const next = cleanSettings(m.settings, r.settings), at = Date.now();
        for (const k of ['passive', 'contact'] as const) if (next[k] !== r.settings[k]) {
          const ok = toggleAllowed(k, r.toggles[k] ?? null, at, ROAM);
          if (!ok.ok) { next[k] = r.settings[k]; this.say(p, `You can switch ${k === 'passive' ? 'passive mode' : 'contact'} again in ${ok.waitSec} s.`); }
          else r.toggles[k] = at;
        }
        // (passive mode ends a challenge you're in, and can't be started while racing one)
        if (next.passive && r.challenge) { for (const run of this.runs.values()) if (run.racers.includes(r.uid)) run.out(r.uid, 'passive mode'); }
        r.settings = next;
        this.pushTouch();
        if (r.home) { void this.status(r); void rtEnv.api?.roamSettings?.(r.uid, next).catch(() => {}); }
        this.sendTo(p, { t: 'settings', settings: next });
        // (a name hidden or shown again: everyone's roster entry for them)
        this.broadcastRoster({ join: this.entry(p) }, p);
        return;
      }
      case 'party': return this.setParty(r, typeof m.id === 'string' ? m.id.slice(0, 40) : null);
      case 'home': r.home = !!m.home; if (r.home) void this.status(r); return;
      case 'challenge': return this.challenge(p, { to: m.to, type: m.type, dest: m.dest, how: 'menu' });
      case 'challenge-answer': {
        const res = this.book.answer(String(m.id ?? ''), r.uid, !!m.yes, now);
        if (res.state === 'gone') return this.say(p, 'That challenge has gone.');
        if (res.state !== 'waiting') this.closed(res.invite);
        return;
      }
      case 'challenge-cancel': {
        const inv = this.book.cancel(String(m.id ?? ''), now);
        if (inv) for (const u of inv.to) { const q = this.playerOf(u); if (q) this.sendTo(q, { t: 'challenge-declined', id: inv.id, why: 'cancelled' }); }
        for (const run of this.runs.values()) if (run.id === m.id && run.racers.includes(r.uid)) run.out(r.uid, 'gave up');
        return;
      }
      case 'chat': case 'wheel': {
        if (!r.chat(now)) return this.say(p, 'Slow down: a message a second or so.');
        const text = m.t === 'wheel' ? ROAM.chat.wheel.find((w: any) => w.id === m.id)?.text : cleanChat(m.text, ROAM.chat.maxLength);
        if (!text) return;
        const msg = { t: 'chat', scope: m.scope === 'party' ? 'party' : 'nearby', uid: r.uid, name: r.name, text, wheel: m.t === 'wheel' ? m.id : null, at: Date.now() };
        if (msg.scope === 'party') {
          if (!r.partyId) return this.say(p, 'You aren\'t in a party.');
          for (const u of [r.uid, ...r.party]) void toUser(u, { ...msg, from: r.uid });
          return;
        }
        return this.nearby(p, msg, ROAM.chat.nearbyM, o => o.settings.nearbyChat !== false);
      }
      case 'emote': {
        const e = ROAM.meets.emotes.find((x: any) => x.id === m.id);
        if (!e || !r.chat(now)) return;
        return this.nearby(p, { t: 'emote', uid: r.uid, name: r.name, id: e.id, text: e.text }, ROAM.meets.radiusM);
      }
      case 'inspect': {
        const q = this.playerOf(String(m.uid ?? '')), o = q && this.roam.get(q.t.uid);
        if (!q || !o || this.hidden(p, q)) return this.say(p, 'That car isn\'t here.');
        const a = p.latestF?.pos, b = q.latestF?.pos;
        if (a && b && Math.hypot(a[0] - b[0], a[2] - b[2]) > ROAM.seeing.inspectM) return this.say(p, 'Get closer to look at their car.');
        const safety = (q.t as any).mp?.safety, cars = (q.t as any).mp?.cars ?? [];
        // (the stats of the car they're driving: the API worked them out for each of their cars — the one with this model)
        const driven = cars.find((c: any) => c.carId === q.look?.carId && c.current) ?? cars.find((c: any) => c.carId === q.look?.carId) ?? null;
        return this.sendTo(p, { t: 'inspect', uid: o.uid, name: nameFor(r.uid, o, this.relOf(r.uid)), look: { carId: q.look?.carId ?? null, paint: q.look?.paint ?? null, parts: q.look?.parts ?? {} },
          car: driven ? { name: driven.name ?? null, cls: driven.cls ?? null, pr: driven.pr ?? null, mass: driven.mass ?? null } : null, safety: safety != null ? { value: Math.round(safety), tier: safetyTier(safety, MP.contact) } : null, damaged: (q.events ?? []).length });
      }
      case 'report': return this.report(p, r, String(m.uid ?? ''), String(m.details ?? ''));
      case 'meet-park': return this.park(p, r, m.meet);
      case 'meet-leave': if (r.meet) { this.meets.get(r.meet.id)?.delete(r.meet.spot); r.meet = null; } return;
      case 'contact-report': return this.referee?.report(r.uid, m);
    }
  }
  nearby(p: Player, msg: any, within: number, ok: (o: Roam) => boolean = () => true) {
    const at = p.latestF?.pos;
    for (const o of this.players.values()) {
      const or = this.roam.get(o.t.uid);
      if (!or || o.status !== 'here' || this.hidden(o, p) || !ok(or)) continue;
      const b = o.latestF?.pos;
      if (o !== p && (!at || !b || Math.hypot(at[0] - b[0], at[2] - b[2]) > within)) continue;
      this.sendTo(o, msg);
    }
  }

  // ---------- challenges ----------
  async challenge(p: Player, { to, type, dest = null, how }: { to: any; type: any; dest?: any; how: string }) {
    const r = this.roam.get(p.t.uid)!, now = this.roomNow();
    if (r.settings.passive) return this.say(p, 'You\'re in passive mode: turn it off to challenge anyone.');
    if (r.challenge) return this.say(p, 'Finish the challenge you\'re in first.');
    const targets = to === 'party' ? [...r.party].filter(u => this.playerOf(u)) : [String(to ?? '')];
    const at = p.latestF?.pos;
    if (!at) return this.say(p, 'Drive a little first.');
    const check = (_a: string, b: string) => {
      const q = this.playerOf(b), o = this.roam.get(b);
      if (!q || !o) return 'They aren\'t near you.';
      if (o.settings.passive) return `${o.name} is in passive mode.`;
      if (o.challenge) return `${o.name} is in a challenge already.`;
      const bp = q.latestF?.pos;
      if (!bp || Math.hypot(bp[0] - at[0], bp[2] - at[2]) > ROAM.challenges.rangeM * (to === 'party' ? 10 : 1)) return `${o.name} is too far away: get within ${ROAM.challenges.rangeM} m.`;
      return null;
    };
    // the route: a destination by road (a sprint), to a quest marker (dest), or none (follow-the-leader)
    let route: any = null;
    if (type === 'sprint' || type === 'quest') {
      const N = networkOf(this.region);
      if (!N) return this.say(p, 'Challenges need this region\'s road map.');
      const toPt = type === 'quest' && Array.isArray(dest) && dest.length === 2 && dest.every(Number.isFinite) ? dest.map(Number) : null;
      if (type === 'quest' && (!toPt || Math.hypot(toPt[0] - at[0], toPt[1] - at[2]) > ROAM.challenges.questRangeM)) return this.say(p, 'Pick a quest marker nearer than that.');
      route = sprintRoute(N, [at[0], at[2]], ROAM, { to: toPt } as any);
      if (!route.ok) return this.say(p, route.problems?.[0] ?? 'No route from here.');
    }
    const res: any = (this.book.ask as any)({ from: r.uid, to: targets, type, now, check, silent: (a: string, b: string) => !!(this.roam.get(b)?.blocked.has(a) || this.roam.get(a)?.blocked.has(b)), route, meta: { how } });
    if (!res.ok) return this.say(p, res.why ?? 'Not now.');
    const view = route ? routeView(route) : null;
    this.sendTo(p, { t: 'challenge-sent', id: res.id, to: targets, type, route: view, how });
    if (!res.id) return;
    for (const u of targets) { const q = this.playerOf(u); if (q) this.sendTo(q, { t: 'challenge-invite', id: res.id, from: r.uid, name: nameFor(u, r, this.relOf(u)), type, route: view, answerSec: ROAM.challenges.answerSec, group: targets.length > 1 }); }
  }
  closed(inv: any) {
    const from = this.playerOf(inv.from);
    if (inv.state !== 'accepted') { if (from) this.sendTo(from, { t: 'challenge-declined', id: inv.id, why: inv.state }); return; }
    const racers = [inv.from, ...inv.accepted].filter(u => this.playerOf(u) && !this.roam.get(u)?.challenge);
    if (racers.length < 2) { if (from) this.sendTo(from, { t: 'challenge-declined', id: inv.id, why: 'gone' }); return; }
    const run = createChallengeRun({ cfg: ROAM, id: `rc_${this.roomId}_${inv.id}`, type: inv.type, racers, route: inv.route, now: this.roomNow(), leader: inv.from });
    run.region = this.region;
    this.runs.set(run.id, run);
    rtEnv.log('rt roam challenge', { id: run.id, racers, zone: this.zone });
    roamCounters.challenges++;
    for (const u of racers) { const x = this.roam.get(u); if (x) x.challenge = run.id; }
    this.pushTouch();
    const view = inv.route ? routeView(inv.route) : null;
    for (const u of racers) { const q = this.playerOf(u); if (q) this.sendTo(q, { t: 'challenge-start', id: run.id, type: inv.type, racers: racers.map(x => ({ uid: x, name: this.roam.get(x)?.name })), leader: inv.from, route: view, checkpoints: run.checkpoints, goAt: run.goAt, rolling: ROAM.challenges.rolling, roomId: this.roomId }); }
  }
  async finishRun(run: any) {
    rtEnv.log('rt roam challenge over', { id: run.id, results: run.results() });
    for (const u of run.racers) { const x = this.roam.get(u); if (x && x.challenge === run.id) x.challenge = null; }
    this.pushTouch();
    const results = run.results();
    let paid: any = null;
    if (results.some((x: any) => x.status === 'finished')) {
      try { paid = rtEnv.api?.roamChallenge ? await rtEnv.api.roamChallenge({ ...run.record(), region: run.region }) : null; }
      catch (e: any) { rtEnv.log('rt roam challenge record failed', { err: e?.message }); }
    }
    for (const u of run.racers) { const q = this.playerOf(u); if (q) this.sendTo(q, { t: 'challenge-results', id: run.id, type: run.type, results: results.map((x: any) => ({ ...x, name: this.roam.get(x.uid)?.name ?? null })), verdict: paid?.verdict ?? null, pay: paid?.pay?.[u] ?? null }); }
  }

  // ---------- reports ----------
  async report(p: Player, r: Roam, target: string, details: string) {
    const now = Date.now();
    r.reports = r.reports.filter(x => x > now - 3600e3);
    if (r.reports.length >= ROAM.reports.perHour) return this.say(p, 'You\'ve sent a lot of reports this hour: thanks — the admins are on it.');
    const o = this.roam.get(target);
    if (!o || target === r.uid) return this.say(p, 'That player isn\'t here.');
    if (!rtEnv.api) return this.say(p, 'Reports aren\'t available right now.');
    r.reports.push(now);
    roamCounters.reports++;
    // the last replaySec of both cars as this zone kept them (the admin page's contact replay draws them)
    const since = this.roomNow() - ROAM.reports.replaySec * 1000, slice = (x: Roam) => x.trail.filter(s => s[0] >= since).map(s => ({ t: s[0], pos: [s[1], s[2], s[3]], yaw: s[4], vel: [s[5], 0, s[6]] }));
    const id = `ev-roam-${target}-${r.uid}-${Math.round(this.roomNow())}`.slice(0, 80);
    try {
      await rtEnv.api.saveEvidence({ id, raceId: null, kind: 'roam', fault: target, victim: r.uid, data: { cars: { [target]: slice(o), [r.uid]: slice(r) }, hits: [], boxes: { [target]: o.car.box, [r.uid]: r.car.box }, names: { [target]: o.name, [r.uid]: r.name }, zone: `${this.region}:${this.zone}` } });
      await rtEnv.api.act(r.uid, { action: 'report', id: target, kind: 'behaviour', details: details.trim().length >= 5 ? details : 'Reported in free roam (the replay is attached).', ref: { evidenceId: id, roomId: this.roomId } });
      this.say(p, 'Reported, with the last few seconds of both cars: thanks — an admin will look at it.');
    } catch (e: any) { this.say(p, e?.message ?? 'The report didn\'t go: try again.'); }
  }

  // ---------- meets ----------
  async park(p: Player, r: Roam, meet: any) {
    if (!meet || typeof meet.id !== 'string' || ![meet.x, meet.z].every(Number.isFinite)) return;
    const at = p.latestF?.pos;
    if (!at || Math.hypot(at[0] - meet.x, at[2] - meet.z) > ROAM.meets.radiusM) return this.say(p, 'Drive to the meet first.');
    const spots = meetSpots({ x: Number(meet.x), z: Number(meet.z), heading: Number(meet.heading) || 0, spots: Number(meet.spots) || undefined }, ROAM);
    const taken = this.meets.get(meet.id) ?? new Map<number, string>();
    this.meets.set(meet.id, taken);
    if (r.meet) taken.delete(r.meet.spot);
    const spot = nearestFreeSpot(spots, new Set(taken.keys()), at[0], at[2]);
    if (!spot) return this.say(p, 'Every spot at this meet is taken.');
    taken.set(spot.n, r.uid);
    r.meet = { id: meet.id, spot: spot.n };
    this.sendTo(p, { t: 'meet-spot', meet: meet.id, spot });
  }

  // (players: connections here; homes: the players whose home zone this is — each player is home in one zone: the distinct count)
  summaryRoam() { return { region: this.region, zone: this.zone, group: this.group, ...this.summary(), homes: [...this.roam.values()].filter(r => r.home).length, challenges: this.runs.size }; }
}

// a route as the game shows it: its line every ~20 m (x, z), its length, where it ends, the roads' names
export function routeView(route: any) {
  const line = route.line, step = Math.max(1, Math.round(20 / 4)), pts: number[][] = [];
  for (let k = 0; k < line.length; k += step) pts.push([Math.round(line[k].x * 10) / 10, Math.round(line[k].z * 10) / 10]);
  const last = line.at(-1); pts.push([Math.round(last.x * 10) / 10, Math.round(last.z * 10) / 10]);
  return { line: pts, length: Math.round(route.length), dest: route.dest.map((v: number) => Math.round(v * 10) / 10), names: route.names ?? [] };
}
async function clearStatusIfOurs(uid: string, roomId: string) {
  try { const v = await matchMaker.presence.hget('rt:status', uid); const s = v ? JSON.parse(String(v)) : null; if (s?.roam?.roomId === roomId) await clearStatus(uid); } catch { /* fine */ }
}

// (an auto-ghost decided in any process: every zone room here obeys it)
let ghostsOn = false;
export function subscribeRoamGhosts() {
  if (ghostsOn) return;
  ghostsOn = true;
  void matchMaker.presence.subscribe('rt:roam:ghost', (m: any) => { for (const room of RoamRoom.live) room.ghostEverywhere(m?.uid, Number(m?.until) || 0); });
}
export const resetRoamGhosts = () => { ghostsOn = false; };
export { zoneOf, zoneSize };

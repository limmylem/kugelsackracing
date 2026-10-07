// The hub (Phase 7 Step 2; docs/MULTIPLAYER.md "Friends, invites and parties"): where a player is while they're on the
// multiplayer screens (and, quietly, while they drive about): their friends' status (online, in a lobby, racing —
// and where), invites to a lobby or a party, joining a friend's lobby or watching their race, the lobby browser and
// joining by invite code. One room in each process (joinOrCreate 'hub'); a player's messages reach them in whichever
// process they're in (presence: Redis, or memory in one process).
//
//   messages: status { state: 'menu' | 'free roam' } · invite { to, roomId } · join-friend { uid } · lobbies ·
//   code { code } · party-create · party-invite { to } · party-join { partyId } · party-leave · party-queue { pings } ·
//   friends (ask again: after a friend was added)
//   sent: hello { friends, party } · friends { list } · invite { from, name, roomId, kind, code, lobby } ·
//   party-invite { partyId, from, name } · party { party } · party-queue { partyId } · lobbies { list } ·
//   goto { roomId, spectate } · notice { text }

import { Room, matchMaker, type Client } from '@colyseus/core';
import { authorize, rtEnv } from './room.ts';
import { setStatus, clearStatus, statuses, toUser, onUser, roomOfCode, getParty, putParty, dropParty } from './mp.ts';
import { MP } from './mpData.ts';

type Member = { client: Client; uid: string; name: string; friends: { id: string; name: string }[]; blocked: Set<string>; off: () => void; state: string; last: string; party: string | null };

export class HubRoom extends Room {
  maxClients = 10000;
  autoDispose = true;
  members = new Map<string, Member>();

  static async onAuth(token: string, options: any) { return authorize(token, options, { count: false }); }
  onCreate() {
    this.onMessage('mp', (c, m) => { void this.onMp(c, m).catch(e => rtEnv.log('rt hub message failed', { err: e?.message })); });
    this.clock.setInterval(() => void this.refresh(), 3000);
  }
  async onJoin(client: Client, options: any) {
    const t: any = client.auth;
    let rel = { friends: [] as any[], blocked: [] as string[], blockedBy: [] as string[] };
    try { if (rtEnv.api) rel = await rtEnv.api.relations(t.uid); } catch { /* none, for now */ }
    const m: Member = { client, uid: t.uid, name: t.name, friends: rel.friends, blocked: new Set([...rel.blocked, ...rel.blockedBy, ...(t.mp?.blocked ?? [])]), off: () => {}, state: options?.state === 'free roam' ? 'free roam' : 'menu', last: '', party: null };
    // (a message for this player, from anywhere: an invite, their party)
    m.off = onUser(t.uid, msg => { if (msg?.from && m.blocked.has(msg.from)) return; if (msg?.t === 'party') m.party = msg.party?.id ?? null; client.send('mp', msg); });
    this.members.set(client.sessionId, m);
    await setStatus(t.uid, { state: m.state }).catch(() => {});
    client.send('mp', { t: 'hello', friends: await this.friendList(m), party: null });
  }
  async onLeave(client: Client) {
    const m = this.members.get(client.sessionId);
    this.members.delete(client.sessionId);
    if (!m) return;
    m.off();
    if (m.party) await this.leaveParty(m).catch(() => {});
    // (still in a race or lobby: that room says where they are; otherwise, offline)
    const st = (await statuses([m.uid]).catch(() => ({} as any)))[m.uid];
    if (!st || ['menu', 'free roam', 'queue'].includes(st.state)) await clearStatus(m.uid).catch(() => {});
  }

  async friendList(m: Member) {
    const st = await statuses(m.friends.map(f => f.id)).catch(() => ({} as any));
    return m.friends.map(f => ({ id: f.id, name: f.name, online: !!st[f.id], state: st[f.id]?.state ?? 'offline', roomId: st[f.id]?.roomId ?? null, kind: st[f.id]?.kind ?? null, venue: st[f.id]?.name ?? null }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }
  // every few seconds: each member's friends' status (sent when it changed), and their own kept fresh
  async refresh() {
    for (const m of this.members.values()) {
      if (['menu', 'free roam'].includes(m.state)) {
        const st = (await statuses([m.uid]).catch(() => ({} as any)))[m.uid];
        if (!st || ['menu', 'free roam'].includes(st.state)) await setStatus(m.uid, { state: m.state }).catch(() => {});
      }
      const list = await this.friendList(m), key = JSON.stringify(list);
      if (key !== m.last) { m.last = key; m.client.send('mp', { t: 'friends', list }); }
    }
  }

  async onMp(c: Client, msg: any) {
    const m = this.members.get(c.sessionId);
    if (!m || !msg || typeof msg.t !== 'string') return;
    const say = (text: string) => c.send('mp', { t: 'notice', text });
    const isFriend = (uid: string) => m.friends.some(f => f.id === uid) && !m.blocked.has(uid);
    switch (msg.t) {
      case 'status': m.state = msg.state === 'free roam' ? 'free roam' : 'menu'; await setStatus(m.uid, { state: m.state }); return;
      case 'friends': {
        try { if (rtEnv.api) { const rel = await rtEnv.api.relations(m.uid); m.friends = rel.friends; m.blocked = new Set([...rel.blocked, ...rel.blockedBy]); } } catch { /* as was */ }
        m.last = ''; return this.refresh();
      }
      case 'invite': {
        if (!isFriend(msg.to)) return say('You can invite your friends.');
        const meta = await this.roomMeta(msg.roomId);
        if (!meta) return say('That lobby has closed.');
        const code = (await statuses([m.uid]))[m.uid]?.code ?? null;
        await toUser(msg.to, { t: 'invite', from: m.uid, name: m.name, roomId: msg.roomId, kind: meta.kind, code, lobby: meta.name, venue: meta.venue });
        return say(`Invite sent to ${m.friends.find(f => f.id === msg.to)?.name}.`);
      }
      case 'join-friend': {
        if (!isFriend(msg.uid)) return say('You can join your friends.');
        const st = (await statuses([msg.uid]))[msg.uid];
        if (!st?.roomId) return say('They aren\'t in a lobby or race right now.');
        // (a private lobby: friends get in — their friend's in it; a race under way: watch it)
        return c.send('mp', { t: 'goto', roomId: st.roomId, spectate: st.state === 'racing' || st.state === 'spectating' });
      }
      case 'lobbies': {
        const rooms = await matchMaker.query({ name: 'race' });
        const list = rooms.filter((r: any) => r.metadata?.listed && !r.locked).map((r: any) => ({ roomId: r.roomId, ...r.metadata, clients: r.clients }))
          .sort((a: any, b: any) => Number(a.phase !== 'lobby') - Number(b.phase !== 'lobby') || b.players - a.players).slice(0, 50);
        return c.send('mp', { t: 'lobbies', list });
      }
      case 'code': {
        const roomId = await roomOfCode(msg.code);
        if (!roomId || !(await this.roomMeta(roomId))) return say('There\'s no lobby with that code (it may have closed).');
        return c.send('mp', { t: 'goto', roomId, spectate: false });
      }
      case 'party-create': {
        if (m.party) await this.leaveParty(m);
        const party = { id: `p${Math.random().toString(36).slice(2, 10)}`, leader: m.uid, members: [m.uid], names: { [m.uid]: m.name } };
        await putParty(party); m.party = party.id;
        return c.send('mp', { t: 'party', party });
      }
      case 'party-invite': {
        if (!m.party) return say('Make a party first.');
        if (!isFriend(msg.to)) return say('You can invite your friends.');
        await toUser(msg.to, { t: 'party-invite', partyId: m.party, from: m.uid, name: m.name });
        return say('Party invite sent.');
      }
      case 'party-join': {
        const party = await getParty(String(msg.partyId ?? ''));
        if (!party) return say('That party has broken up.');
        if (m.blocked.has(party.leader)) return;
        if (party.members.length >= MP.queue.maxPartySize) return say('That party is full.');
        if (m.party && m.party !== party.id) await this.leaveParty(m);
        if (!party.members.includes(m.uid)) { party.members.push(m.uid); party.names[m.uid] = m.name; }
        await putParty(party); m.party = party.id;
        for (const u of party.members) await toUser(u, { t: 'party', party });
        return;
      }
      case 'party-leave': if (m.party) await this.leaveParty(m); return c.send('mp', { t: 'party', party: null });
      case 'party-queue': {
        const party = m.party ? await getParty(m.party) : null;
        if (!party || party.leader !== m.uid) return say('Only the party\'s leader starts the queue.');
        for (const u of party.members) await toUser(u, { t: 'party-queue', partyId: party.id });
        return;
      }
    }
  }
  async leaveParty(m: Member) {
    const party = m.party ? await getParty(m.party) : null;
    m.party = null;
    if (!party) return;
    party.members = party.members.filter((u: string) => u !== m.uid);
    delete party.names[m.uid];
    if (!party.members.length) return dropParty(party.id);
    if (party.leader === m.uid) party.leader = party.members[0];
    await putParty(party);
    for (const u of party.members) await toUser(u, { t: 'party', party });
  }
  async roomMeta(roomId: string) {
    const rooms = await matchMaker.query({ roomId });
    return rooms[0]?.metadata ?? null;
  }
}

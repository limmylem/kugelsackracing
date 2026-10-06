// The player service the game uses with a server (Phase 6 Step 2): the server's (server/src/economy) is the
// only copy of money, cars, parts, builds, damage and XP. This asks it, with the same requests and answers
// as the local service (service.js METHODS), so the garage, the shop and the quests don't change.
//
// It feels as fast as before: each action is first worked out here with the game's own rules on the last
// profile the server sent (a local copy, only for showing), shown at once and marked pending, then sent;
// the server's answer is what counts — the change confirmed, or put back with the server's reason. Each
// action has its own Idempotency-Key, kept on every retry: sent twice (a dropped connection), done once.
// Offline, actions wait (paused, with a message) and go when the connection's back. Another tab or device's
// changes come in as they happen (the server's events), and a conflict is the server's to settle.
//
//   const P = new RemotePlayerService({ api, db, quests: { config }, onStatus })
//     onStatus({ pending, paused, error }) — the game's indicator
//   await P.init()   P.profile   P.on(fn)   P.buyPart(…) …   P.session (the run or drive damage belongs to)

import { METHODS, PlayerService, LocalPlayerService } from './service.js';
import { MemoryStorage } from './storage.js';
import { packProfile } from './profile.js';
import { apiBase } from '../../site/urls.js';

const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
// (what the server won't do for a player: these make money or items from nothing)
const SERVER_ONLY = { addMoney: 1, addXp: 1, setUnlimitedMoney: 1, givePart: 1, giveAllParts: 1, setCondition: 1, restoreCar: 1, setAttach: 1, resetHints: 1, resetProfile: 1, importSave: 1 };
// a damage report as the server takes it: what driving does (no dent lists replaced, nothing mended)
const report = ({ parts = {}, shell = null } = {}) => ({
  parts: Object.fromEntries(Object.entries(parts).map(([id, d]) => [id, Object.fromEntries(Object.entries(d).filter(([k, v]) => ['condition', 'hits', 'damage', 'attach'].includes(k) && v !== undefined))])),
  ...(shell ? { shell: Object.fromEntries(Object.entries(shell).filter(([k, v]) => ['condition', 'hits', 'broken'].includes(k) && v !== undefined)) } : {}),
});

export class RemotePlayerService extends PlayerService {
  constructor({ api, db, quests = null, onStatus = () => {}, heartbeatMs = 60_000 } = {}) {
    super();
    this.api = api; this.db = db; this.quests = quests; this.onStatus = onStatus; this.heartbeatMs = heartbeatMs;
    this.profile = null; this.notices = []; this.rev = 0; this.unlimited = false;
    this.queue = Promise.resolve(); this.pending = 0; this.paused = false;
    this.session = null; this.sessions = new Map();     // (attemptId → the server's session id)
  }
  status(extra = {}) { this.onStatus({ pending: this.pending, paused: this.paused, ...extra }); }

  async init() {
    const r = await this.api.get('/player');
    this.#adopt(r.profile, r.rev);
    this.notices = r.notices ?? [];
    this.#listen();
    this.beat = setInterval(() => { if (this.session) this.api.post(`/player/sessions/${this.session}/heartbeat`, {}, { retries: 0 }).catch(() => {}); }, this.heartbeatMs);
    return { ok: true, error: null, updatedState: clone(this.profile), notices: this.notices };
  }
  // offline from the start: the last profile the server sent, shown; actions wait for the server
  async initOffline(cached) {
    this.#adopt(cached, 0);
    await this.shadowReady;
    this.profile = (await this.shadow.getProfile()).updatedState;
    this.paused = true; this.status({ message: 'You\'re offline: your garage is as you last saw it, and changes wait for the server.' });
    const off = this.api.on(s => { if (s === 'online') { off(); this.paused = false; this.status(); this.refresh().then(() => this.#listen()); } });
    this.api.watch();
    return { ok: true, error: null, updatedState: clone(this.profile), notices: [] };
  }
  async getProfile() { return { ok: true, error: null, updatedState: clone(this.profile), notices: this.notices }; }
  // (the server's profile taken as it is; the local copy for showing what an action will do, from it)
  #adopt(profile, rev) {
    this.profile = profile; this.rev = rev ?? this.rev;
    this.shadow = new LocalPlayerService({ db: this.db, storage: new MemoryStorage(packProfile(profile)), quests: this.quests ? { config: this.quests.config } : null });
    this.shadowReady = this.shadow.init();
  }
  // another tab or device changed something: the server's profile again (once nothing of ours is on its way)
  #listen() {
    if (typeof EventSource === 'undefined') return;
    const es = this.events = new EventSource(`${apiBase}/api/v1/player/events`, { withCredentials: true });
    es.addEventListener('change', e => {
      const { rev } = JSON.parse(e.data);
      if (rev === -1 || rev > this.rev) this.queue = this.queue.then(() => this.refresh());
    });
  }
  async refresh() {
    if (this.pending) return;
    const r = await this.api.get('/player').catch(() => null);
    if (r && r.rev !== this.rev) { this.#adopt(r.profile, r.rev); this.emit({ what: 'sync', profile: this.profile }); }
  }

  // ---------- an action: shown at once, confirmed (or put back) by the server ----------
  async #do(what, action, args, predict = null) {
    // (worked out here first: the same rules — what they refuse, the server would too)
    let shown = null;
    if (predict) {
      await this.shadowReady;
      const local = await predict(this.shadow);
      if (!local.ok) return local;
      shown = local.updatedState;
      this.profile = shown;
      this.emit({ what, profile: this.profile, pending: true });
    }
    this.pending++; this.status();
    const key = uuid();
    const send = async () => {
      for (;;) {
        try { return await this.api.post(`/player/actions/${action}`, { args }, { key }); }
        catch (e) {
          // offline: paused until the connection's back, then the same request (the same key) again
          if (e.code === 'OFFLINE') { this.paused = true; this.status({ message: 'You\'re offline: your change will be sent when you\'re back.' }); await new Promise(r => { const off = this.api.on(s => { if (s === 'online') { off(); r(); } }); this.api.watch(); }); this.paused = false; this.status(); continue; }
          throw e;
        }
      }
    };
    const run = async () => {
      try {
        const r = await send();
        this.#adopt(r.updatedState, r.rev);
        this.emit({ what, profile: this.profile });
        return { ...r, ok: true };
      } catch (e) {
        // said no (or failed): the server's profile back, and its reason
        const theirs = e.details?.updatedState;
        if (theirs) this.#adopt(theirs, e.details.rev); else await this.refresh().catch(() => {});
        if (shown) this.emit({ what: 'rollback', profile: this.profile });
        this.status({ error: e.message });
        return { ok: false, error: e.message, updatedState: clone(this.profile), ...(e.details?.reasons ? { reasons: e.details.reasons } : {}) };
      } finally { this.pending--; this.status(); }
    };
    return (this.queue = this.queue.then(run, run));
  }

  // the run or drive this car's damage belongs to: a quest's, or a drive started for it
  async #sessionFor(carInstanceId) {
    if (this.session && this.sessionCar === carInstanceId) return this.session;
    const r = await this.api.post('/player/drives', { carInstanceId, mode: 'free' });
    this.session = r.sessionId; this.sessionCar = carInstanceId; this.sessionKind = 'drive';
    return this.session;
  }
  async endDrive() { if (this.sessionKind === 'drive' && this.session) { const s = this.session; this.session = null; await this.api.post(`/player/drives/${s}/end`, {}).catch(() => {}); } }

  // ---------- the garage, the shop, the workshop (shown at once) ----------
  buyPart(partId, opts = {}) { return this.#do('buy', 'buyPart', { partId, ...(opts.quantity ? { quantity: opts.quantity } : {}) }, S => S.buyPart(partId, opts)); }
  sellPart(instanceId) { return this.#do('sell', 'sellPart', { instanceId }, S => S.sellPart(instanceId)); }
  repairPart(instanceId) { return this.#do('repair', 'repairPart', { instanceId }, S => S.repairPart(instanceId)); }
  repairParts(instanceIds) { return this.#do('repair', 'repairParts', { instanceIds: [...new Set(instanceIds)] }, S => S.repairParts(instanceIds)); }
  repairBody(carInstanceId) { return this.#do('repair', 'repairBody', { carInstanceId }, S => S.repairBody(carInstanceId)); }
  repairCar(carInstanceId, opts = {}) { return this.#do('repair', 'repairCar', { carInstanceId, opts }, S => S.repairCar(carInstanceId, opts)); }
  replaceWithSpare(carInstanceId, socket, instanceId) { return this.#do('repair', 'replaceWithSpare', { carInstanceId, socket, instanceId }, S => S.replaceWithSpare(carInstanceId, socket, instanceId)); }
  basicRepair(carInstanceId) { return this.#do('repair', 'basicRepair', { carInstanceId }, S => S.basicRepair(carInstanceId)); }
  installPart(carInstanceId, instanceId, opts = {}) { return this.#do('install', 'installPart', { carInstanceId, instanceId, opts }, S => S.installPart(carInstanceId, instanceId, opts)); }
  removePart(carInstanceId, which, opts = {}) { return this.#do('remove', 'removePart', { carInstanceId, which, opts }, S => S.removePart(carInstanceId, which, opts)); }
  buyAndInstall(carInstanceId, partId, opts = {}) { return this.#do('buy', 'buyAndInstall', { carInstanceId, partId, opts }, S => S.buyAndInstall(carInstanceId, partId, opts)); }
  setBuild(carInstanceId, build = {}) { return this.#do('build', 'setBuild', { carInstanceId, build }, S => S.setBuild(carInstanceId, build)); }
  setTuning(instanceId, settings) { return this.#do('tune', 'setTuning', { instanceId, settings }, S => S.setTuning(instanceId, settings)); }
  setPaint(carInstanceId, paint) { return this.#do('paint', 'setPaint', { carInstanceId, paint: paint ?? null }, S => S.setPaint(carInstanceId, paint)); }
  setPartFinish(instanceIds, look) { return this.#do('paint', 'setPartFinish', { instanceIds, look: look ?? null }, S => S.setPartFinish(instanceIds, look)); }
  selectCar(carInstanceId) { return this.#do('car', 'selectCar', { carInstanceId }, S => S.selectCar(carInstanceId)).then(r => { if (r.ok) this.endDrive(); return r; }); }
  buyCar(carId) { return this.#do('car', 'buyCar', { carId }, S => S.buyCar(carId)); }
  sellParts(instanceIds) { const ids = [...new Set(instanceIds)]; return this.#do('sell', 'sellParts', { instanceIds: ids }, S => S.sellParts(ids)); }
  refundPart(instanceId) { return this.#do('refund', 'refundPart', { instanceId }, S => S.refundPart(instanceId)); }
  buyBundle(bundleId, opts = {}) { return this.#do('buy', 'buyBundle', { bundleId, opts: { ...(opts.carInstanceId ? { carInstanceId: opts.carInstanceId } : {}), ...(opts.install ? { install: true } : {}) } }, S => S.buyBundle(bundleId, opts)); }
  sellCar(carInstanceId, opts = {}) { return this.#do('car', 'sellCar', { carInstanceId, opts: { keep: opts.keep ?? [] } }, S => S.sellCar(carInstanceId, opts)); }
  buyUsedCar(listingId) { return this.#do('car', 'buyUsedCar', { listingId }, S => S.buyUsedCar(listingId)); }
  buyGarageSlot() { return this.#do('buy', 'buyGarageSlot', {}, S => S.buyGarageSlot()); }
  // today's used cars: the server's (the same for everyone today)
  async getUsedLot() {
    try { const r = await this.api.get('/player/used-lot', { retries: 1 }); return { ok: true, error: null, ...r }; }
    catch (e) { return { ok: false, error: e.message, listings: [] }; }
  }
  saveSetup(carInstanceId, opts = {}) { return this.#do('setup', 'saveSetup', { carInstanceId, opts }, S => S.saveSetup(carInstanceId, opts)); }
  renameSetup(carInstanceId, setupId, name) { return this.#do('setup', 'renameSetup', { carInstanceId, setupId, name }, S => S.renameSetup(carInstanceId, setupId, name)); }
  deleteSetup(carInstanceId, setupId) { return this.#do('setup', 'deleteSetup', { carInstanceId, setupId }, S => S.deleteSetup(carInstanceId, setupId)); }
  switchSetup(carInstanceId, setupId, opts = {}) { return this.#do('setup', 'switchSetup', { carInstanceId, setupId, opts }, S => S.switchSetup(carInstanceId, setupId, opts)); }
  markHint(id) { return this.#do('hint', 'markHint', { id }, S => S.markHint(id)); }
  favouriteTrack(track, on = true) { return this.#do('quest', 'favouriteTrack', { track: { code: track.code, kind: track.kind, name: track.name ?? null }, on }, S => S.favouriteTrack(track, on)); }

  // ---------- driving: damage, wear, a session's reset (shown at once; the server keeps what counts) ----------
  async damageCar(carInstanceId, rep = {}, { cause } = {}) {
    const sessionId = await this.#sessionFor(carInstanceId).catch(() => null);
    if (!sessionId) return { ok: false, error: 'Crash damage needs the game\'s server: not saved.', updatedState: clone(this.profile) };
    return this.#do('damage', 'damageCar', { sessionId, carInstanceId, report: report(rep), cause: cause ?? null }, S => S.damageCar(carInstanceId, rep, { cause }));
  }
  async wearPart(instanceId, condition, { cause } = {}) {
    const car = this.profile.parts[instanceId]?.installedOn?.car ?? this.profile.currentCar, sessionId = await this.#sessionFor(car).catch(() => null);
    if (!sessionId) return { ok: false, error: 'Wear needs the game\'s server: not saved.', updatedState: clone(this.profile) };
    return this.#do('wear', 'wearPart', { sessionId, instanceId, condition, cause: cause ?? null }, S => S.wearPart(instanceId, condition, { cause }));
  }
  async sessionReset(carInstanceId, opts = {}) {
    const sessionId = await this.#sessionFor(carInstanceId).catch(() => null);
    if (!sessionId) return { ok: false, error: 'No session.', updatedState: clone(this.profile) };
    return this.#do('reset', 'sessionReset', { sessionId }, S => S.sessionReset(carInstanceId, opts));
  }

  // ---------- quests and track events: the server's session ----------
  async startQuest(quest, { carInstanceId, restart = false } = {}) {
    const r = await this.#do('quest', 'startQuest', { questId: quest.id, ...(quest.track?.code ? { trackCode: quest.track.code } : {}), ...(carInstanceId ? { carInstanceId } : {}), restart: !!restart });
    if (r.ok) { this.sessions.set(r.attemptId, r.sessionId); this.session = r.sessionId; this.sessionCar = carInstanceId ?? this.profile.currentCar; this.sessionKind = 'quest'; }
    return r;
  }
  #ended(attemptId) { if (this.session === this.sessions.get(attemptId)) { this.session = null; this.sessionKind = null; } this.sessions.delete(attemptId); }
  async refundQuest(attemptId) { const r = await this.#do('quest', 'refundQuest', { sessionId: this.sessions.get(attemptId) ?? '' }); this.#ended(attemptId); return r; }
  async finishQuest(result, { recording = null } = {}) {
    const r = await this.#do('quest', 'finishQuest', { sessionId: this.sessions.get(result.attemptId) ?? '', result, ...(recording ? { recording } : {}) });
    this.#ended(result.attemptId);
    return r;
  }
  async failQuest(attemptId, { status = 'dnf', reason = null } = {}) {
    const r = await this.#do('quest', 'failQuest', { sessionId: this.sessions.get(attemptId) ?? '', status: String(status).toLowerCase().replace(/[^a-z_]/g, '_').slice(0, 24), reason: reason ? String(reason).slice(0, 80) : null });
    this.#ended(attemptId);
    return r;
  }
  awardCar(_carId, { attemptId, result } = {}) { return this.#do('car', 'awardCar', { sessionId: this.sessions.get(attemptId) ?? '', result }); }
  forfeitCar(carInstanceId, { attemptId } = {}) { return this.#do('car', 'forfeitCar', { sessionId: this.sessions.get(attemptId) ?? '', carInstanceId }); }
  async getRecording(recordingId) {
    try { const r = await this.api.get(`/player/recordings/${encodeURIComponent(recordingId)}`); return { ok: true, error: null, updatedState: clone(this.profile), recording: r.recording }; }
    catch (e) { return { ok: false, error: e.message, updatedState: clone(this.profile), recording: null }; }
  }
  async save() { return { ok: true, error: null, updatedState: clone(this.profile) }; }
  async exportSave() { return { ok: true, error: null, updatedState: clone(this.profile), json: JSON.stringify(this.profile, null, 1) }; }
  dispose() { this.events?.close(); clearInterval(this.beat); }
}
for (const name of Object.keys(SERVER_ONLY)) RemotePlayerService.prototype[name] = async function () {
  return { ok: false, error: name === 'importSave' ? 'Your progress is kept by the game\'s server now: a save file can\'t be loaded in its place.' : 'That\'s a development command: the server keeps the money and items now (an admin can put things right on the admin page).', updatedState: clone(this.profile) };
};
for (const name of Object.keys(METHODS)) if (!(name in RemotePlayerService.prototype)) RemotePlayerService.prototype[name] = async function () { return { ok: false, error: `"${name}" isn't available with the game's server.`, updatedState: clone(this.profile) }; };

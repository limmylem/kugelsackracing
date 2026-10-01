// The player service asked of the game's server instead of this browser (not used yet: for when there
// is a server). Same requests, same answers (service.js METHODS: each → { ok, error, updatedState, … }),
// so the garage, inventory and shop don't change. The server does the checking and the saving; this
// only carries the requests and tells listeners about changes.
//
//   new RemotePlayerService({ url: 'https://game.example/api', token })   // token: the signed-in player
//   POST {url}/player/{method}  body { args: [...] }  →  { ok, error, updatedState, … }

import { METHODS, PlayerService } from './service.js';

export class RemotePlayerService extends PlayerService {
  constructor({ url, token = null, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    super();
    this.url = url.replace(/\/$/, ''); this.token = token; this.fetch = fetchImpl; this.profile = null; this.notices = [];
  }
  async init() { const r = await this.ask('getProfile', []); this.notices = r.notices ?? []; return r; }
  async ask(method, args) {
    let answer;
    try {
      const res = await this.fetch(`${this.url}/player/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: JSON.stringify({ args }),
      });
      answer = await res.json();
    } catch (err) {
      return { ok: false, error: `Couldn't reach the game's server (${err.message ?? err}).`, updatedState: this.profile };
    }
    if (answer.ok && answer.updatedState) {
      this.profile = answer.updatedState;
      if (method !== 'getProfile' && method !== 'exportSave') this.emit({ what: method, profile: this.profile });
    }
    return answer;
  }
}
for (const name of Object.keys(METHODS)) RemotePlayerService.prototype[name] = function (...args) { return this.ask(name, args); };

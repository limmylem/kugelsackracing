// The bot check on the account forms (Phase 6 Step 5, docs/ABUSE.md): Cloudflare Turnstile, when the server has it
// on (client-config's botCheck.siteKey). Its widget goes in the form (most people see a tick and nothing to do);
// its one-use answer goes with the sign-up, sign-in or guest request as a header. Off: nothing shown, no header.
//
//   const bot = createBotCheck(cfg)    form gets bot.el      await bot.headers() → { 'x-bot-check': token } | {}
//   bot.reset() after a refused attempt (each answer works once)

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading = null;
const load = () => loading ??= new Promise((resolve, reject) => {
  if (globalThis.turnstile) return resolve(globalThis.turnstile);
  const s = document.createElement('script');
  s.src = SCRIPT; s.async = true;
  s.onload = () => resolve(globalThis.turnstile);
  s.onerror = () => { loading = null; reject(new Error('The check that you\'re not a bot couldn\'t load: check your connection, or turn off a blocker for this page.')); };
  document.head.append(s);
});

export function createBotCheck(cfg) {
  const siteKey = cfg?.botCheck?.siteKey;
  const el = document.createElement('div');
  if (!siteKey) return { el, headers: async () => ({}), reset() {} };
  el.className = 'bot-check';
  let id = null, token = null, waiting = [];
  load().then(t => {
    id = t.render(el, {
      sitekey: siteKey, theme: 'dark', action: 'account', 'refresh-expired': 'auto',
      callback: v => { token = v; for (const w of waiting) w(v); waiting = []; },
      'expired-callback': () => { token = null; },
      'error-callback': () => { token = null; },
    });
  }).catch(e => { el.textContent = e.message; });
  return {
    el,
    // (waits a little for the widget if it's still deciding)
    async headers() {
      if (!token) token = await Promise.race([new Promise(r => waiting.push(r)), new Promise(r => setTimeout(() => r(null), 15000))]);
      if (!token) throw new Error('The check that you\'re not a bot hasn\'t finished: wait a moment, or tick it, then try again.');
      const t = token; token = null;
      return { 'x-bot-check': t };
    },
    reset() { token = null; try { if (id != null) globalThis.turnstile?.reset(id); } catch { /* gone */ } },
  };
}

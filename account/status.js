// The account and connection chip in the game's corner (Phase 6 Step 1): who's playing, and whether the
// server answers — green online, amber while it wakes up or reconnects (it keeps trying by itself), red
// offline (free roam only: quests, events and rewards wait for the server). Clicking it opens the account
// page. Signed out on a page with a server: a welcome, once a visit — sign in, make an account, or play as a
// guest (the progress comes along if they make an account later).
//
//   mountAccountChip(A, { parent })   (A: account/session.js)

const CSS = `
#krAccount{position:fixed;left:12px;bottom:12px;z-index:70;display:flex;align-items:center;gap:8px;font:600 12px/1 Barlow,system-ui,sans-serif;color:#e9ecef;background:rgba(10,14,20,.82);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:6px 11px 6px 9px;cursor:pointer;user-select:none}
#krAccount:hover{background:rgba(20,26,34,.92)}
#krAccount i{width:9px;height:9px;border-radius:50%;background:#3dd68c;box-shadow:0 0 0 3px rgba(61,214,140,.18);flex:none}
#krAccount.waking i,#krAccount.retrying i{background:#f2c037;box-shadow:0 0 0 3px rgba(242,192,55,.2);animation:krPulse 1s ease-in-out infinite alternate}
#krAccount.offline i{background:#ff5a5f;box-shadow:0 0 0 3px rgba(255,90,95,.2)}
#krAccount small{opacity:.65;font-weight:500}
@keyframes krPulse{to{opacity:.35}}
#krToast{position:fixed;left:12px;bottom:52px;z-index:71;max-width:min(360px,calc(100vw - 24px));font:600 13px/1.35 Barlow,system-ui,sans-serif;color:#ffd9da;background:rgba(40,12,14,.94);border:1px solid rgba(255,90,95,.45);border-radius:10px;padding:8px 12px;display:none}
#krToast.on{display:block}
#krToast.info{color:#e9ecef;background:rgba(10,14,20,.9);border-color:rgba(255,255,255,.14)}
#krWelcome{position:fixed;inset:0;z-index:95;display:flex;align-items:center;justify-content:center;background:rgba(4,6,9,.6)}
#krWelcome>div{width:min(420px,calc(100vw - 32px));background:#0e1114;border:1px solid #333c46;border-radius:12px;padding:22px 22px 18px;color:#e9ecef;font:500 15px/1.45 Barlow,system-ui,sans-serif;box-shadow:0 24px 80px rgba(0,0,0,.6)}
#krWelcome h2{margin:0 0 6px;font:600 26px 'Barlow Condensed',Barlow,sans-serif}
#krWelcome p{margin:0 0 16px;color:#a3abb5;font-size:14px}
#krWelcome a,#krWelcome button{display:block;width:100%;box-sizing:border-box;text-align:center;margin-top:8px;padding:11px;border-radius:6px;font:600 16px 'Barlow Condensed',Barlow,sans-serif;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;cursor:pointer;border:1px solid #333c46;background:#1b2127;color:#e9ecef}
#krWelcome .primary{background:#36b3f5;border-color:#36b3f5;color:#04121b}
#krWelcome .ghost{background:none;border:0;color:#a3abb5;font-size:14px}
#krWelcome .err{color:#ff7a7e;font-size:13px;margin-top:8px}
#krNotice{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:96;max-width:min(560px,calc(100vw - 24px));display:flex;gap:12px;align-items:center;font:600 14px/1.35 Barlow,system-ui,sans-serif;color:#1a1405;background:#f2c037;border-radius:10px;padding:10px 14px;box-shadow:0 8px 30px rgba(0,0,0,.45)}
#krNotice button{font:700 13px Barlow,system-ui,sans-serif;border:0;border-radius:6px;padding:7px 12px;background:#1a1405;color:#f2c037;cursor:pointer;flex:none}`;

const TEXT = { online: '', waking: 'Waking the server…', retrying: 'Reconnecting…', offline: 'Offline · free roam only' };

export function mountAccountChip(A, { parent = document.body, welcome = true } = {}) {
  if (!A.server) return null;
  if (!document.getElementById('krAccountCss')) { const s = document.createElement('style'); s.id = 'krAccountCss'; s.textContent = CSS; document.head.appendChild(s); }
  const chip = document.createElement('div');
  chip.id = 'krAccount'; chip.setAttribute('role', 'button'); chip.tabIndex = 0;
  const dot = document.createElement('i'), label = document.createElement('span'), sub = document.createElement('small');
  chip.append(dot, label, sub);
  parent.appendChild(chip);
  // (Phase 6 Step 5: the server's notices — down for maintenance, or this game too old for it — as a banner at the top;
  // account/api.js raises them from any answer, and the status is asked once as the game starts)
  const notice = (code, message, details) => {
    let el = document.getElementById('krNotice');
    if (!el) { el = document.createElement('div'); el.id = 'krNotice'; el.setAttribute('role', 'alert'); document.body.appendChild(el); }
    const text = document.createElement('span');
    text.textContent = code === 'CLIENT_TOO_OLD' ? (message || 'The game has been updated: refresh the page.') : `${message || 'The game is down for maintenance.'}${details?.until ? ` Back at ${details.until}.` : ''}`;
    const btn = document.createElement('button');
    btn.textContent = code === 'CLIENT_TOO_OLD' ? 'Refresh' : 'Hide';
    btn.onclick = () => code === 'CLIENT_TOO_OLD' ? location.reload() : el.remove();
    el.replaceChildren(text, btn);
  };
  addEventListener('kr-server-notice', e => notice(e.detail.code, e.detail.message, e.detail.details));
  A.api.get('/status', { retries: 0 }).then(s => { if (s?.maintenance?.on) notice('MAINTENANCE', s.maintenance.message, s.maintenance); }).catch(() => {});
  const next = encodeURIComponent(location.pathname + location.search);
  const open = () => { location.href = `/account/?next=${next}`; };
  chip.onclick = open;
  chip.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') open(); };
  const draw = () => {
    const st = A.state;
    chip.className = st;
    label.textContent = A.me ? A.me.displayName : A.online ? 'Sign in' : 'Not signed in';
    sub.textContent = TEXT[st] || (A.me?.isGuest ? 'guest' : A.me?.needsTerms ? 'accept the terms' : '');
    chip.title = st === 'offline' ? 'The game\'s server can\'t be reached: free roam works; quests, events and rewards wait for it. It keeps trying.' : 'Your account';
  };
  A.on(draw); draw();

  // the economy's changes on their way (Phase 6 Step 2: garage/player/remote.js): "saving…", paused while
  // offline, and a refusal in plain words (what was shown has been put back)
  const toast = document.createElement('div'); toast.id = 'krToast'; toast.setAttribute('role', 'status'); parent.appendChild(toast);
  let hide = null, eco = { pending: 0, paused: false };
  const say = (text, kind = 'error', ms = 6000) => { toast.textContent = text; toast.className = `on ${kind === 'info' ? 'info' : ''}`; clearTimeout(hide); if (ms) hide = setTimeout(() => { toast.className = ''; }, ms); };
  addEventListener('kr-economy', e => {
    const d = e.detail ?? {};
    eco = { pending: d.pending ?? 0, paused: !!d.paused };
    if (d.error) say(`${d.error}${/[.!?]$/.test(d.error) ? '' : '.'} (Put back as it was.)`);
    else if (d.message) say(d.message, 'info', d.paused ? 0 : 5000);
    else if (!d.paused && toast.className.includes('info') && /offline/i.test(toast.textContent)) toast.className = '';
    sub.textContent = eco.paused ? 'changes paused (offline)' : eco.pending ? 'saving…' : (TEXT[A.state] || (A.me?.isGuest ? 'guest' : ''));
  });

  // a welcome, once a visit, for someone not signed in
  let seen = false;
  try { seen = sessionStorage.getItem('kr.welcomed') === '1'; } catch { /* show it */ }
  if (welcome && !A.me && A.online && !seen) {
    try { sessionStorage.setItem('kr.welcomed', '1'); } catch { /* fine */ }
    const box = document.createElement('div');
    box.id = 'krWelcome';
    box.innerHTML = `<div><h2>Kugelsack Racing</h2><p>Sign in to keep your progress on any device, or play as a guest — make an account later and your progress comes with you.</p>
      <a class="primary" data-k="in">Sign in</a><a data-k="up">Create an account</a><button data-k="guest">Play as a guest</button><button class="ghost" data-k="later">Just drive (free roam)</button><div class="err" hidden></div></div>`;
    const err = box.querySelector('.err');
    box.querySelector('[data-k=in]').href = `/account/?next=${next}`;
    box.querySelector('[data-k=up]').href = `/account/?mode=sign-up&next=${next}`;
    box.onclick = async e => {
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (k === 'later' || e.target === box) box.remove();
      if (k === 'guest') {
        // (on the account page: the bot check, when it's on, is there — Phase 6 Step 5)
        location.href = `/account/?mode=guest&next=${next}`;
      }
    };
    document.body.appendChild(box);
  }
  return { chip, draw };
}

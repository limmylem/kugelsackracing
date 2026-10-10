// The account page (Phase 6 Step 1). Signed out: sign in (email and password, Google, Discord), make an
// account (a display name checked as it's typed, the terms and privacy policy, the minimum age), play as a
// guest, a forgotten password (an emailed link, then a new password here). Signed in: the terms if they're
// still to accept, the display name (changed at most once a month), a guest making their account (their
// progress comes with them), signing out here or everywhere, a copy of their data, deleting the account.
// The server does all the checking (Better Auth, server/src/routes/me.ts); what anyone typed is shown as text.
//
//   /account/?next=/somewhere   back there afterwards (only this site's own pages)
//   ?mode=sign-up | terms | reset (&token, from the reset email) | mfa (an editor's or admin's tools: two-factor
//   sign-in to turn on, or its code again) · ?verified=1 (from the verification email)
// Two-factor sign-in (Phase 6 Step 5): an authenticator app's code after the password (any account can turn it on;
// editors and admins must).

import { createApi, ApiError } from './api.js';
import { createBotCheck } from './botCheck.js';
import { clientInfo, describe } from './clientInfo.js';
import { SITE } from '../site/urls.js';

const api = createApi();
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
// (only this site's pages: never off to somewhere a link names — and, with the API on its own address, its admin
// page, which sends you here to sign in first)
const TOOL_PAGES = SITE.api ? [`${SITE.api}/admin/`] : [];
const safeNext = n => typeof n === 'string' && ((/^\/(?![/\\])/.test(n) && !n.startsWith('/api/')) || TOOL_PAGES.includes(n)) ? n : '/';
const next = safeNext(q.get('next'));
$('back').href = next;
// (whole addresses: the server, maybe on another address, sends the browser back here after an email link or
// a sign-in elsewhere)
const here = (mode, extra = {}) => `${location.origin}/account/?${new URLSearchParams({ ...(mode ? { mode } : {}), next, ...extra })}`;
const nextUrl = next.startsWith('/') ? `${location.origin}${next}` : next;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const say = (text, good = false) => { $('msg').replaceChildren(text ? h('div', { class: `msg ${good ? 'good' : 'bad'}`, role: 'status' }, text) : ''); };
const show = (...sections) => { $('view').replaceChildren(...sections); };
const field = (label, attrs, hint = null) => { const i = h('input', attrs); return { el: h('label', {}, label, i, hint), input: i }; };
// a form: its button busy while the request runs, the server's words if it says no
const form = (els, label, run, { primary = true } = {}) => {
  const btn = h('button', { class: `btn ${primary ? 'primary' : 'secondary'}`, type: 'submit' }, label);
  const f = h('form', { class: 'list', style: 'display:flex;flex-direction:column;gap:12px' }, ...els, btn);
  f.onsubmit = async e => {
    e.preventDefault(); say(''); btn.disabled = true;
    try { await run(); } catch (err) { say(err instanceof ApiError ? err.message : String(err?.message ?? err)); } finally { btn.disabled = false; }
  };
  return f;
};
const birthField = () => field('Date of birth', { type: 'date', required: true, max: new Date().toISOString().slice(0, 10), autocomplete: 'bday' }, h('span', { class: 'hint muted' }, 'Only to check your age: it isn\'t kept.'));

let cfg = { social: [], termsVersion: '', privacyVersion: '', minAge: 13 }, me = null;

async function start() {
  try { cfg = await api.get('/client-config'); } catch (e) { say(`The game's server can't be reached (${e.message}). Free roam still works: go back to the game.`); show(); return; }
  try { me = (await api.get('/me')).user; } catch (e) { if (e.code !== 'UNAUTHENTICATED' && e.code !== 'BANNED') throw e; if (e.code === 'BANNED') say(e.message); }
  if (q.get('error')) say(`That didn't work: ${q.get('error').replace(/_/g, ' ').toLowerCase()}.`);
  if (q.get('verified')) say('Your email is confirmed.', true);
  const mode = q.get('mode');
  if (mode === 'reset' && q.get('token')) return viewReset(q.get('token'));
  if (!me) return mode === 'sign-up' ? viewSignUp() : mode === 'forgot' ? viewForgot() : mode === 'mfa' ? viewTwoFactorStep() : mode === 'guest' ? playAsGuest() : viewSignIn();
  if (me.needsTerms) return viewTerms();
  if (mode === 'mfa') return me.twoFactor.enabled ? viewCodeAgain() : viewTurnOnTwoFactor({ required: true });
  if (mode === 'support') return show(supportSection(true));
  if (q.get('verified') || (mode === 'terms' && !me.needsTerms)) { location.replace(next); return; }
  viewAccount();
}

// ---------- signed out ----------
function socialButtons() {
  if (!cfg.social.length) return [];
  return [h('div', { class: 'or' }, 'or'), ...cfg.social.map(p => h('button', { class: 'btn secondary', type: 'button', onclick: async () => {
    try {
      const r = await api.auth('/sign-in/social', { provider: p, callbackURL: nextUrl, newUserCallbackURL: here('terms'), errorCallbackURL: here(null) });
      if (r?.url && /^https:\/\//.test(r.url)) location.href = r.url;
    } catch (e) { say(e.message); }
  } }, `Continue with ${p === 'google' ? 'Google' : 'Discord'}`))];
}
function viewSignIn() {
  const email = field('Email', { type: 'email', required: true, autocomplete: 'username', maxlength: 254 }), pw = field('Password', { type: 'password', required: true, autocomplete: 'current-password', maxlength: 128 });
  const resend = h('div'), bot = createBotCheck(cfg);
  show(h('section', {}, h('h2', {}, 'Sign in'),
    form([email.el, pw.el, bot.el], 'Sign in', async () => {
      let r;
      try { r = await api.auth('/sign-in/email', { email: email.input.value.trim(), password: pw.input.value }, { headers: await bot.headers() }); }
      catch (e) {
        bot.reset();
        // (not confirmed yet: the link sent again)
        if (e.status === 403 && /verif/i.test(e.message)) {
          say('Confirm your email first: we\'ve sent the link again. Check your inbox (and spam).');
          resend.replaceChildren(h('button', { class: 'btn secondary', type: 'button', onclick: () => api.auth('/send-verification-email', { email: email.input.value.trim(), callbackURL: here(null, { verified: '1' }) }).then(() => say('Sent again.', true), x => say(x.message)) }, 'Send it again'));
          return;
        }
        throw e;
      }
      // (two-factor sign-in on: the authenticator's code before there's a session)
      if (r?.twoFactorRedirect) return viewTwoFactorStep();
      location.replace(next);
    }),
    resend, ...socialButtons(),
    h('div', { class: 'links' }, h('a', { href: here('sign-up') }, 'Create an account'), h('a', { href: here('forgot') }, 'Forgot your password?')),
    h('button', { class: 'btn ghost', type: 'button', onclick: playAsGuest }, 'Play as a guest')));
}
// (a guest: the bot check first, on a little page of its own when it's on)
async function playAsGuest() {
  const bot = createBotCheck(cfg);
  const go = async () => { try { await api.auth('/sign-in/anonymous', {}, { headers: await bot.headers() }); api.forgetCsrf(); location.replace(here('terms')); } catch (e) { bot.reset(); say(e.message); } };
  if (!cfg.botCheck) return go();
  show(h('section', {}, h('h2', {}, 'Play as a guest'), h('p', { class: 'muted' }, 'A quick check that you\'re not a bot, then you\'re in. Make an account later and your progress comes with you.'),
    form([bot.el], 'Play as a guest', go), h('a', { href: here(null) }, 'Back to signing in')));
}
function termsCheck() {
  const box = h('input', { type: 'checkbox', required: true });
  return { el: h('label', { class: 'check' }, box, h('span', {}, 'I agree to the ', h('a', { href: '/account/terms.html', target: '_blank' }, 'terms of service'), ' and the ', h('a', { href: '/account/privacy.html', target: '_blank' }, 'privacy policy'), `, and I'm at least ${cfg.minAge}.`)), input: box };
}
function nameField() {
  const hint = h('span', { class: 'hint muted' }, '3–20 letters, digits, spaces, - or _: shown on leaderboards.');
  const f = field('Display name', { required: true, minlength: 3, maxlength: 20, autocomplete: 'nickname' }, hint);
  let timer = null;
  f.input.addEventListener('input', () => {
    clearTimeout(timer);
    const v = f.input.value.trim();
    if (v.length < 3) { hint.className = 'hint muted'; hint.textContent = '3–20 letters, digits, spaces, - or _: shown on leaderboards.'; return; }
    timer = setTimeout(async () => {
      try { const r = await api.get(`/me/name-check?name=${encodeURIComponent(v)}`); hint.className = `hint ${r.available ? 'good' : 'bad'}`; hint.textContent = r.available ? 'That name is free.' : r.reason ?? 'That name isn\'t available.'; }
      catch { /* checked again on sign-up */ }
    }, 350);
  });
  return f;
}
function viewSignUp({ guest = false } = {}) {
  const name = nameField(), email = field('Email', { type: 'email', required: true, autocomplete: 'email', maxlength: 254 });
  const pw = field('Password', { type: 'password', required: true, minlength: 10, maxlength: 128, autocomplete: 'new-password' }, h('span', { class: 'hint muted' }, 'At least 10 characters.'));
  const birth = birthField(), terms = termsCheck(), bot = createBotCheck(cfg);
  // (the closed beta: an invite code — from the link someone sent, or typed)
  const invite = cfg.closedBeta ? field('Invite code', { autocomplete: 'off', maxlength: 40, value: q.get('invite') ?? '', style: 'text-transform:uppercase' }, h('span', { class: 'hint muted' }, 'The game is in a closed beta: signing up needs an invite (the game\'s owner signs up without one).')) : null;
  const sec = h('section', {}, h('h2', {}, guest ? 'Make your account' : 'Create an account'),
    guest ? h('p', { class: 'muted' }, 'Everything you\'ve done as a guest comes with you.') : null,
    form([invite?.el, name.el, email.el, pw.el, birth.el, terms.el, bot.el].filter(Boolean), 'Create my account', async () => {
      try { await api.auth('/sign-up/email', { name: name.input.value.trim(), email: email.input.value.trim(), password: pw.input.value, acceptTerms: cfg.termsVersion, birthDate: birth.input.value, callbackURL: here(null, { verified: '1' }), ...(invite ? { inviteCode: invite.input.value.trim() } : {}) }, { headers: await bot.headers() }); }
      catch (e) { bot.reset(); throw e; }
      // (no email to confirm — development, on this computer: the new account is signed in already)
      if (cfg.emailVerification === false) { api.forgetCsrf(); location.replace(next); return; }
      show(h('section', {}, h('h2', {}, 'Check your email'), h('p', {}, `We've sent a link to ${email.input.value.trim()}. Open it to confirm your email and you're in${guest ? ', with your progress' : ''}.`),
        h('button', { class: 'btn secondary', type: 'button', onclick: () => api.auth('/send-verification-email', { email: email.input.value.trim(), callbackURL: here(null, { verified: '1' }) }).then(() => say('Sent again.', true), x => say(x.message)) }, 'Send it again')));
    }),
    ...(guest ? [] : socialButtons()),
    guest ? null : h('div', { class: 'links' }, h('a', { href: here(null) }, 'I have an account: sign in'), h('a', { href: '#', onclick: e => { e.preventDefault(); playAsGuest(); } }, 'Play as a guest')));
  if (guest) return sec;
  show(sec);
}
function viewForgot() {
  const email = field('Email', { type: 'email', required: true, autocomplete: 'username' });
  show(h('section', {}, h('h2', {}, 'Forgot your password?'), h('p', { class: 'muted' }, 'We\'ll email you a link to choose a new one (it works for an hour).'),
    form([email.el], 'Send the link', async () => {
      await api.auth('/request-password-reset', { email: email.input.value.trim(), redirectTo: here('reset') });
      say('If there\'s an account with that email, the link is on its way.', true);
    }), h('a', { href: here(null) }, 'Back to signing in')));
}
function viewReset(token) {
  const pw = field('New password', { type: 'password', required: true, minlength: 10, maxlength: 128, autocomplete: 'new-password' }), pw2 = field('The same again', { type: 'password', required: true, minlength: 10, maxlength: 128, autocomplete: 'new-password' });
  show(h('section', {}, h('h2', {}, 'Choose a new password'),
    form([pw.el, pw2.el], 'Save it', async () => {
      if (pw.input.value !== pw2.input.value) throw new Error('The two passwords aren\'t the same.');
      await api.auth('/reset-password', { newPassword: pw.input.value, token });
      history.replaceState(null, '', here(null));
      say('Your password is changed, and every other device is signed out. Sign in with the new one.', true);
      viewSignIn();
    })));
}

// ---------- two-factor sign-in ----------
const codeField = () => field('Code from your authenticator app', { required: true, inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6}', maxlength: 6, minlength: 6 });
const backupLink = done => h('a', { href: '#', onclick: e => { e.preventDefault(); viewBackupCode(done); } }, 'Use a backup code instead');
// signing in: the password was right, now the code
function viewTwoFactorStep() {
  const code = codeField();
  show(h('section', {}, h('h2', {}, 'Two-factor sign-in'), h('p', { class: 'muted' }, 'Open your authenticator app and enter the 6-digit code for Kugelsack Racing.'),
    form([code.el], 'Sign in', async () => { await api.auth('/two-factor/verify-totp', { code: code.input.value.trim() }); api.forgetCsrf(); location.replace(next); }),
    h('div', { class: 'links' }, backupLink(() => location.replace(next)), h('a', { href: here(null) }, 'Start again'))));
  code.input.focus();
}
function viewBackupCode(done) {
  const code = field('Backup code', { required: true, autocomplete: 'off', maxlength: 40 });
  show(h('section', {}, h('h2', {}, 'A backup code'), h('p', { class: 'muted' }, 'One of the codes you saved when you turned two-factor sign-in on. Each works once.'),
    form([code.el], 'Use it', async () => { await api.auth('/two-factor/verify-backup-code', { code: code.input.value.trim() }); api.forgetCsrf(); done(); })));
}
// signed in, an editor's or admin's tools ask for the code again (every few hours)
function viewCodeAgain() {
  const code = codeField();
  show(h('section', {}, h('h2', {}, 'Enter your code'), h('p', { class: 'muted' }, 'Editor and admin tools ask for your authenticator\'s code every few hours.'),
    form([code.el], 'Carry on', async () => { await api.auth('/two-factor/verify-totp', { code: code.input.value.trim() }); location.replace(next); }),
    h('div', { class: 'links' }, backupLink(() => location.replace(next)))));
  code.input.focus();
}
// turning it on: the password, then the app set up from the key (or its link), then a code to prove it works; the
// backup codes shown once
function viewTurnOnTwoFactor({ required = false } = {}) {
  if (!me.providers.includes('credential')) {
    show(h('section', {}, h('h2', {}, 'Two-factor sign-in'), h('p', {}, 'Two-factor sign-in works with an email and password account. Set a password first: sign out, then "Forgot your password?" with your email.')));
    return;
  }
  const pw = field('Your password', { type: 'password', required: true, autocomplete: 'current-password', maxlength: 128 });
  show(h('section', {}, h('h2', {}, 'Turn on two-factor sign-in'),
    h('p', { class: 'muted' }, required ? 'Editor and admin accounts need it: after your password, a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Aegis…).' : 'After your password, a code from an authenticator app on your phone: someone with your password alone can\'t sign in.'),
    form([pw.el], 'Next', async () => {
      const r = await api.auth('/two-factor/enable', { password: pw.input.value });
      const secret = new URL(r.totpURI).searchParams.get('secret') ?? '', code = codeField();
      show(h('section', {}, h('h2', {}, 'Set up your app'),
        h('p', {}, 'Add an account in your authenticator app with this key (or open the link on your phone):'),
        h('p', {}, h('code', { style: 'font-size:18px;letter-spacing:.12em;user-select:all' }, secret.replace(/(.{4})/g, '$1 ').trim())),
        h('p', {}, h('a', { href: r.totpURI }, 'Open in my authenticator app')),
        form([code.el], 'Turn it on', async () => {
          await api.auth('/two-factor/verify-totp', { code: code.input.value.trim() });
          show(h('section', {}, h('h2', {}, 'Two-factor sign-in is on'),
            h('p', {}, 'Save these backup codes somewhere safe (each works once, if you lose your phone):'),
            h('pre', { style: 'user-select:all;font-size:15px' }, (r.backupCodes ?? []).join('\n')),
            h('a', { class: 'btn primary', href: required ? next : here(null), style: 'display:inline-flex' }, required ? 'Carry on' : 'Done')));
        })));
    })));
}

// ---------- contact support (Phase 6 Step 5): linked to the account; the game's version and device shown, then sent ----------
function supportSection(alone = false) {
  const info = clientInfo(), cat = h('select', { required: true }, ...[['', 'What\'s it about?'], ['bug', 'Something doesn\'t work'], ['account', 'My account'], ['progress', 'Lost progress, money or items'], ['cheating', 'Cheating or another player'], ['other', 'Something else']].map(([v, t]) => h('option', { value: v }, t)));
  const msg = h('textarea', { required: true, minlength: 10, maxlength: 4000, rows: 5, placeholder: 'What happened, and what you expected. The more detail, the quicker we can help.', style: 'font:500 15px var(--f-ui);color:var(--c-text);background:var(--c-viewport);border:1px solid var(--c-line);border-radius:var(--r-btn);padding:10px 11px' });
  const email = me.isGuest ? field('Your email (to answer you: guests have none on file)', { type: 'email', maxlength: 254, autocomplete: 'email' }) : null;
  return h('section', {}, h('h2', {}, 'Contact support'),
    h('p', { class: 'muted' }, me.isGuest ? 'We answer by email if you give one.' : `We answer by email to ${me.email}.`),
    form([h('label', {}, 'About', cat), h('label', {}, 'Message', msg), email?.el, h('p', { class: 'muted' }, 'Sent with it, to help us find the problem: ', describe(info), '.')].filter(Boolean), 'Send', async () => {
      await api.post('/support', { category: cat.value, message: msg.value.trim(), client: info, ...(email?.input.value.trim() ? { contactEmail: email.input.value.trim() } : {}) });
      say('Sent: thanks. We\'ll get back to you.', true); msg.value = ''; cat.value = '';
    }, { primary: alone }),
    alone ? h('a', { href: next }, 'Back') : null);
}

// ---------- signed in ----------
function viewTerms() {
  const birth = birthField(), terms = termsCheck();
  show(h('section', {}, h('h2', {}, me.isGuest ? 'Before you play' : 'The terms'),
    h('p', { class: 'muted' }, me.isGuest ? `You're playing as ${me.displayName}. To keep your progress on the server, accept the terms first.` : 'Our terms or privacy policy have changed (or you haven\'t accepted them yet).'),
    form([birth.el, terms.el], 'Accept and play', async () => {
      await api.post('/me/terms', { termsVersion: cfg.termsVersion, birthDate: birth.input.value });
      location.replace(next);
    }),
    h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await api.auth('/sign-out', {}).catch(() => {}); location.replace(next); } }, 'Not now (sign out)')));
}
function viewAccount() {
  const sections = [];
  const when = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—';
  sections.push(h('section', {}, h('h2', {}, me.displayName),
    h('dl', {},
      h('dt', {}, 'Account'), h('dd', {}, me.isGuest ? 'A guest (on this browser only)' : `${me.email}${me.emailVerified ? '' : ' (not confirmed)'}`),
      h('dt', {}, 'Signs in with'), h('dd', {}, me.providers.map(p => ({ credential: 'email and password', anonymous: 'guest' })[p] ?? p).join(', ')),
      me.role !== 'player' && h('dt', {}, 'Role'), me.role !== 'player' && h('dd', {}, me.role),
      h('dt', {}, 'Joined'), h('dd', {}, when(me.createdAt))),
    h('a', { class: 'btn primary', href: next, style: 'display:inline-flex' }, 'Back to the game')));
  if (me.isGuest) sections.push(viewSignUp({ guest: true }));
  else {
    const name = nameField(), soon = me.nameChangeAvailableAt;
    sections.push(h('section', {}, h('h2', {}, 'Display name'),
      soon ? h('p', { class: 'muted' }, `You can change it again on ${when(soon)}.`) : h('p', { class: 'muted' }, 'You can change it once a month.'),
      !soon && form([name.el], 'Change it', async () => { await api.patch('/me/name', { displayName: name.input.value.trim() }); say('Your name is changed.', true); me = (await api.get('/me')).user; viewAccount(); }, { primary: false })));
  }
  if (!me.isGuest) {
    const tf = me.twoFactor, pw2 = field('Your password', { type: 'password', required: true, autocomplete: 'current-password', maxlength: 128 });
    sections.push(h('section', {}, h('h2', {}, 'Two-factor sign-in'),
      tf.enabled ? h('p', {}, 'On: after your password, a code from your authenticator app.') : h('p', { class: tf.required ? 'bad' : 'muted' }, tf.required ? 'Your role needs it: turn it on to use the editor and admin tools.' : 'Off. Turn it on so your password alone isn\'t enough to sign in.'),
      tf.enabled
        ? form([pw2.el], tf.required ? 'Turn it off (the editor and admin tools stop working)' : 'Turn it off', async () => { if (!confirm('Turn two-factor sign-in off?')) return; await api.auth('/two-factor/disable', { password: pw2.input.value }); me = (await api.get('/me')).user; say('Two-factor sign-in is off.', true); viewAccount(); }, { primary: false })
        : h('button', { class: `btn ${tf.required ? 'primary' : 'secondary'}`, type: 'button', onclick: () => viewTurnOnTwoFactor({ required: tf.required }) }, 'Turn it on')));
  }
  sections.push(supportSection());
  sections.push(h('section', {}, h('h2', {}, 'Signing out'),
    h('div', { class: 'row' },
      h('button', { class: 'btn secondary', onclick: async () => { await api.auth('/sign-out', {}).catch(() => {}); api.forgetCsrf(); location.replace(here(null)); } }, 'Sign out'),
      h('button', { class: 'btn secondary', onclick: async () => { if (!confirm('Sign out on every device, this one too?')) return; try { await api.post('/me/sign-out-everywhere'); location.replace(here(null)); } catch (e) { say(e.message); } } }, 'Everywhere'))));
  const pw = field('Your password', { type: 'password', autocomplete: 'current-password', maxlength: 128 }), confirmText = field('Type DELETE to confirm', { required: true, pattern: 'DELETE', autocomplete: 'off' });
  sections.push(h('section', {}, h('h2', {}, 'Your data'),
    h('p', { class: 'muted' }, 'A copy of everything the server keeps about you (your account, sign-ins, results, records and replays).'),
    h('button', { class: 'btn secondary', onclick: async () => {
      try {
        const res = await api.get('/me/export', { raw: true }), blob = await res.blob(), a = h('a', { href: URL.createObjectURL(blob), download: `kugelsack-racing-${me.id}.json` });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      } catch (e) { say(e.message); }
    } }, 'Download my data'),
    h('h2', { style: 'margin-top:12px' }, 'Delete my account'),
    h('p', { class: 'muted' }, 'Your account, results, records and replays are deleted for good. The progress kept in this browser stays here.'),
    form([...(me.providers.includes('credential') ? [pw.el] : []), confirmText.el], 'Delete my account', async () => {
      if (confirmText.input.value !== 'DELETE') throw new Error('Type DELETE (in capitals) to confirm.');
      await api.del('/me', { confirm: 'DELETE', ...(pw.input.value ? { password: pw.input.value } : {}) });
      say('Your account is deleted.', true);
      try { localStorage.removeItem('kr.account.last'); } catch { /* fine */ }
      show(h('section', {}, h('p', {}, 'Your account is deleted. Thanks for playing.'), h('a', { class: 'btn secondary', href: '/', style: 'display:inline-flex' }, 'Back to the game')));
    }, { primary: false })));
  show(...sections);
}

start().catch(e => say(`Something went wrong: ${e.message}`));

// The account page (Phase 6 Step 1). Signed out: sign in (email and password, Google, Discord), make an
// account (a display name checked as it's typed, the terms and privacy policy, the minimum age), play as a
// guest, a forgotten password (an emailed link, then a new password here). Signed in: the terms if they're
// still to accept, the display name (changed at most once a month), a guest making their account (their
// progress comes with them), signing out here or everywhere, a copy of their data, deleting the account.
// The server does all the checking (Better Auth, server/src/routes/me.ts); what anyone typed is shown as text.
//
//   /account/?next=/somewhere   back there afterwards (only this site's own pages)
//   ?mode=sign-up | terms | reset (&token, from the reset email) · ?verified=1 (from the verification email)

import { createApi, ApiError } from './api.js';
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
  if (!me) return mode === 'sign-up' ? viewSignUp() : mode === 'forgot' ? viewForgot() : viewSignIn();
  if (me.needsTerms) return viewTerms();
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
  const resend = h('div');
  show(h('section', {}, h('h2', {}, 'Sign in'),
    form([email.el, pw.el], 'Sign in', async () => {
      try { await api.auth('/sign-in/email', { email: email.input.value.trim(), password: pw.input.value }); }
      catch (e) {
        // (not confirmed yet: the link sent again)
        if (e.status === 403 && /verif/i.test(e.message)) {
          say('Confirm your email first: we\'ve sent the link again. Check your inbox (and spam).');
          resend.replaceChildren(h('button', { class: 'btn secondary', type: 'button', onclick: () => api.auth('/send-verification-email', { email: email.input.value.trim(), callbackURL: here(null, { verified: '1' }) }).then(() => say('Sent again.', true), x => say(x.message)) }, 'Send it again'));
          return;
        }
        throw e;
      }
      location.replace(next);
    }),
    resend, ...socialButtons(),
    h('div', { class: 'links' }, h('a', { href: here('sign-up') }, 'Create an account'), h('a', { href: here('forgot') }, 'Forgot your password?')),
    h('button', { class: 'btn ghost', type: 'button', onclick: playAsGuest }, 'Play as a guest')));
}
async function playAsGuest() {
  try { await api.auth('/sign-in/anonymous', {}); api.forgetCsrf(); location.replace(here('terms')); } catch (e) { say(e.message); }
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
  const birth = birthField(), terms = termsCheck();
  const sec = h('section', {}, h('h2', {}, guest ? 'Make your account' : 'Create an account'),
    guest ? h('p', { class: 'muted' }, 'Everything you\'ve done as a guest comes with you.') : null,
    form([name.el, email.el, pw.el, birth.el, terms.el], 'Create my account', async () => {
      await api.auth('/sign-up/email', { name: name.input.value.trim(), email: email.input.value.trim(), password: pw.input.value, acceptTerms: cfg.termsVersion, birthDate: birth.input.value, callbackURL: here(null, { verified: '1' }) });
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

// Live updates in the game (Phase 8 Step 4; docs/LIVE_UPDATES.md): the news panel (news, what's new, the event
// calendar), patch notes shown once after an update, maintenance and outage notices linked to the status page, and a
// reminder when an event you're going to is about to start. Written on the admin page's Live tab; the server's
// GET /api/v1/news and /calendar. The settings' Notifications choose which of these the player sees.
//
//   const news = mountNews({ A, settings, t })   // a News button (lit when there's something new) and its panel

import { t as tr, i18n, esc } from './i18n.js';
import { trapFocus, announce } from './accessibility.js';

const SEEN = 'ognistrada.news.seen', VERSION = 'ognistrada.news.version', REMINDED = 'ognistrada.news.reminded';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* shown again */ } };
// a news item's body: plain text with lines starting "- " as a list (no HTML from anyone)
export function renderBody(text) {
  const lines = String(text ?? '').split('\n'), out = [];
  let list = false;
  for (const l of lines) {
    const m = /^\s*[-*]\s+(.*)$/.exec(l);
    if (m) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${esc(m[1])}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (l.trim()) out.push(`<p>${esc(l)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}
// which patch notes to show after an update: the ones for this version, or published since the version last seen
export function patchNotesToShow(items, { version, lastVersion, lastSeenAt }) {
  if (!version || version === lastVersion) return [];
  return items.filter(i => i.kind === 'patch' && (i.version === version || (lastSeenAt && i.startsAt > lastSeenAt)));
}

export function mountNews({ A, settings, t = tr, poll = 5 * 60_000, version = globalThis.KR_SITE?.version ?? null } = {}) {
  const button = document.createElement('button');
  button.type = 'button'; button.id = 'newsButton'; button.className = 'newsButton';
  const panel = document.createElement('div');
  panel.id = 'newsPanel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'newsTitle');
  const banner = document.createElement('div');
  banner.id = 'liveBanner'; banner.hidden = true; banner.setAttribute('role', 'status');
  document.body.append(button, panel, banner);
  let items = [], events = [], tab = 'news', release = null;
  const N = () => settings?.notifications ?? {};
  // (what lights the button: new news and patch notes, and new events on the calendar — each as the Notifications say)
  const unread = () => { const seen = new Set(read(SEEN, [])); return items.filter(i => (i.kind === 'news' ? N().news !== false : i.kind === 'patch' ? N().patchNotes !== false : false) && !seen.has(i.id)).length + (N().events !== false ? events.filter(e => !e.cancelled && !seen.has(`event:${e.id}`)).length : 0); };
  function drawButton() {
    const n = unread();
    button.innerHTML = `<span aria-hidden="true">📰</span> ${esc(t('news.button'))}${n ? ` <b class="badge">${n}</b>` : ''}`;
    button.setAttribute('aria-label', n ? t('news.buttonUnread', { n }) : t('news.button'));
  }
  function draw() {
    const list = tab === 'events' ? events : items.filter(i => tab === 'patch' ? i.kind === 'patch' : i.kind === 'news' || i.kind === 'maintenance' || i.kind === 'outage');
    panel.innerHTML = `<div class="head"><h2 id="newsTitle">${t('news.title')}</h2><button type="button" class="close" data-close aria-label="${t('common.close')}">×</button></div>
      <div role="tablist" class="tabs">${['news', 'patch', 'events'].map(x => `<button type="button" role="tab" aria-selected="${x === tab}" data-tab="${x}">${t(`news.tab.${x}`)}</button>`).join('')}</div>
      <div role="tabpanel" class="list">${!list.length ? `<p class="empty">${t(`news.empty.${tab}`)}</p>` : tab === 'events' ? list.map(eventHtml).join('') : list.map(itemHtml).join('')}</div>
      <p class="foot"><a href="/site/status.html" target="_blank" rel="noopener">${t('news.status')}</a></p>`;
  }
  const itemHtml = i => `<article class="item ${i.kind}"><h3>${esc(i.title)}</h3><p class="when">${i18n.date(i.startsAt, 'medium')}${i.version ? ` · ${t('news.version', { version: esc(String(i.version).slice(0, 7)) })}` : ''}</p>${renderBody(i.body)}${i.link ? `<p><a href="${esc(i.link)}" target="_blank" rel="noopener">${t('news.more')}</a></p>` : ''}</article>`;
  const eventHtml = e => `<article class="item event${e.cancelled ? ' cancelled' : ''}"><h3>${esc(e.title)} <small>${t(`news.kind.${e.kind}`)}</small></h3>
    <p class="when">${i18n.date(e.startsAt, 'datetime')} – ${i18n.time(e.endsAt)}${e.region ? ` · ${esc(e.region)}` : ''}${e.cancelled ? ` · <b>${t('news.cancelled')}</b>` : ''}</p>${renderBody(e.body)}
    <p>${t('news.going', { n: e.going })}${!e.cancelled && !String(e.id).startsWith('meet:') && A?.me ? ` <button type="button" data-rsvp="${esc(e.id)}" data-on="${e.mine ? 1 : 0}">${e.mine ? t('news.notGoing') : t('news.imGoing')}</button>` : ''}${e.link ? ` <a href="${esc(e.link)}">${t('news.open')}</a>` : ''}</p></article>`;
  async function load() {
    const api = A?.api;
    if (!api || !A.online) return;
    try { items = (await api.get('/news')).items ?? []; } catch { /* next time */ }
    try { events = (await api.get('/calendar')).events ?? []; } catch { /* next time */ }
    drawButton();
    // maintenance or an outage going on now: a banner, with the status page
    const live = items.find(i => i.kind === 'maintenance' || i.kind === 'outage');
    banner.hidden = !live;
    if (live) banner.innerHTML = `<b>${esc(live.title)}</b> ${esc(live.body.split('\n')[0])} <a href="${esc(live.link || '/site/status.html')}" target="_blank" rel="noopener">${t('news.status')}</a>`;
    // after an update: its patch notes, once
    if (N().patchNotes !== false) {
      const notes = patchNotesToShow(items, { version, lastVersion: read(VERSION, null), lastSeenAt: read(`${VERSION}.at`, null) });
      if (notes.length) { tab = 'patch'; open(); }
    }
    if (version) { write(VERSION, version); write(`${VERSION}.at`, new Date().toISOString()); }
    remind();
  }
  // an event you're going to, starting within 15 minutes: a notice, once
  function remind() {
    if (N().eventReminders === false) return;
    const done = new Set(read(REMINDED, [])), now = Date.now();
    for (const e of events) if (e.mine && !e.cancelled && !done.has(e.id) && new Date(e.startsAt).getTime() - now < 15 * 60e3 && new Date(e.startsAt).getTime() > now - 5 * 60e3) {
      done.add(e.id);
      const note = document.createElement('div');
      note.className = 'eventReminder'; note.setAttribute('role', 'status');
      note.innerHTML = `${t('news.reminder', { title: esc(e.title), when: i18n.time(e.startsAt) })} <button type="button">${t('common.close')}</button>`;
      note.querySelector('button').onclick = () => note.remove();
      document.body.append(note);
      announce(note.textContent);
      setTimeout(() => note.remove(), 30_000);
    }
    write(REMINDED, [...done].slice(-50));
  }
  function open() {
    panel.hidden = false; draw();
    release?.(); release = trapFocus(panel, { onEscape: close });
    write(SEEN, [...new Set([...read(SEEN, []), ...items.map(i => i.id), ...events.map(e => `event:${e.id}`)])].slice(-300));
    drawButton();
  }
  function close() { panel.hidden = true; release?.(); release = null; button.focus(); }
  button.addEventListener('click', () => (panel.hidden ? open() : close()));
  panel.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.close !== undefined) return close();
    if (b.dataset.tab) { tab = b.dataset.tab; draw(); panel.querySelector(`[data-tab="${tab}"]`)?.focus(); return; }
    if (b.dataset.rsvp) {
      const on = b.dataset.on === '1';
      try { await (on ? A.api.del(`/calendar/${b.dataset.rsvp}/rsvp`) : A.api.post(`/calendar/${b.dataset.rsvp}/rsvp`, {})); events = (await A.api.get('/calendar')).events; draw(); announce(on ? t('news.notGoing') : t('news.imGoing')); } catch { /* try again */ }
    }
  });
  drawButton();
  load();
  const timer = setInterval(load, poll);
  A?.on?.(() => { if (A.online && !items.length) load(); });
  return { button, panel, load, open, close, stop() { clearInterval(timer); } };
}

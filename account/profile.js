// A player's profile (Phase 8 Step 4; docs/PHOTO_MODE.md "The player profile page"): their level, stats, favourite cars, medals (quests
// and the driving school), best times, crew and photos — their own (?id missing), or another player's (?id=…) if they
// keep it public. Your own: choose favourite cars, keep it public or private, make, join or leave a crew, remove a
// photo, share it. Everything in the player's language (ui/i18n.js); every value shown as text.

import { account } from './session.js';
import { setLanguage, t, i18n, esc } from '../ui/i18n.js';
import { shareLink, share } from '../ui/share.js';

const $ = id => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id');
let settings = {};
try { settings = JSON.parse(localStorage.getItem('driveWorld.settings.v1') ?? '{}') ?? {}; } catch { /* defaults */ }
await setLanguage(settings.language ?? 'auto');
document.title = `Ogni Strada · ${t('profile.title')}`;
const A = await account();
const fmtTime = ms => ms == null ? '—' : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;
let cars = {};
try { const idx = await (await fetch('/data/cars/index.json')).json(); for (const f of idx.cars) { const c = await (await fetch(`/data/cars/${f}`)).json(); cars[c.id] = c; } } catch { /* ids then */ }
const carName = c => esc(cars[c]?.name ?? c);

async function draw() {
  if (!A.me) { $('profile').innerHTML = `<h1>${t('profile.title')}</h1><p>${t('profile.signIn')}</p><p><a href="/account/?next=${encodeURIComponent(location.pathname + location.search)}">${t('profile.signInLink')}</a></p>`; return; }
  let P;
  try { P = await A.api.get(id ? `/profiles/${encodeURIComponent(id)}` : '/player/profile'); }
  catch (e) { $('profile').innerHTML = `<h1>${t('profile.title')}</h1><p>${esc(e.message)}</p>`; return; }
  document.title = `Ogni Strada · ${P.name}`;
  const M = P.medals;
  $('profile').innerHTML = `
    <h1>${esc(P.name)} ${P.crew ? `<small class="muted">[${esc(P.crew.tag)}]</small>` : ''}</h1>
    <p class="muted">${t('profile.since', { date: i18n.date(P.since, 'long') })}${P.guest ? ` · ${t('profile.guest')}` : ''}</p>
    <div class="stats">
      <div class="stat"><b>${i18n.number(P.level)}</b><span>${t('profile.level')}</span></div>
      <div class="stat"><b>${i18n.number(P.xp)}</b><span>${t('profile.xp')}</span></div>
      ${P.money != null ? `<div class="stat"><b>${i18n.money(P.money)}</b><span>${t('profile.money')}</span></div>` : ''}
      <div class="stat"><b>${i18n.number(P.stats.finished)}</b><span>${t('profile.questsFinished', { n: P.stats.finished })}</span></div>
      <div class="stat"><b>${i18n.number(P.stats.cars)}</b><span>${t('profile.cars', { n: P.stats.cars })}</span></div>
      <div class="stat"><b class="medals" aria-label="${t('profile.medalsLabel', { gold: M.gold, silver: M.silver, bronze: M.bronze })}">🥇${M.gold} 🥈${M.silver} 🥉${M.bronze}</b><span>${t('profile.medals')}</span></div>
    </div>
    <h2>${t('profile.favourites')}</h2>
    ${P.favourites.length ? `<p>${P.favourites.map(carName).join(' · ')}</p>` : `<p class="muted">${t('profile.noFavourites')}</p>`}
    ${P.own ? `<details><summary>${t('profile.chooseFavourites')}</summary><div class="row">${P.cars.map(c => `<label><input type="checkbox" data-fav="${esc(c)}" ${P.favourites.includes(c) ? 'checked' : ''}> ${carName(c)}</label>`).join('')}</div></details>` : ''}
    <h2>${t('profile.school')}</h2>
    ${P.school.length ? `<table><tr><th>${t('profile.lesson')}</th><th>${t('profile.medal')}</th></tr>${P.school.map(s => `<tr><td>${t(`school.lesson.${s.lesson}.title`)}</td><td>${s.medal === 'none' ? '—' : t(`school.medal.${s.medal}`)}</td></tr>`).join('')}</table>` : `<p class="muted">${t('profile.noSchool')}</p>`}
    <h2>${t('profile.bestTimes')}</h2>
    ${P.bestTimes.length ? `<table><tr><th>${t('profile.track')}</th><th>${t('profile.class')}</th><th>${t('profile.time')}</th><th>${t('profile.lap')}</th><th></th></tr>${P.bestTimes.map(b => `<tr><td><a href="/?track=${esc(b.code)}">${esc(b.code.slice(0, 10))}…</a></td><td>${esc(b.carClass ?? '')}</td><td>${fmtTime(b.time)}</td><td>${fmtTime(b.lap)}</td><td>${b.time ? `<button type="button" class="quiet" data-beat="${esc(b.code)}" data-ms="${b.time}" data-class="${esc(b.carClass ?? '')}">${t('profile.challenge')}</button>` : ''}</td></tr>`).join('')}</table>` : `<p class="muted">${t('profile.noTimes')}</p>`}
    <h2>${t('profile.crew')}</h2>
    ${P.crew ? `<p><b>${esc(P.crew.name)}</b> [${esc(P.crew.tag)}] · ${t(`profile.role.${P.crew.role}`)}</p>${P.own ? `<div class="row"><button type="button" class="quiet" data-a="crewShow" data-id="${esc(P.crew.id)}">${t('profile.crewMembers')}</button><button type="button" class="quiet" data-a="leave">${t('profile.leaveCrew')}</button></div><div id="crewMembers"></div>` : ''}`
      : P.own ? `<p class="muted">${t('profile.noCrew')}</p>${P.guest ? `<p class="muted">${t('profile.crewNeedsAccount')}</p>` : `<form id="makeCrew" class="row"><input name="name" required minlength="3" maxlength="40" placeholder="${t('profile.crewName')}" aria-label="${t('profile.crewName')}"><input name="tag" required pattern="[A-Za-z0-9]{2,5}" maxlength="5" placeholder="${t('profile.crewTag')}" aria-label="${t('profile.crewTag')}" size="6"><button>${t('profile.makeCrew')}</button></form>
        <form id="joinCrew" class="row"><input name="code" required placeholder="${t('profile.inviteCode')}" aria-label="${t('profile.inviteCode')}"><button class="quiet">${t('profile.joinCrew')}</button></form>`}` : `<p class="muted">${t('profile.noCrewOther')}</p>`}
    <h2>${t('profile.photos')}</h2>
    ${P.photos.length ? `<div class="photos">${P.photos.map(p => `<figure><img src="${esc(globalThis.KR_SITE?.api ?? '')}${esc(p.url)}" alt="${esc(p.caption || t('profile.photoAlt', { place: p.place ?? '' }))}" loading="lazy"><figcaption><span>${esc(p.caption ?? p.place ?? '')}</span>${P.own ? `<button type="button" class="quiet" data-delphoto="${esc(p.id)}" aria-label="${t('profile.removePhoto')}">×</button>` : ''}</figcaption></figure>`).join('')}</div>` : `<p class="muted">${t('profile.noPhotos')}</p>`}
    ${P.own ? `<h2>${t('profile.privacy')}</h2><label><input type="checkbox" id="public" ${P.public ? 'checked' : ''}> ${t('profile.public')}</label>
      <p><button type="button" class="quiet" data-a="share">${t('profile.share')}</button></p>` : ''}
    <p class="muted" role="status" id="msg"></p>`;
}
const say = text => { const m = $('msg'); if (m) m.textContent = text; };
document.addEventListener('change', async e => {
  const x = e.target;
  try {
    if (x.dataset.fav) { const favs = [...document.querySelectorAll('[data-fav]:checked')].map(i => i.dataset.fav).slice(0, 6); await A.api.put('/player/profile', { favouriteCars: favs }); await draw(); }
    if (x.id === 'public') { await A.api.put('/player/profile', { public: x.checked }); say(x.checked ? t('profile.nowPublic') : t('profile.nowPrivate')); }
  } catch (err) { say(err.message); }
});
document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    if (e.target.id === 'makeCrew') { const c = await A.api.post('/crews', { name: f.get('name'), tag: f.get('tag') }); await draw(); say(t('profile.crewMade', { code: c.inviteCode })); }
    if (e.target.id === 'joinCrew') { await A.api.post('/crews/join', { code: f.get('code') }); await draw(); }
  } catch (err) { say(err.message); }
});
document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  try {
    if (b.dataset.delphoto) { await A.api.del(`/player/photos/${b.dataset.delphoto}`); await draw(); }
    if (b.dataset.a === 'leave') { await A.api.post('/crews/leave', {}); await draw(); }
    if (b.dataset.a === 'crewShow') { const c = await A.api.get(`/crews/${b.dataset.id}`); $('crewMembers').innerHTML = `<ul>${c.members.map(m => `<li><a href="/account/profile.html?id=${esc(m.id)}">${esc(m.name)}</a> · ${t('profile.level')} ${i18n.number(m.level)} · ${t(`profile.role.${m.role}`)}</li>`).join('')}</ul>${c.inviteCode ? `<p class="muted">${t('profile.inviteIs', { code: esc(c.inviteCode) })}</p>` : ''}`; }
    if (b.dataset.a === 'share') { const r = await share({ url: `${location.origin}/account/profile.html?id=${encodeURIComponent(A.me.id)}`, title: t('profile.shareTitle') }); if (r === 'copied') say(t('common.copied')); }
    if (b.dataset.beat) { const r = await share({ url: shareLink({ kind: 'challenge', code: b.dataset.beat, ms: Number(b.dataset.ms), by: A.me.displayName, carClass: b.dataset.class || null }), title: t('profile.challengeTitle') }); if (r === 'copied') say(t('common.copied')); }
  } catch (err) { say(err.message); }
});
await draw();

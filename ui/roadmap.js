// The Roadmap screen (docs/ROADMAP.md): what's being worked on — the team's features and bug fixes, and players' ideas
// an admin has accepted — each with its votes; a player votes for what they want most and shares ideas of their own,
// which wait for an admin (only their author sees them until then, and why, if one wasn't taken).
//
//   openRoadmap()      closeRoadmap()      roadmapOpen()      (also: the dock's Roadmap tile)

import { account } from '../account/session.js';
import { t } from './i18n.js';

const CSS = `
/* (the page's own styles for sections, buttons, inputs… don't reach in: everything here is set below) */
#rmBoard, #rmBoard * { all: revert; box-sizing: border-box; }
#rmBoard { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; background: rgba(6, 8, 12, .66); backdrop-filter: blur(3px); font: 500 14px/1.45 Barlow, system-ui, sans-serif; color: #e9ecef; }
#rmBoard .panel { position: relative; width: min(860px, calc(100vw - 32px)); height: min(720px, calc(100vh - 32px)); display: flex; flex-direction: column; border-radius: 14px; background: #12161b; border: 1px solid #2a323b; box-shadow: 0 30px 80px rgba(0, 0, 0, .6); overflow: hidden; }
#rmBoard header { padding: 18px 22px 10px; border-bottom: 1px solid #222a32; }
#rmBoard h2 { margin: 0; font: 800 24px/1.1 Barlow, system-ui, sans-serif; letter-spacing: .02em; }
#rmBoard header p { margin: 4px 0 10px; color: #9aa6b2; }
#rmBoard .close { position: absolute; top: 12px; right: 12px; width: 34px; height: 34px; border: 0; border-radius: 8px; background: #222a32; color: #e9ecef; font: 400 20px 'Material Symbols Outlined'; cursor: pointer; }
#rmBoard .filters { display: flex; flex-wrap: wrap; gap: 6px; }
#rmBoard .filters button { padding: 5px 11px; border: 1px solid #333c46; border-radius: 14px; background: transparent; color: #c4ccd4; font: 600 13px Barlow, system-ui, sans-serif; cursor: pointer; }
#rmBoard .filters button.on { background: #f0b429; border-color: #f0b429; color: #12161b; }
#rmBoard .list { flex: 1; overflow-y: auto; padding: 12px 22px 18px; }
#rmBoard .item { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 12px 14px; margin-bottom: 8px; border-radius: 10px; background: #1a2027; border: 1px solid #262e37; }
#rmBoard .item b.title { display: block; font: 700 16px/1.25 Barlow, system-ui, sans-serif; color: #fff; }
#rmBoard .item .body { margin-top: 4px; color: #c4ccd4; white-space: pre-wrap; word-break: break-word; }
#rmBoard .item .meta { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; color: #8996a3; font-size: 12px; }
#rmBoard .tag { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; background: #2a323b; color: #c4ccd4; }
#rmBoard .tag.feature { background: #1f3a5c; color: #9cc7ff; } #rmBoard .tag.bug { background: #5c2424; color: #ffaaa0; } #rmBoard .tag.idea { background: #4a3a12; color: #ffd27a; }
#rmBoard .tag.working { background: #1f4a2e; color: #8de0a6; } #rmBoard .tag.done { background: #2a323b; color: #8de0a6; } #rmBoard .tag.pending { background: #3a3550; color: #c9bfff; } #rmBoard .tag.rejected { background: #3a2a2a; color: #d0a0a0; }
#rmBoard .note { margin-top: 6px; padding: 6px 9px; border-left: 3px solid #f0b429; background: rgba(240, 180, 41, .08); color: #e0d2b0; font-size: 13px; }
#rmBoard .vote { min-width: 58px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; padding: 6px 8px; border: 1px solid #333c46; border-radius: 10px; background: #12161b; color: #c4ccd4; font: 700 16px Barlow, system-ui, sans-serif; cursor: pointer; }
#rmBoard .vote .ic { font: 400 22px/1 'Material Symbols Outlined'; }
#rmBoard .vote.on { background: #f0b429; border-color: #f0b429; color: #12161b; }
#rmBoard .vote:disabled { cursor: default; opacity: .7; }
#rmBoard h3 { margin: 18px 0 8px; font: 700 15px Barlow, system-ui, sans-serif; color: #9aa6b2; text-transform: uppercase; letter-spacing: .06em; }
#rmBoard form { display: grid; gap: 8px; padding: 12px 14px; border-radius: 10px; background: #161b21; border: 1px dashed #333c46; }
#rmBoard input, #rmBoard textarea { width: 100%; font: 500 14px Barlow, system-ui, sans-serif; color: #e9ecef; background: #07090b; border: 1px solid #333c46; border-radius: 6px; padding: 8px; }
#rmBoard textarea { resize: vertical; min-height: 64px; }
#rmBoard form .row { display: flex; gap: 8px; align-items: center; } #rmBoard form small { flex: 1; color: #8996a3; }
#rmBoard .send { padding: 8px 16px; border: 0; border-radius: 8px; background: #f0b429; color: #12161b; font: 700 14px Barlow, system-ui, sans-serif; cursor: pointer; }
#rmBoard .send:disabled { opacity: .6; cursor: default; }
#rmBoard .muted { color: #8996a3; } #rmBoard .err { color: #ff8a7a; font-weight: 600; } #rmBoard .good { color: #8de0a6; font-weight: 600; }
@media (max-width: 600px) { #rmBoard .panel { width: calc(100vw - 16px); height: calc(100vh - 16px); } #rmBoard header, #rmBoard .list { padding-left: 14px; padding-right: 14px; } }
`;
// the filters: which items each shows
export const FILTERS = {
  all: () => true, working: i => i.status === 'working', planned: i => i.status === 'planned',
  ideas: i => i.kind === 'idea' && i.status !== 'done', bugs: i => i.kind === 'bug' && i.status !== 'done', done: i => i.status === 'done',
};
// (what's being worked on first, then planned, then open; most votes first in each; done at the end)
const ORDER = ['working', 'planned', 'open', 'done'];
export const sortBoard = list => [...list].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.votes - a.votes || String(b.createdAt).localeCompare(String(a.createdAt)));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// (a message, ready for the page: its words from locales/en.json, escaped)
const T = (key, vars) => esc(t(key, vars));

let el = null, view = null, filter = 'all', error = '', sent = '', busy = false, A = null;

async function api() {
  A ??= await account().catch(() => null);
  return A?.server ? A.api : null;
}
async function load() {
  try {
    const a = await api();
    if (!a) { view = null; error = t('roadmap.offline'); return; }
    view = await a.get('/roadmap', { retries: 1 }); error = '';
  } catch (e) { error = e.message || t('roadmap.offline'); }
  // (the board as last seen is drawn at once on opening; data-state="ready" once the server's own is in: what a test waits for)
  finally { if (el) el.dataset.state = 'ready'; draw(); }
}

export function openRoadmap() {
  if (!document.getElementById('rmBoardCss')) { const s = document.createElement('style'); s.id = 'rmBoardCss'; s.textContent = CSS; document.head.append(s); }
  if (!el) {
    el = document.createElement('div');
    el.id = 'rmBoard'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', t('roadmap.title'));
    el.addEventListener('click', onClick);
    el.addEventListener('submit', onSubmit);
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeRoadmap(); } });
    el.dataset.state = 'loading';
    document.body.append(el);
    void load();
  }
  draw();
  el.querySelector('.close')?.focus();
}
export function closeRoadmap() { el?.remove(); el = null; error = ''; sent = ''; }
export const roadmapOpen = () => !!el;

async function onClick(e) {
  if (e.target === el) return closeRoadmap();
  const b = e.target.closest('[data-act]');
  if (!b) return;
  e.preventDefault();
  const act = b.dataset.act;
  if (act === 'close') return closeRoadmap();
  if (act === 'filter') { filter = b.dataset.f; return draw(); }
  if (act === 'vote' && view && !busy) {
    const it = view.items.find(i => i.id === b.dataset.id);
    if (!it) return;
    busy = true;
    // (shown at once; the server's count after)
    const was = { votes: it.votes, voted: it.voted };
    it.voted = !it.voted; it.votes += it.voted ? 1 : -1; draw();
    try {
      const a = await api(), r = it.voted ? await a.post(`/roadmap/${it.id}/vote`, {}) : await a.del(`/roadmap/${it.id}/vote`);
      Object.assign(it, r); error = '';
    } catch (err) { Object.assign(it, was); error = err.message; }
    finally { busy = false; draw(); }
  }
}
async function onSubmit(e) {
  e.preventDefault();
  const f = e.target, title = f.elements.title.value.trim(), body = f.elements.body.value.trim();
  if (busy) return;
  busy = true; sent = ''; draw();
  try {
    const idea = await (await api()).post('/roadmap/ideas', { title, body });
    view.mine = [idea, ...(view.mine ?? [])]; sent = t('roadmap.sent'); error = '';
    el?.querySelector('form')?.reset();
  } catch (err) { error = err.message; }
  finally { busy = false; draw(); }
}

function itemHtml(i, { mine = false } = {}) {
  const canVote = view?.canPost && !mine && i.status !== 'done';
  const vote = mine ? '' : `<button class="vote${i.voted ? ' on' : ''}" data-act="vote" data-id="${esc(i.id)}" ${canVote && !busy ? '' : 'disabled'} aria-pressed="${i.voted}" title="${T(i.voted ? 'roadmap.unvote' : 'roadmap.vote')}"><span class="ic" aria-hidden="true">arrow_upward</span>${i.votes}</button>`;
  return `<div class="item"><div>
    <b class="title">${esc(i.title)}</b>${i.body ? `<div class="body">${esc(i.body)}</div>` : ''}
    <div class="meta"><span class="tag ${esc(i.kind)}">${T(`roadmap.kind.${i.kind}`)}</span><span class="tag ${esc(i.status)}">${T(`roadmap.status.${i.status}`)}</span>${i.author ? `<span>${T('roadmap.from', { name: i.author })}</span>` : ''}</div>
    ${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}
  </div>${vote}</div>`;
}

function draw() {
  if (!el) return;
  const items = sortBoard((view?.items ?? []).filter(FILTERS[filter] ?? FILTERS.all));
  const focus = document.activeElement, keep = focus && el.contains(focus) && focus.name ? { name: focus.name, value: focus.value, start: focus.selectionStart } : null;
  const draft = el.querySelector('form') ? { title: el.querySelector('form').elements.title.value, body: el.querySelector('form').elements.body.value } : null;
  const form = !view ? '' : view.canPost
    ? `<form><input name="title" maxlength="80" minlength="6" required placeholder="${T('roadmap.ideaTitle')}"><textarea name="body" maxlength="1000" placeholder="${T('roadmap.ideaBody')}"></textarea>
       <div class="row"><small>${T('roadmap.ideaNote')}</small><button class="send" type="submit" ${busy ? 'disabled' : ''}>${T('roadmap.send')}</button></div></form>`
    : `<p class="muted">${T(view.signedIn ? 'roadmap.fullAccount' : 'roadmap.signIn')}</p>`;
  el.innerHTML = `<div class="panel">
    <button class="close" data-act="close" aria-label="${T('roadmap.close')}"><span aria-hidden="true">close</span></button>
    <header><h2>${T('roadmap.title')}</h2><p>${T('roadmap.subtitle')}</p>
      <div class="filters" role="tablist">${Object.keys(FILTERS).map(f => `<button data-act="filter" data-f="${f}" role="tab" aria-selected="${f === filter}" class="${f === filter ? 'on' : ''}">${T(`roadmap.filter.${f}`)}</button>`).join('')}</div></header>
    <div class="list">
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      ${!view && !error ? `<p class="muted">${T('roadmap.loading')}</p>` : ''}
      ${view ? (items.length ? items.map(i => itemHtml(i)).join('') : `<p class="muted">${T('roadmap.empty')}</p>`) : ''}
      ${view?.mine?.length ? `<h3>${T('roadmap.yourIdeas')}</h3>${view.mine.map(i => itemHtml(i, { mine: true })).join('')}` : ''}
      ${view ? `<h3>${T('roadmap.shareIdea')}</h3>${sent ? `<p class="good">${esc(sent)}</p>` : ''}${form}` : ''}
    </div></div>`;
  // (what was being typed stays as it was)
  const f = el.querySelector('form');
  if (f && draft) { f.elements.title.value = draft.title; f.elements.body.value = draft.body; }
  if (keep) { const x = el.querySelector(`[name="${keep.name}"]`); if (x) { x.focus(); try { x.setSelectionRange(keep.start, keep.start); } catch { /* (not a text field) */ } } }
}

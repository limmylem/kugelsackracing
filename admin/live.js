// The admin page's live updates and statistics (Phase 8 Step 4; docs/LIVE_UPDATES.md, docs/ANALYTICS.md):
//   Live        news, patch notes, planned maintenance and outage notices (shown on the menu, in the game's news panel;
//               a patch note also once, after the update, to each player who hasn't seen it) and the event calendar
//               (events, meets, tournaments; free-roam meets from the Free roam tab are on it too). Drafts until
//               published; every change is logged.
//   Statistics  what players who agreed to share it did (server/src/routes/launch.ts /admin/analytics): players and
//               sessions, the tutorial and first steps, where new players stop, quests, tracks, the driving school,
//               coming back after 1 and 7 days, frame rates by device, errors and crashes by version.
// Everything typed (by admins or players) is shown as text.

export function createLiveTools({ api, h, say, when, errText, main }) {
  const table = (head, rows) => rows.length ? h('table', {}, h('thead', {}, h('tr', {}, ...head.map(x => h('th', {}, x)))), h('tbody', {}, ...rows)) : h('p', { class: 'muted' }, 'Nothing yet.');
  // (datetime-local inputs are in the admin's own time; the server keeps UTC)
  const toLocal = iso => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
  const fromLocal = v => v ? new Date(v).toISOString() : null;
  const KINDS = { news: 'News', patch: 'Patch notes', maintenance: 'Planned maintenance', outage: 'Outage' };
  const EVENT_KINDS = { event: 'Event', meet: 'Meet', tournament: 'Tournament' };

  // ---------- live: news, patch notes, maintenance notices; the calendar ----------
  async function showLive() {
    const box = main(), msg = h('div'), news = h('div'), cal = h('div'), newsForm = h('div'), calForm = h('div');
    box.replaceChildren(
      h('section', {}, h('h2', {}, 'News, patch notes and notices'),
        h('p', { class: 'muted' }, 'Published items show on the menu\'s news panel between their start and end. A patch note is shown once to each player after the update; planned maintenance shows as a banner until it ends (switching the server to maintenance is on the Launch tab).'),
        msg, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => editNews(null) }, 'New item')), newsForm, news),
      h('section', {}, h('h2', {}, 'Event calendar'),
        h('p', { class: 'muted' }, 'Events, meets and tournaments for the next 60 days. Players see them on the news panel and can say they\'re going.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => editEvent(null) }, 'New event')), calForm, cal));

    async function load() {
      try {
        const [N, C] = await Promise.all([api.get('/admin/news'), api.get('/calendar')]);
        news.replaceChildren(table(['Starts', 'Kind', 'Title', 'Ends', 'Shown', ''], N.items.map(it => h('tr', {},
          h('td', { class: 'when' }, when(it.startsAt)), h('td', {}, KINDS[it.kind] ?? it.kind), h('td', {}, it.title, it.version ? h('span', { class: 'muted' }, ` · ${it.version}`) : null),
          h('td', { class: 'when' }, when(it.endsAt)), h('td', {}, it.published ? 'published' : 'draft'),
          h('td', {}, h('button', { class: 'btn ghost', onclick: () => editNews(it) }, 'Edit'), h('button', { class: 'btn ghost', onclick: () => del('news', it) }, 'Delete'))))));
        cal.replaceChildren(table(['Starts', 'Ends', 'Kind', 'Title', 'Going', ''], C.events.map(ev => h('tr', {},
          h('td', { class: 'when' }, when(ev.startsAt)), h('td', { class: 'when' }, when(ev.endsAt)), h('td', {}, EVENT_KINDS[ev.kind] ?? ev.kind),
          h('td', {}, ev.title, ev.cancelled ? h('b', { style: 'color:var(--c-bad)' }, ' (cancelled)') : null), h('td', {}, String(ev.going)),
          h('td', {}, ev.id.startsWith('meet:') ? h('span', { class: 'muted' }, 'a free-roam meet (Free roam tab)')
            : [h('button', { class: 'btn ghost', onclick: () => editEvent(ev) }, 'Edit'), h('button', { class: 'btn ghost', onclick: () => del('calendar', ev) }, 'Delete')])))));
      } catch (e) { say(msg, errText(e)); }
    }
    async function del(what, it) {
      if (!confirm(`Delete “${it.title}”?`)) return;
      try { await api.del(`/admin/${what}/${it.id}`); say(msg, 'Deleted.', true); load(); } catch (e) { say(msg, errText(e)); }
    }
    function editNews(it) {
      const f = {
        kind: h('select', {}, ...Object.entries(KINDS).map(([k, v]) => h('option', { value: k, selected: it?.kind === k }, v))),
        title: h('input', { maxlength: 120, value: it?.title ?? '', required: true }),
        version: h('input', { maxlength: 40, value: it?.version ?? '', placeholder: 'patch notes: the deploy\'s commit, e.g. 2de0f3f' }),
        body: h('textarea', { rows: 8, maxlength: 4000, placeholder: 'Plain text. A line starting with "- " is a list item.' }, it?.body ?? ''),
        link: h('input', { maxlength: 300, value: it?.link ?? '', placeholder: 'optional: /?quest=…, /?track=…, https://…' }),
        starts: h('input', { type: 'datetime-local', value: toLocal(it?.startsAt) }),
        ends: h('input', { type: 'datetime-local', value: toLocal(it?.endsAt) }),
        published: h('input', { type: 'checkbox', checked: !!it?.published }),
      };
      const fmsg = h('div');
      const save = async () => {
        const body = { kind: f.kind.value, title: f.title.value.trim(), body: f.body.value, version: f.version.value.trim() || null, link: f.link.value.trim() || null, startsAt: fromLocal(f.starts.value), endsAt: fromLocal(f.ends.value), published: f.published.checked };
        try { it ? await api.put(`/admin/news/${it.id}`, body) : await api.post('/admin/news', body); newsForm.replaceChildren(); say(msg, body.published ? 'Saved and published.' : 'Saved as a draft.', true); load(); }
        catch (e) { say(fmsg, errText(e)); }
      };
      newsForm.replaceChildren(h('fieldset', {}, h('legend', {}, it ? `Edit “${it.title}”` : 'A new item'),
        h('div', { class: 'row' }, h('label', {}, 'Kind ', f.kind), h('label', {}, 'Version ', f.version)),
        h('label', {}, 'Title ', f.title), h('label', {}, 'Text ', f.body), h('label', {}, 'Link ', f.link),
        h('div', { class: 'row' }, h('label', {}, 'Shown from ', f.starts), h('label', {}, 'until ', f.ends)),
        h('p', { class: 'muted' }, 'Empty “from” is now; empty “until” keeps it up. Planned maintenance: from when players should be told, until the work is done.'),
        h('label', {}, f.published, ' Published'), fmsg,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Save'), h('button', { class: 'btn ghost', onclick: () => newsForm.replaceChildren() }, 'Cancel'))));
      f.title.focus();
    }
    function editEvent(ev) {
      const f = {
        kind: h('select', {}, ...Object.entries(EVENT_KINDS).map(([k, v]) => h('option', { value: k, selected: ev?.kind === k }, v))),
        title: h('input', { maxlength: 120, value: ev?.title ?? '' }),
        body: h('textarea', { rows: 4, maxlength: 2000 }, ev?.body ?? ''),
        link: h('input', { maxlength: 300, value: ev?.link ?? '', placeholder: 'optional: /?meet=…, /?track=…' }),
        region: h('input', { maxlength: 40, value: ev?.region ?? '', placeholder: 'optional: sf, sydney, …' }),
        starts: h('input', { type: 'datetime-local', value: toLocal(ev?.startsAt) }),
        ends: h('input', { type: 'datetime-local', value: toLocal(ev?.endsAt) }),
        cancelled: h('input', { type: 'checkbox', checked: !!ev?.cancelled }),
      };
      const fmsg = h('div');
      const save = async () => {
        const body = { kind: f.kind.value, title: f.title.value.trim(), body: f.body.value, link: f.link.value.trim() || null, region: f.region.value.trim() || null, startsAt: fromLocal(f.starts.value), endsAt: fromLocal(f.ends.value), cancelled: f.cancelled.checked };
        if (!body.startsAt || !body.endsAt) return say(fmsg, 'An event needs a start and an end.');
        try { ev ? await api.put(`/admin/calendar/${ev.id}`, body) : await api.post('/admin/calendar', body); calForm.replaceChildren(); load(); }
        catch (e) { say(fmsg, errText(e)); }
      };
      calForm.replaceChildren(h('fieldset', {}, h('legend', {}, ev ? `Edit “${ev.title}”` : 'A new event'),
        h('div', { class: 'row' }, h('label', {}, 'Kind ', f.kind), h('label', {}, 'Region ', f.region)),
        h('label', {}, 'Title ', f.title), h('label', {}, 'About it ', f.body), h('label', {}, 'Link ', f.link),
        h('div', { class: 'row' }, h('label', {}, 'Starts ', f.starts), h('label', {}, 'Ends ', f.ends)),
        h('label', {}, f.cancelled, ' Cancelled (stays on the calendar, marked)'), fmsg,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Save'), h('button', { class: 'btn ghost', onclick: () => calForm.replaceChildren() }, 'Cancel'))));
      f.title.focus();
    }
    load();
  }

  // ---------- statistics ----------
  async function showAnalytics(days = 30) {
    const box = main(), sec = h('section', { style: 'grid-column: 1 / -1' });
    box.replaceChildren(sec);
    const daysSel = h('select', { onchange: e => showAnalytics(Number(e.target.value)) }, ...[7, 30, 90, 400].map(d => h('option', { value: d, selected: d === days }, `the last ${d} days`)));
    sec.replaceChildren(h('h2', {}, 'Statistics'), h('p', { class: 'muted' }, 'Loading…'));
    let d;
    try { d = await api.get(`/admin/analytics?days=${days}`); }
    catch (e) { return sec.replaceChildren(h('h2', {}, 'Statistics'), h('div', { class: 'msg bad' }, errText(e))); }
    const pct = (a, b) => b ? `${Math.round(a / b * 100)}%` : '—';
    const T = d.totals ?? { players: 0, sessions: 0, events: 0 };
    sec.replaceChildren(
      h('h2', {}, 'Statistics'),
      h('div', { class: 'row' }, h('label', {}, 'Over ', daysSel)),
      h('p', { class: 'muted' }, 'Only from players who agreed to share it (asked once; changed any time in Settings → Privacy). Nobody is named: each player is a number made on the server, without their account or address. Kept 400 days.'),
      h('dl', {}, h('dt', {}, 'Players'), h('dd', {}, String(T.players)), h('dt', {}, 'Sessions'), h('dd', {}, String(T.sessions)), h('dt', {}, 'Events'), h('dd', {}, String(T.events))),
      h('h3', {}, 'Errors and crashes by version'),
      table(['Version', 'Sessions', 'With an error', 'Error rate', 'Crashed', 'Crash rate', 'Errors'], d.errors.map(r => h('tr', {},
        h('td', {}, r.version), h('td', {}, String(r.sessions)), h('td', {}, String(r.with_errors)), h('td', {}, pct(r.with_errors, r.sessions)),
        h('td', {}, String(r.crashed)), h('td', { style: r.crashed / Math.max(1, r.sessions) > 0.02 ? 'color:var(--c-bad)' : '' }, pct(r.crashed, r.sessions)), h('td', {}, String(r.errors))))),
      h('h3', {}, 'The commonest errors'),
      table(['Message', 'Version', 'Times'], d.topErrors.map(r => h('tr', {}, h('td', {}, r.message), h('td', {}, r.version), h('td', {}, String(r.n))))),
      h('h3', {}, 'Accessibility and language choices (players who changed a setting; each one\'s latest)'),
      d.access?.players ? table(['Choice', 'Players', 'Share'], [['Bigger text', 'bigger_text'], ['High contrast', 'high_contrast'], ['Colour-blind colours', 'colour_blind'], ['Reduced motion', 'reduced_motion'], ['Full flashing (not reduced)', 'full_flashing'], ['Sounds shown on screen', 'sound_cues'], ['Toggle instead of hold', 'toggles'], ['Imperial units', 'imperial']].map(([label, k]) => h('tr', {}, h('td', {}, label), h('td', {}, String(d.access[k])), h('td', {}, pct(d.access[k], d.access.players))))) : h('p', { class: 'muted' }, 'Nothing yet.'),
      h('h3', {}, 'The tutorial (players reaching each step)'),
      table(['Step', 'Players'], d.tutorial.map(r => h('tr', {}, h('td', {}, r.name ?? '—'), h('td', {}, String(r.players))))),
      h('h3', {}, 'First steps (done or skipped)'),
      table(['Step', 'How', 'Players'], d.firsts.map(r => h('tr', {}, h('td', {}, r.name ?? '—'), h('td', {}, r.state ?? '—'), h('td', {}, String(r.players))))),
      h('h3', {}, 'Where new players stopped (their last screen or step, not back after a day)'),
      table(['What', 'Which', 'Players'], d.quits.map(r => h('tr', {}, h('td', {}, r.kind), h('td', {}, r.name || '—'), h('td', {}, String(r.players))))),
      h('h3', {}, 'Coming back'),
      table(['First day', 'New players', 'Back the next day', 'Back a week later'], d.retention.map(r => h('tr', {},
        h('td', { class: 'when' }, String(r.day).slice(0, 10)), h('td', {}, String(r.new_players)), h('td', {}, `${r.d1} (${pct(r.d1, r.new_players)})`), h('td', {}, `${r.d7} (${pct(r.d7, r.new_players)})`)))),
      h('h3', {}, 'Quests'),
      table(['Quest', 'Started', 'Finished', 'Finish rate'], d.quests.map(r => h('tr', {}, h('td', {}, r.name), h('td', {}, String(r.started)), h('td', {}, String(r.finished)), h('td', {}, pct(r.finished, r.started))))),
      h('h3', {}, 'Tracks played'),
      table(['Track', 'Plays'], d.tracks.map(r => h('tr', {}, h('td', {}, r.name), h('td', {}, String(r.plays))))),
      h('h3', {}, 'The driving school'),
      table(['Lesson', 'Medal', 'Tries'], d.school.map(r => h('tr', {}, h('td', {}, r.name ?? '—'), h('td', {}, r.medal ?? '—'), h('td', {}, String(r.n))))),
      h('h3', {}, 'Frame rates by device (the median of each sample)'),
      table(['Quality tier', 'Browser', 'Samples', 'Frames a second', 'Worst 1%'], d.perf.map(r => h('tr', {}, h('td', {}, r.tier), h('td', {}, r.browser), h('td', {}, String(r.samples)), h('td', {}, String(r.fps)), h('td', {}, String(r.low1))))));
  }

  return { showLive, showAnalytics };
}

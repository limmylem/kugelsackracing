// The admin page's Roadmap tab (docs/ROADMAP.md):
//   Waiting      players' ideas no one else sees yet: accept (as open, planned, being worked on) or reject, with a note
//                its author sees
//   On the board the features, bugs and accepted ideas players see and vote for: edited, moved along, deleted
//   Add          a feature or bug of the team's own
// Every change is in the admins' log. Everything typed by players is shown as text.

export const KINDS = ['feature', 'bug', 'idea'];
export const STATUSES = ['pending', 'rejected', 'open', 'planned', 'working', 'done'];
export const STATUS_LABEL = { pending: 'Waiting for an admin', rejected: 'Rejected', open: 'Open for votes', planned: 'Planned', working: 'Being worked on', done: 'Done' };
// what an item is sent back as (the server's body: kind, title, body, status, note)
export const bodyOf = (it, change = {}) => ({ kind: it.kind, title: it.title, body: it.body ?? '', status: it.status, note: it.note ?? null, ...change });
// the board's order: waiting first, then what's being worked on, planned, open (most votes first), done, rejected
const ORDER = ['pending', 'working', 'planned', 'open', 'done', 'rejected'];
export const sortItems = list => [...list].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.votes - a.votes || String(b.createdAt).localeCompare(String(a.createdAt)));

export function createRoadmapTools({ api, h, say, when, errText, main }) {
  const sel = (options, value, labels = {}) => h('select', {}, ...options.map(o => h('option', { value: o, ...(o === value ? { selected: '' } : {}) }, labels[o] ?? o)));
  const table = (head, rows) => h('table', {}, h('tr', {}, ...head.map(x => h('th', {}, x))), ...rows);

  async function showRoadmap() {
    const box = main(), msg = h('div'), waiting = h('div'), onBoard = h('div');
    let filter = 'shown';
    const filterSel = sel(['shown', 'all', ...STATUSES], filter, { shown: 'What players see', all: 'Everything', ...STATUS_LABEL });
    filterSel.onchange = e => { filter = e.target.value; load(); };

    // ---------- add a feature or bug ----------
    const kind = sel(['feature', 'bug'], 'feature'), status = sel(['open', 'planned', 'working', 'done'], 'working', STATUS_LABEL);
    const title = h('input', { placeholder: 'Title (what players see)', maxlength: 80, style: 'min-width:320px' }), body = h('textarea', { placeholder: 'A line or two about it (optional)', maxlength: 1000, rows: 2, style: 'width:100%' });
    const add = h('button', { class: 'btn', onclick: async () => {
      try { await api.post('/admin/roadmap', { kind: kind.value, title: title.value, body: body.value, status: status.value, note: null }); title.value = ''; body.value = ''; say(msg, 'Added: players see it now.', true); load(); } catch (e) { say(msg, errText(e)); }
    } }, 'Add to the board');

    box.replaceChildren(h('section', { style: 'grid-column: 1 / -1' }, h('h2', {}, 'Roadmap'),
      h('p', { class: 'muted' }, 'What players see in the game\'s Roadmap: the features and bugs being worked on, and their ideas once accepted here. Players vote for what they want most.'), msg,
      h('h3', {}, 'Players\' ideas waiting for you'), waiting,
      h('h3', {}, 'Add a feature or bug'), h('div', { class: 'row' }, kind, title, status, add), body,
      h('h3', {}, 'On the board'), h('div', { class: 'row' }, h('label', {}, 'Show ', filterSel)), onBoard));

    const save = async (it, change, done = 'Saved.') => { try { await api.put(`/admin/roadmap/${it.id}`, bodyOf(it, change)); say(msg, done, true); load(); } catch (e) { say(msg, errText(e)); } };
    const reject = it => { const note = prompt(`Reject "${it.title}"?\n\nA short note for ${it.author ?? 'its author'} (optional: they see it, nobody else does):`); if (note === null) return; save(it, { status: 'rejected', note: note.trim() || null }, 'Rejected: only its author sees it, with your note.'); };
    const edit = it => {
      const t = h('input', { value: it.title, maxlength: 80, style: 'width:100%' }), b = h('textarea', { rows: 3, maxlength: 1000, style: 'width:100%' }, it.body ?? ''), n = h('input', { value: it.note ?? '', maxlength: 300, placeholder: 'A note players see (optional)', style: 'width:100%' });
      const k = sel(KINDS, it.kind), s = sel(STATUSES, it.status, STATUS_LABEL);
      return h('div', {}, t, b, n, h('div', { class: 'row' }, k, s,
        h('button', { class: 'btn', onclick: () => save(it, { title: t.value, body: b.value, note: n.value.trim() || null, kind: k.value, status: s.value }) }, 'Save'),
        h('button', { class: 'btn ghost', onclick: () => load() }, 'Cancel')));
    };
    const row = (it, buttons) => {
      const cell = h('td', {}, h('b', {}, it.title), it.body ? h('div', { style: 'white-space:pre-wrap' }, it.body) : null, it.note ? h('div', { class: 'muted' }, `Note: ${it.note}`) : null);
      return h('tr', {}, h('td', { class: 'when' }, when(it.createdAt)), h('td', {}, it.kind), h('td', {}, it.author ?? 'the team'), cell, h('td', {}, STATUS_LABEL[it.status] ?? it.status), h('td', {}, String(it.votes)),
        h('td', {}, h('div', { class: 'row' }, ...buttons(it, cell))));
    };
    const editBtn = (it, cell) => h('button', { class: 'btn ghost', onclick: () => cell.replaceChildren(edit(it)) }, 'Edit');
    const delBtn = it => h('button', { class: 'btn ghost', onclick: async () => { if (!confirm(`Delete "${it.title}" and its votes? This can't be undone.`)) return; try { await api.del(`/admin/roadmap/${it.id}`); say(msg, 'Deleted.', true); load(); } catch (e) { say(msg, errText(e)); } } }, 'Delete');

    async function load() {
      try {
        const r = await api.get('/admin/roadmap?status=all');
        const pend = r.items.filter(i => i.status === 'pending');
        waiting.replaceChildren(pend.length ? table(['Sent', 'Kind', 'From', 'Idea', 'Status', 'Votes', ''], sortItems(pend).map(it => row(it, (it, cell) => [
          h('button', { class: 'btn', onclick: () => save(it, { status: 'open' }, 'Accepted: players see it and can vote.') }, 'Accept'),
          h('button', { class: 'btn secondary', onclick: () => save(it, { status: 'planned' }, 'Accepted as planned.') }, 'Accept as planned'),
          h('button', { class: 'btn ghost', onclick: () => reject(it) }, 'Reject'), editBtn(it, cell)]))) : h('p', { class: 'muted' }, 'No ideas waiting.'));
        const shown = r.items.filter(i => i.status !== 'pending' && (filter === 'all' || (filter === 'shown' ? !['rejected'].includes(i.status) : i.status === filter)));
        onBoard.replaceChildren(shown.length ? table(['Added', 'Kind', 'From', 'Item', 'Status', 'Votes', ''], sortItems(shown).map(it => row(it, (it, cell) => [
          it.status !== 'done' ? h('button', { class: 'btn secondary', onclick: () => save(it, { status: { open: 'planned', planned: 'working', working: 'done', rejected: 'open' }[it.status] ?? 'open' }) }, { open: 'Plan it', planned: 'Start it', working: 'Mark done', rejected: 'Accept after all' }[it.status] ?? 'Open') : null,
          editBtn(it, cell), delBtn(it)]))) : h('p', { class: 'muted' }, 'Nothing here.'));
      } catch (e) { say(msg, errText(e)); }
    }
    load();
  }
  return { showRoadmap };
}

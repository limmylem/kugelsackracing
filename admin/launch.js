// The admin page's launch tools (Phase 6 Step 5; docs/ABUSE.md, docs/OPERATIONS.md, docs/SUPPORT.md):
//   Reports & flags   players' reports and the abuse scan's flags — each reviewed with a reason (logged)
//   Support           "Contact support" and feedback messages: read, answer by email, close
//   Launch            maintenance and its message, features on and off, the closed beta and its invite codes, the
//                     oldest game the server takes
//   history(id)       one player's whole history (ledger, results, reports, flags, support, admin actions)
// Everything typed by players is shown as text.

export function createLaunchTools({ api, h, say, when, errText, main, pickPlayer }) {
  const ask = (text, min = 3) => { const v = prompt(`${text}\n\nWhy? (required: it goes in the log)`); return v && v.trim().length >= min ? v.trim() : null; };
  const pre = obj => h('pre', { style: 'margin:0;white-space:pre-wrap;font:12px var(--f-mono);color:var(--c-text-2)' }, JSON.stringify(obj, null, 1));
  const table = (head, rows) => h('table', {}, h('tr', {}, ...head.map(x => h('th', {}, x))), ...rows);
  const who = p => p ? h('a', { href: '#', onclick: e => { e.preventDefault(); history(p.id); } }, p.name ?? p.id) : '—';

  // ---------- reports and flags ----------
  async function showReports() {
    const box = main(), msg = h('div'), reports = h('div'), flags = h('div');
    let status = 'open';
    const statusSel = h('select', { onchange: e => { status = e.target.value; load(); } }, ...['open', 'resolved', 'all'].map(s => h('option', { value: s }, s)));
    box.replaceChildren(
      h('section', {}, h('h2', {}, 'Reports'), h('div', { class: 'row' }, h('label', {}, 'Show', statusSel)), msg, reports),
      h('section', {}, h('h2', {}, 'Flagged accounts'), h('p', { class: 'muted' }, 'From the hourly scan: accounts sharing a browser, sign-up bursts from one address, groups feeding one account, earnings faster than the game pays. Nothing is done to anyone by this: look, then act on the player\'s page if it\'s real.'),
        h('div', { class: 'row' }, h('button', { class: 'btn secondary', onclick: async () => { try { const r = await api.post('/admin/abuse/scan'); say(msg, `Scanned: ${r.flagged} flag${r.flagged === 1 ? '' : 's'} seen.`, true); load(); } catch (e) { say(msg, errText(e)); } } }, 'Scan now')), flags));
    async function load() {
      try {
        const r = await api.get(`/admin/reports?status=${status === 'resolved' ? 'resolved' : status}`);
        reports.replaceChildren(r.reports.length ? table(['When', 'Who', 'What', 'By', ''], r.reports.map(x => h('tr', {},
          h('td', { class: 'when' }, when(x.createdAt)),
          h('td', {}, who({ id: x.target.id, name: x.target.name }), x.target.name !== x.target.nameReported ? h('div', { class: 'muted' }, `reported as ${x.target.nameReported}`) : null, h('div', { class: 'muted' }, `${x.target.openReporters} reporting now · ${x.target.reports} ever${x.target.banned ? ' · banned' : ''}`)),
          h('td', {}, h('b', {}, x.kind), h('div', {}, x.details), x.ref ? h('div', { class: 'muted' }, Object.entries(x.ref).map(([k, v]) => `${k}: ${v}`).join(' · ')) : null),
          h('td', {}, x.reporter ? who(x.reporter) : '(deleted)'),
          h('td', {}, x.status === 'open' ? h('div', { class: 'row' }, ...[['dismiss', 'Dismiss'], ['warn', 'Warned'], ['rename', 'Rename'], ['suspend', 'Suspend 7 days'], ['ban', 'Ban']].map(([a, label]) => h('button', { class: 'btn ghost', onclick: async () => {
            const note = ask(`${label} — ${x.target.name} (${x.kind})`); if (!note) return;
            try { const res = await api.post(`/admin/reports/${x.id}/resolve`, { action: a, note, ...(a === 'suspend' ? { days: 7 } : {}) }); say(msg, `Done: ${res.closed} report${res.closed === 1 ? '' : 's'} closed.`, true); load(); } catch (e) { say(msg, errText(e)); }
          } }, label))) : h('span', { class: 'muted' }, `${x.resolution} · ${x.note ?? ''}`))))) : h('p', { class: 'muted' }, 'No reports.'));
        const f = await api.get(`/admin/flags?status=${status === 'resolved' ? 'all' : status}`);
        flags.replaceChildren(f.flags.length ? table(['Score', 'What', 'Accounts', ''], f.flags.map(x => h('tr', {},
          h('td', {}, String(x.score)),
          h('td', {}, h('b', {}, x.kind), pre(x.evidence)),
          h('td', {}, ...x.accounts.map(a => h('div', {}, who(a), h('span', { class: 'muted' }, ` ${a.email ?? (a.guest ? 'guest' : '')} · since ${when(a.createdAt).split(',')[0]} · earned ${a.earned ?? 0}${a.banned ? ' · banned' : ''}${a.addresses?.length ? ` · ${a.addresses.join(', ')}` : ''}`)))),
          h('td', {}, x.status === 'open' ? h('div', { class: 'row' }, ...[['dismissed', 'Not abuse'], ['actioned', 'Dealt with']].map(([st, label]) => h('button', { class: 'btn ghost', onclick: async () => {
            const note = ask(`${label}: ${x.kind}`); if (!note) return;
            try { await api.post(`/admin/flags/${x.id}`, { status: st, note }); load(); } catch (e) { say(msg, errText(e)); }
          } }, label))) : h('span', { class: 'muted' }, `${x.status} · ${x.note ?? ''}`))))) : h('p', { class: 'muted' }, 'Nothing flagged.'));
      } catch (e) { say(msg, errText(e)); }
    }
    load();
  }

  // ---------- support and feedback ----------
  async function showSupport() {
    const box = main(), msg = h('div'), list = h('div');
    let kind = 'all', status = 'open';
    const sel = (opts, on) => h('select', { onchange: e => { on(e.target.value); load(); } }, ...opts.map(o => h('option', { value: o }, o)));
    box.replaceChildren(h('section', { style: 'grid-column: 1 / -1' }, h('h2', {}, 'Support and feedback'),
      h('div', { class: 'row' }, h('label', {}, 'Kind', sel(['all', 'support', 'feedback'], v => { kind = v; })), h('label', {}, 'Status', sel(['open', 'closed', 'all'], v => { status = v; }))), msg, list));
    async function load() {
      try {
        const r = await api.get(`/admin/support?kind=${kind}&status=${status}`);
        list.replaceChildren(r.tickets.length ? table(['When', 'From', 'Message', 'Game and device', ''], r.tickets.map(t => h('tr', {},
          h('td', { class: 'when' }, when(t.createdAt)),
          h('td', {}, t.player ? who(t.player) : '—', h('div', { class: 'muted' }, t.player?.email ?? '(no email)')),
          h('td', {}, h('b', {}, `${t.kind}${t.category ? ` · ${t.category}` : ''}`), h('div', { style: 'white-space:pre-wrap' }, t.message), t.note ? h('div', { class: 'muted', style: 'white-space:pre-wrap' }, t.note) : null),
          h('td', {}, pre(t.client)),
          h('td', {}, h('div', { class: 'row' },
            t.player?.email && h('button', { class: 'btn secondary', onclick: async () => { const text = prompt('Your answer (emailed to them):'); if (!text || text.trim().length < 3) return; try { await api.post(`/admin/support/${t.id}/reply`, { message: text.trim(), close: true }); say(msg, 'Sent, and closed.', true); load(); } catch (e) { say(msg, errText(e)); } } }, 'Answer'),
            h('button', { class: 'btn ghost', onclick: async () => { try { await api.post(`/admin/support/${t.id}`, { status: t.status === 'open' ? 'closed' : 'open', note: '' }); load(); } catch (e) { say(msg, errText(e)); } } }, t.status === 'open' ? 'Close' : 'Reopen')))))) : h('p', { class: 'muted' }, 'Nothing here.'));
      } catch (e) { say(msg, errText(e)); }
    }
    load();
  }

  // ---------- launch: maintenance, features, closed beta, invites, the oldest game ----------
  async function showLaunch() {
    const box = main(), msg = h('div');
    let S;
    try { S = await api.get('/admin/settings'); } catch (e) { box.replaceChildren(h('section', {}, h('div', { class: 'msg bad' }, errText(e)))); return; }
    const put = async (key, value) => { const reason = ask(`Change ${key}`); if (!reason) return; try { await api.put(`/admin/settings/${key}`, { key, value, reason }); say(msg, 'Saved: it applies within a few seconds.', true); showLaunch(); } catch (e) { say(msg, errText(e)); } };
    const st = S.settings, mMsg = h('textarea', { rows: 2, maxlength: 500 }, st.maintenance.message), mUntil = h('input', { placeholder: 'e.g. 18:00 UTC', maxlength: 40, value: st.maintenance.until ?? '' });
    const features = Object.entries(S.features).map(([k, label]) => {
      const f = st.features[k], note = h('input', { placeholder: 'Message for players (optional)', maxlength: 300, value: f.message });
      return h('tr', {}, h('td', {}, label), h('td', {}, f.on ? h('span', { class: 'badge editor' }, 'on') : h('span', { class: 'badge banned' }, 'off')), h('td', {}, note),
        h('td', {}, h('button', { class: 'btn ghost', onclick: () => put('features', { [k]: { on: !f.on, message: note.value.trim() } }) }, f.on ? 'Switch off' : 'Switch on')));
    });
    const invites = h('div'), count = h('input', { type: 'number', min: 1, max: 200, value: 5 }), uses = h('input', { type: 'number', min: 1, max: 1000, value: 1 }), days = h('input', { type: 'number', min: 1, max: 365, value: 30 }), note = h('input', { placeholder: 'Who they\'re for', maxlength: 200 });
    box.replaceChildren(
      h('section', {}, h('h2', {}, 'Maintenance'), msg,
        h('p', {}, st.maintenance.on ? h('b', { style: 'color:var(--c-bad)' }, 'ON: players can\'t use the server (editors and admins can).') : 'Off.'),
        h('label', {}, 'Message for players', mMsg), h('label', {}, 'Back at (shown to players)', mUntil),
        h('button', { class: `btn ${st.maintenance.on ? 'primary' : 'secondary'}`, onclick: () => put('maintenance', { on: !st.maintenance.on, message: mMsg.value.trim(), until: mUntil.value.trim() || null }) }, st.maintenance.on ? 'End maintenance' : 'Start maintenance'),
        h('h2', { style: 'margin-top:12px' }, 'The oldest game the server takes'),
        h('p', { class: 'muted' }, `This build's API version is ${S.protocol}; games older than ${st.client.minProtocol} are asked to refresh. Raise it after an API change old games can't follow.`),
        h('button', { class: 'btn ghost', onclick: () => { const v = Number(prompt('The oldest API version to take:', String(st.client.minProtocol))); if (v >= 1) put('client', { minProtocol: Math.round(v) }); } }, 'Change')),
      h('section', {}, h('h2', {}, 'Features'), h('p', { class: 'muted' }, 'Switch off a broken feature without a deploy: its requests are refused with your message, and the rest of the game carries on.'), table(['', '', '', ''], features)),
      h('section', { style: 'grid-column: 1 / -1' }, h('h2', {}, 'Closed beta'),
        h('p', {}, st.closedBeta.on ? 'On: signing up needs an invite code; guests and first social sign-ins wait.' : 'Off: anyone can sign up.'),
        h('button', { class: 'btn secondary', onclick: () => put('closedBeta', { on: !st.closedBeta.on }) }, st.closedBeta.on ? 'Open sign-ups to everyone' : 'Close sign-ups (invite only)'),
        h('h3', {}, 'Invite codes'),
        h('div', { class: 'row' }, h('label', {}, 'How many', count), h('label', {}, 'Uses each', uses), h('label', {}, 'Days valid', days), h('label', {}, 'Note', note),
          h('button', { class: 'btn primary', onclick: async () => { try { const r = await api.post('/admin/invites', { count: Number(count.value), maxUses: Number(uses.value), days: Number(days.value), note: note.value.trim() }); say(msg, `Made: ${r.codes.join('  ')}`, true); loadInvites(); } catch (e) { say(msg, errText(e)); } } }, 'Make codes')),
        invites));
    async function loadInvites() {
      try {
        const r = await api.get('/admin/invites'), link = c => `${location.origin.replace(/\/\/api\./, '//')}/account/?mode=sign-up&invite=${encodeURIComponent(c)}`;
        invites.replaceChildren(r.invites.length ? table(['Code', 'Used', 'Valid until', 'Note', 'Who used it', ''], r.invites.map(i => h('tr', {},
          h('td', { style: 'font-family:var(--f-mono)' }, i.code, h('div', {}, h('a', { href: '#', onclick: e => { e.preventDefault(); navigator.clipboard?.writeText(link(i.code)); say(msg, 'Sign-up link copied.', true); } }, 'copy link'))),
          h('td', {}, `${i.uses} / ${i.maxUses}`), h('td', { class: 'when' }, i.revoked ? 'revoked' : i.expiresAt ? when(i.expiresAt) : 'no end'), h('td', {}, i.note ?? ''),
          h('td', {}, ...i.usedBy.map(u => h('div', {}, u.userId ? who({ id: u.userId, name: u.name }) : '(deleted)'))),
          h('td', {}, !i.revoked && h('button', { class: 'btn ghost', onclick: async () => { const reason = ask(`Revoke ${i.code}`); if (!reason) return; try { await api.post(`/admin/invites/${encodeURIComponent(i.code)}/revoke`, { reason }); loadInvites(); } catch (e) { say(msg, errText(e)); } } }, 'Revoke'))))) : h('p', { class: 'muted' }, 'No codes yet.'));
      } catch (e) { say(msg, errText(e)); }
    }
    loadInvites();
  }

  // ---------- one player's whole history ----------
  async function history(id) {
    const box = main();
    let r;
    try { r = await api.get(`/admin/players/${encodeURIComponent(id)}/history`); } catch (e) { box.replaceChildren(h('section', {}, h('div', { class: 'msg bad' }, errText(e)))); return; }
    const p = r.player, money = n => Number(n).toLocaleString('en-GB');
    const part = (title, rows, head, row) => h('section', { style: 'grid-column: 1 / -1' }, h('h2', {}, `${title} (${rows.length})`), rows.length ? table(head, rows.map(x => h('tr', {}, ...row(x).map(c => h('td', {}, c ?? ''))))) : h('p', { class: 'muted' }, 'None.'));
    box.replaceChildren(
      h('section', { style: 'grid-column: 1 / -1' }, h('h2', {}, p.name), h('dl', {},
        h('dt', {}, 'Id'), h('dd', {}, p.id), h('dt', {}, 'Email'), h('dd', {}, p.email ?? (p.guest ? 'guest' : '—')), h('dt', {}, 'Role'), h('dd', {}, `${p.role}${p.twoFactor ? ' · two-factor on' : ''}`),
        h('dt', {}, 'Joined'), h('dd', {}, when(p.createdAt)), h('dt', {}, 'Money · XP · level'), h('dd', {}, p.money == null ? '—' : `${money(p.money)} · ${p.xp} · ${p.level}`),
        h('dt', {}, 'Banned'), h('dd', {}, p.banned ? `${p.banReason ?? ''}${p.banExpires ? ` (until ${when(p.banExpires)})` : ''}` : 'no'),
        h('dt', {}, 'Addresses'), h('dd', {}, r.addresses.map(a => `${a.address} (${when(a.lastSeen).split(',')[0]})`).join(', ') || '—'),
        h('dt', {}, 'Linked accounts'), h('dd', {}, ...(r.linkedAccounts.length ? r.linkedAccounts.map(a => h('span', {}, who(a), ` (${a.via}) `)) : ['—']))),
        h('div', { class: 'row' }, h('button', { class: 'btn secondary', onclick: () => pickPlayer(p.id) }, 'Account and economy tools'))),
      part('Ledger', r.ledger, ['When', 'Amount', 'Balance', 'Kind', 'Why'], x => [when(x.at), money(x.amount), money(x.balanceAfter), `${x.kind}${x.byAdmin ? ' (admin)' : ''}`, x.reason]),
      part('Results', r.results, ['When', 'Event', 'Time / score', 'Place', 'Accepted'], x => [when(x.at), x.eventId, x.score ?? x.time, x.place, x.accepted ? 'yes' : `no: ${JSON.stringify(x.problems)}`]),
      part('Reports about them', r.reportsAbout, ['When', 'Kind', 'What', 'By', 'Status'], x => [when(x.at), x.kind, x.details, x.reporter, `${x.status}${x.resolution ? ` · ${x.resolution}` : ''}`]),
      part('Reports they made', r.reportsBy, ['When', 'Kind', 'About', 'Status'], x => [when(x.at), x.kind, x.target, x.status]),
      part('Flags', r.flags, ['When', 'Kind', 'Score', 'Status'], x => [when(x.at), x.kind, x.score, `${x.status}${x.note ? ` · ${x.note}` : ''}`]),
      part('Support', r.support, ['When', 'Kind', 'Message', 'Status'], x => [when(x.at), `${x.kind}${x.category ? ` · ${x.category}` : ''}`, x.message, x.status]),
      part('Admin actions', r.adminActions, ['When', 'Action', 'By', 'Why'], x => [when(x.at), x.action, x.by, x.reason]));
  }

  return { showReports, showSupport, showLaunch, history };
}

// The admin page's Devlog tab (DEVLOG.md "From the admin page"; server/src/devlog.ts): this week's devlog video made
// from here — what it's about written here (in place of devlog/highlights.md), or the whole script; what to film, the
// second car, music, re-using an earlier run's filming, marking it as this week's — then followed as GitHub makes it,
// and the finished video played here with its script and the post's caption, ready to download and paste.

export function createDevlogTools({ api, h, say, when, errText, main }) {
  const P = '/admin/devlog';
  const ask = (text, min = 3) => { const v = prompt(`${text}\n\nWhy? (required: it goes in the log)`); return v && v.trim().length >= min ? v.trim() : null; };
  // (the admin page's labels are small capitals: a note or a tick box under one in ordinary type)
  const NOTE = 'font-size:13px;text-transform:none;letter-spacing:0;font-weight:400;margin-top:4px';
  const tick = (on, set, text) => h('label', { style: 'display:flex;flex-direction:row;align-items:center;gap:10px;text-transform:none;letter-spacing:0;font-size:15px;font-weight:400;padding:6px 0' }, h('input', { type: 'checkbox', checked: on, style: 'width:auto', onchange: e => set(e.target.checked) }), text);
  const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
  const stateBadge = s => badge({ waiting: 'waiting', running: 'making it', done: 'ready', failed: 'failed', cancelled: 'cancelled' }[s] ?? s, { done: 'editor', failed: 'banned', running: 'admin' }[s] ?? '');
  const copyButton = (text, label = 'Copy') => h('button', { class: 'btn ghost', onclick: async e => { try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = label; }, 1500); } catch { prompt('Copy this:', text); } } }, label);
  // (the script as written in the form: a hook, captions, an end line → the workflow's "hook | caption | … | END: …")
  const scriptOf = st => [st.hook.trim(), ...st.captions.map(c => c.trim()).filter(Boolean), ...(st.end.trim() ? [`END: ${st.end.trim()}`] : [])].filter(Boolean).join(' | ');
  // (a run's script.txt → the form's hook, captions and end line, for new words over the same filming)
  const parseScript = text => {
    const lines = String(text ?? '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const hook = (lines.find(l => /^hook\s*:/i.test(l)) ?? '').replace(/^hook\s*:\s*/i, ''), end = (lines.find(l => /^end\s*:/i.test(l)) ?? '').replace(/^end\s*:\s*/i, '');
    return { hook, end, captions: lines.filter(l => !/^(hook|end)\s*:/i.test(l)) };
  };

  async function showDevlog(prefill = null) {
    const box = main();
    box.style.gridTemplateColumns = 'minmax(0, 1fr) minmax(0, 1.1fr)';
    const left = h('section', {}, h('h2', {}, 'Devlog'), h('p', { class: 'muted' }, 'Loading…')), right = h('section', {}, h('h2', {}, 'Videos'));
    box.replaceChildren(left, right);
    let ov;
    try { ov = await api.get(P); } catch (e) { left.replaceChildren(h('h2', {}, 'Devlog'), h('div', { class: 'msg bad' }, errText(e))); return; }
    if (!ov.canRun) left.append(h('div', { class: 'msg bad' }, 'The Devlog tab needs the GitHub token (the CONTENT_BUILDER_TOKEN secret, as the Builder does: docs/DEPLOYMENT.md "The live Builder").'));
    drawForm(left, ov, prefill);
    drawRuns(right, ov.runs);
  }

  // ---------- making one ----------
  function drawForm(el, ov, prefill) {
    const hl = ov.highlights ?? { lines: [] };
    const st = {
      mode: prefill?.script ? 'script' : 'focus',
      focus: prefill?.focus ?? hl.lines.join('\n'), hook: prefill?.script?.hook ?? '', captions: prefill?.script?.captions?.length ? [...prefill.script.captions] : ['', '', '', ''], end: prefill?.script?.end ?? 'Race real roads in your browser',
      target: 'local', multiplayer: true, musicUrl: '', reuseClipsFrom: prefill?.reuseClipsFrom ?? '', tag: prefill?.tag ?? true,
    };
    const msg = h('div'), body = h('div');
    const field = (label, input, note = '') => h('label', {}, label, input, note ? h('div', { class: 'muted', style: NOTE }, note) : '');
    const text = (key, attrs = {}) => h('input', { value: st[key], ...attrs, oninput: e => { st[key] = e.target.value; } });
    function draw() {
      const tabs = h('div', { class: 'row' },
        h('button', { class: `btn ${st.mode === 'focus' ? 'primary' : 'ghost'}`, onclick: () => { st.mode = 'focus'; draw(); } }, 'Tell it what\'s new'),
        h('button', { class: `btn ${st.mode === 'script' ? 'primary' : 'ghost'}`, onclick: () => { st.mode = 'script'; draw(); } }, 'Write the whole script'));
      const focus = h('div', {},
        field('What this video is about', h('textarea', { rows: 7, style: 'width:100%;font:inherit', placeholder: 'One thing players will notice per line, in plain words (under ~12 words each).\nHOOK: a line like this sets the big title.', oninput: e => { st.focus = e.target.value; } }, st.focus),
          `One line per thing players will notice. The video uses these first, in order (up to five), then fills up from this week's changes; "HOOK: …" sets the title. ${hl.since ? `Filled in with what's been added to the highlights since the last devlog (${hl.since})` : 'Filled in with the latest highlights'} — change it as you like: nothing is saved to the game.`));
      const script = h('div', {},
        field('The title (the hook: the first 2 seconds)', text('hook', { maxlength: 80, placeholder: 'My racing game now has…' }), 'Under about 8 words works best.'),
        h('div', {}, h('b', {}, 'The captions'), h('div', { class: 'muted', style: NOTE }, 'Shown in order over the gameplay, under about 12 words each. Four to six make a 20–45 second video.'),
          ...st.captions.map((c, i) => h('div', { class: 'row', style: 'align-items:center' }, h('input', { value: c, maxlength: 120, style: 'flex:1', placeholder: `Caption ${i + 1}`, oninput: e => { st.captions[i] = e.target.value; } }),
            h('button', { class: 'btn ghost', title: 'Remove', onclick: () => { st.captions.splice(i, 1); draw(); } }, '✕'))),
          st.captions.length < 8 ? h('button', { class: 'btn ghost', onclick: () => { st.captions.push(''); draw(); } }, '+ Another caption') : ''),
        field('The end card\'s line (under ognistrada.com)', text('end', { maxlength: 80 })));
      const runs = (ov.runs ?? []).filter(r => r.state === 'done');
      const options = h('div', {},
        h('h3', {}, 'How it\'s made'),
        field('What to film', h('select', { onchange: e => { st.target = e.target.value; } }, ...[['local', 'The game as it is now, on GitHub\'s own computer (the live game isn\'t touched)'], ['live', 'ognistrada.com itself, as players see it']].map(([v, t]) => h('option', { value: v, selected: st.target === v }, t)))),
        tick(st.multiplayer, v => { st.multiplayer = v; }, 'A second car joins, so multiplayer shows'),
        field('Use the filming from an earlier video (new words in about 5 minutes instead of 40)', h('select', { onchange: e => { st.reuseClipsFrom = e.target.value; } }, h('option', { value: '' }, 'No: film it again'),
          ...runs.map(r => h('option', { value: String(r.id), selected: st.reuseClipsFrom === String(r.id) }, `The video of ${when(r.created)} (run ${r.id})`))), 'Its filming is kept 14 days.'),
        field('Background music (optional)', text('musicUrl', { placeholder: 'https://… a direct link to an mp3 or m4a', maxlength: 500 }), 'Only music you have the right to use. Or leave it out and add a sound in TikTok or Instagram when you post.'),
        tick(st.tag, v => { st.tag = v; }, 'This is this week\'s devlog (next week\'s starts after it; untick for a test)'));
      body.replaceChildren(tabs, st.mode === 'focus' ? focus : script, options, msg,
        h('button', { class: 'btn primary', disabled: !ov.canRun, onclick: make }, st.reuseClipsFrom ? 'Make it (about 5 minutes)' : 'Make the video (about 40 minutes)'));
    }
    async function make() {
      const script = st.mode === 'script' ? scriptOf(st) : '';
      if (st.mode === 'script' && (!st.hook.trim() || !st.captions.some(c => c.trim()))) return say(msg, 'Write a title and at least one caption (or switch to "Tell it what\'s new").');
      const why = ask(`Make the devlog video${st.reuseClipsFrom ? ' from the earlier filming' : ''}?`);
      if (!why) return;
      try {
        await api.post(`${P}/runs`, { ...(script ? { script } : { focus: st.focus.split('\n').map(l => l.trim()).filter(Boolean).join(' | ') }), target: st.target, multiplayer: st.multiplayer, musicUrl: st.musicUrl.trim() || undefined, reuseClipsFrom: st.reuseClipsFrom || undefined, tag: st.tag, reason: why });
        say(msg, 'Started on GitHub. It shows on the right in a few seconds; you can leave this page.', true);
        setTimeout(() => showDevlog(), 4000);
      } catch (e) { say(msg, errText(e)); }
    }
    el.replaceChildren(h('h2', {}, 'Devlog'), h('p', { class: 'muted' }, 'This week\'s short video for TikTok and Instagram Reels: the game driven and filmed on GitHub\'s computers, with big captions, the game\'s own sound and an end card. Free; nothing in the game changes.'), ...(el.querySelector('.msg.bad') ? [el.querySelector('.msg.bad')] : []), body);
    draw();
  }

  // ---------- the videos ----------
  function drawRuns(el, runs) {
    const list = h('div', { class: 'list' }), view = h('div');
    el.replaceChildren(h('h2', {}, 'Videos'), view, list);
    list.replaceChildren(...(runs.length ? runs.map(r => h('div', { class: 'action', style: 'cursor:pointer', onclick: () => open(r.id, view) },
      h('div', { class: 'row', style: 'align-items:center' }, h('b', {}, when(r.created)), stateBadge(r.state), r.by ? h('span', { class: 'muted' }, r.by) : ''))) : [h('p', { class: 'muted' }, 'No devlog videos yet.')]));
    const first = runs.find(r => ['waiting', 'running'].includes(r.state)) ?? runs.find(r => r.state === 'done');
    if (first) open(first.id, view);
  }
  async function open(id, el) {
    for (;;) {
      let r;
      try { r = await api.get(`${P}/runs/${id}`); } catch (e) { el.replaceChildren(h('div', { class: 'msg bad' }, errText(e))); return; }
      if (!el.isConnected) return;
      el.replaceChildren(h('div', { class: 'action' }, ...runView(r, el)));
      if (!['waiting', 'running'].includes(r.state)) return;
      await new Promise(res => setTimeout(res, 15000));
    }
  }
  function runView(r, el) {
    const steps = (r.steps ?? []).map(s => h('div', { style: `font-size:13px;color:${s.conclusion === 'failure' ? 'var(--c-bad-soft)' : 'inherit'}` }, `${s.conclusion === 'success' ? '✔' : s.conclusion === 'failure' ? '✘' : s.conclusion === 'skipped' ? '–' : s.status === 'in_progress' ? '…' : '·'} ${s.name}`));
    const src = `/api/v1${P}/runs/${r.id}/video`;
    return [
      h('div', { class: 'row', style: 'align-items:center' }, h('b', {}, `The video of ${when(r.created)}`), stateBadge(r.state), h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'On GitHub')),
      r.state === 'running' ? h('p', { class: 'muted' }, `Now: ${r.step ?? 'starting'}. Filming takes about 30 minutes, the video a few more; this updates by itself.`) : '',
      r.state === 'waiting' ? h('p', { class: 'muted' }, 'Waiting for one of GitHub\'s computers (one devlog at a time).') : '',
      r.state === 'failed' ? h('div', { class: 'msg bad' }, `It stopped at "${r.failedStep ?? 'a step'}". The reason is in its log on GitHub; nothing changed in the game.`) : '',
      ['waiting', 'running'].includes(r.state) ? h('button', { class: 'btn ghost', onclick: async () => { const why = ask('Stop making this video?'); if (!why) return; try { await api.post(`${P}/runs/${r.id}/cancel`, { reason: why }); } catch (e) { alert(errText(e)); } } }, 'Stop it') : '',
      r.filesError ? h('div', { class: 'msg bad' }, r.filesError) : '',
      r.video ? h('video', { src, controls: true, playsinline: true, preload: 'metadata', style: 'width:100%;max-width:340px;aspect-ratio:9/16;background:#000;border-radius:12px;display:block' }) : '',
      r.video ? h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `${src}?download=1` }, 'Download the video'), r.post ? copyButton(r.post, 'Copy the post\'s caption') : '') : '',
      r.post ? h('details', { open: true }, h('summary', {}, 'The post\'s caption and hashtags'), h('pre', { style: 'white-space:pre-wrap;font:13px var(--f-mono)' }, r.post)) : '',
      r.script ? h('details', {}, h('summary', {}, 'The words in the video'), h('pre', { style: 'white-space:pre-wrap;font:13px var(--f-mono)' }, r.script.split('\n').filter(l => !l.startsWith('#')).join('\n').trim())) : '',
      r.state === 'done' ? h('button', { class: 'btn secondary', onclick: () => showDevlog({ reuseClipsFrom: String(r.id), script: parseScript(r.script), tag: false }) }, 'New words, same filming (about 5 minutes)') : '',
      steps.length ? h('details', {}, h('summary', {}, 'Its steps'), ...steps) : '',
    ];
  }
  return { showDevlog };
}

// Reporting a player, in the game's own dialog (not the browser's prompt box): what for (when there's a choice) and what
// happened, a few words at least, for the admins. Used by the lobby (play/mpScreens.js), free roam's Nearby
// (play/roam.js) and the leaderboards (play/trackUi.js).
//
//   const r = await askReport({ name, kinds })   → { kind, details } | null (cancelled)
//     kinds: [[kind, label], …] to choose from (none: 'behaviour'); details at least MIN_DETAILS characters
//   reportNote(text)                              a short note after it (sent, already reported, failed)

export const MIN_DETAILS = 5;

const CSS = `
#reportDlg{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);font:14px/1.4 Barlow,system-ui,sans-serif;color:#E9ECEF}
#reportDlg form{width:min(420px,calc(100vw - 32px));background:#0E1114;border:1px solid #242B33;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.6);padding:16px 18px;display:flex;flex-direction:column;gap:10px}
#reportDlg h3{margin:0;font:600 18px 'Barlow Condensed',system-ui,sans-serif;letter-spacing:.02em}
#reportDlg p{margin:0;color:#A3ABB5;font-size:13px}
#reportDlg label{display:flex;flex-direction:column;gap:4px;color:#A3ABB5;font-size:12px}
#reportDlg select,#reportDlg textarea{background:#0B0E11;color:#E9ECEF;border:1px solid #333C46;border-radius:6px;padding:7px 8px;font:inherit}
#reportDlg textarea{min-height:84px;resize:vertical}
#reportDlg .why{color:#F2C037;font-size:12px;min-height:16px}
#reportDlg .row{display:flex;gap:8px;justify-content:flex-end}
#reportDlg button{font:600 14px 'Barlow Condensed',system-ui,sans-serif;border-radius:6px;padding:7px 14px;cursor:pointer;border:1px solid #333C46;background:#1B2127;color:#E9ECEF}
#reportDlg button.go{background:#36B3F5;border-color:#36B3F5;color:#04121B}
#reportNote{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:1001;background:rgba(12,15,18,.94);color:#E9ECEF;border:1px solid #242B33;border-radius:8px;padding:8px 14px;font:14px Barlow,system-ui,sans-serif;pointer-events:none}`;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function css() { if (!document.getElementById('reportDlgCss')) { const st = document.createElement('style'); st.id = 'reportDlgCss'; st.textContent = CSS; document.head.appendChild(st); } }

export function askReport({ name = 'this player', kinds = null } = {}) {
  css();
  document.getElementById('reportDlg')?.remove();
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.id = 'reportDlg';
    box.innerHTML = `<form novalidate>
      <h3>Report ${esc(name)}</h3>
      <p>An admin will look at it. Say what happened: they see your words, never shown to the player you report.</p>
      ${kinds?.length ? `<label>What for<select data-kind>${kinds.map(([k, t]) => `<option value="${esc(k)}">${esc(t)}</option>`).join('')}</select></label>` : ''}
      <label>What happened<textarea data-details maxlength="500" placeholder="A few words for the admins"></textarea></label>
      <div class="why" data-why></div>
      <div class="row"><button type="button" data-cancel>Cancel</button><button type="submit" class="go">Send report</button></div>
    </form>`;
    const form = box.querySelector('form'), text = box.querySelector('[data-details]'), why = box.querySelector('[data-why]');
    const done = r => { box.remove(); resolve(r); };
    form.addEventListener('submit', e => {
      e.preventDefault();
      const details = text.value.trim();
      if (details.length < MIN_DETAILS) { why.textContent = 'A few words, please: the admins need to know what to look at.'; text.focus(); return; }
      done({ kind: box.querySelector('[data-kind]')?.value ?? 'behaviour', details });
    });
    box.querySelector('[data-cancel]').addEventListener('click', () => done(null));
    box.addEventListener('click', e => { if (e.target === box) done(null); });
    // (typing here isn't driving: the game's keys stay out of it)
    for (const k of ['keydown', 'keyup', 'keypress']) box.addEventListener(k, e => { e.stopPropagation(); if (k === 'keydown' && e.key === 'Escape') done(null); });
    document.body.appendChild(box);
    (box.querySelector('[data-kind]') ?? text).focus();
  });
}

let noteTimer = 0;
export function reportNote(text, ms = 3500) {
  css();
  let el = document.getElementById('reportNote');
  if (!el) { el = document.createElement('div'); el.id = 'reportNote'; document.body.appendChild(el); }
  el.textContent = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => el.remove(), ms);
}

// A first-time hint on the road (garage/hints.js): a small card at the bottom of the screen with a title
// and a line of what to do, for a few seconds (longer the more there is to read); clicking it closes it.
// (Above the quest screens, so a hint on the results or a quest card shows.) A hint that comes while
// another is showing waits its turn, so none is marked seen without being shown.
// Styled here, so it looks the same on every page that drives (index.html, dev/world.html).

export function createHintCard() {
  const el = document.createElement('div');
  el.className = 'hint-card';
  Object.assign(el.style, { position: 'fixed', left: '50%', bottom: '120px', transform: 'translate(-50%, 12px)', zIndex: 70, maxWidth: 'min(460px, calc(100vw - 32px))', padding: '12px 16px 12px 14px',
    display: 'flex', gap: '12px', alignItems: 'flex-start', background: 'rgba(12, 15, 18, 0.94)', color: '#E9ECEF', border: '1px solid #333C46', borderLeft: '3px solid #36B3F5', borderRadius: '8px',
    font: '14px/1.4 Barlow, system-ui, sans-serif', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)', opacity: '0', pointerEvents: 'none', transition: 'opacity 0.25s, transform 0.25s', cursor: 'pointer' });
  el.innerHTML = '<span style="font-size:18px;line-height:1.2">💡</span><div style="display:flex;flex-direction:column;gap:2px"><b data-t style="font-size:15px"></b><span data-x style="color:#A3ABB5"></span><small style="color:#6F7883;font-size:11px">click to dismiss</small></div>';
  let left = 0, gap = 0;
  const queue = [];
  const hide = () => { left = 0; gap = queue.length ? 0.4 : 0; el.style.opacity = '0'; el.style.transform = 'translate(-50%, 12px)'; el.style.pointerEvents = 'none'; };
  const put = (title, text) => {
    el.querySelector('[data-t]').textContent = title;
    el.querySelector('[data-x]').textContent = text;
    left = 4 + text.length / 22;
    Object.assign(el.style, { opacity: '1', transform: 'translate(-50%, 0)', pointerEvents: 'auto' });
  };
  el.addEventListener('click', hide);
  return {
    el,
    get showing() { return left > 0; },
    get waiting() { return queue.length; },
    show(title, text) { if (left > 0 || gap > 0) queue.push([title, text]); else put(title, text); },
    update(dt) {
      if (left > 0 && (left -= dt) <= 0) hide();
      else if (left <= 0 && queue.length && (gap -= dt) <= 0) put(...queue.shift());
    },
    hide,
  };
}

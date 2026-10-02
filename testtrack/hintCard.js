// A first-time hint on the road (garage/hints.js): a small card at the bottom of the screen with a title
// and a line of what to do, for a few seconds (longer the more there is to read); clicking it closes it.
// Styled here, so it looks the same on every page that drives (index.html, dev/world.html).

export function createHintCard() {
  const el = document.createElement('div');
  el.className = 'hint-card';
  Object.assign(el.style, { position: 'fixed', left: '50%', bottom: '120px', transform: 'translate(-50%, 12px)', zIndex: 25, maxWidth: 'min(460px, calc(100vw - 32px))', padding: '12px 16px 12px 14px',
    display: 'flex', gap: '12px', alignItems: 'flex-start', background: 'rgba(12, 15, 18, 0.94)', color: '#E9ECEF', border: '1px solid #333C46', borderLeft: '3px solid #36B3F5', borderRadius: '8px',
    font: '14px/1.4 Barlow, system-ui, sans-serif', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)', opacity: '0', pointerEvents: 'none', transition: 'opacity 0.25s, transform 0.25s', cursor: 'pointer' });
  el.innerHTML = '<span style="font-size:18px;line-height:1.2">💡</span><div style="display:flex;flex-direction:column;gap:2px"><b data-t style="font-size:15px"></b><span data-x style="color:#A3ABB5"></span></div>';
  let left = 0;
  const hide = () => { left = 0; el.style.opacity = '0'; el.style.transform = 'translate(-50%, 12px)'; el.style.pointerEvents = 'none'; };
  el.addEventListener('click', hide);
  return {
    el,
    get showing() { return left > 0; },
    show(title, text) {
      el.querySelector('[data-t]').textContent = title;
      el.querySelector('[data-x]').textContent = text;
      left = 4 + text.length / 22;
      Object.assign(el.style, { opacity: '1', transform: 'translate(-50%, 0)', pointerEvents: 'auto' });
    },
    update(dt) { if (left > 0 && (left -= dt) <= 0) hide(); },
    hide,
  };
}

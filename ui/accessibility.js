// Accessibility, applied to every page (Phase 8 Step 4; docs/ACCESSIBILITY.md) from the settings' a11y group:
//   textSize     0.85–1.6: every menu's and the HUD's text (the root font size; the HUD's own scale on top)
//   contrast     'normal' | 'high': solid dark panels, white text, thick outlines and focus rings
//   colours      'standard' | 'deuteranopia' | 'protanopia' | 'tritanopia' (play/palette.js): everything colour-coded
//                — splits, warnings, gates, the route, tyre grip, the map — in colours that read apart for that
//                vision, always with a sign, shape or word too
//   motion       'auto' (the system's "reduce motion") | 'full' | 'reduced': reduced: no camera shake, no motion blur,
//                no speed effects (the field of view widening, speed lines), no animated menus
//   flashing     'reduced' (the default) | 'full': reduced: nothing flashes more than three times a second (WCAG 2.3.1)
//                — the shift light and warning lamps glow steadily, lightning and camera flashes are softened
//   visualSounds the important sounds shown too (ui/soundCues.js)
//   screen reader: menus are buttons, tabs and labelled controls; announce() speaks a change (the live region)
//
//   applyAccessibility(settings)      // after any change
//   motionOf(settings)                // { reduced, cameraShake 0..1, motionBlur, speedEffects }
//   photosensitivityWarning({ t })    // once, on the first launch (a Promise when it's been read)

import { t as tr } from './i18n.js';
import { PALETTES } from '../play/palette.js';

export const DEFAULT_A11Y = { textSize: 1, contrast: 'normal', colours: 'standard', motion: 'auto', cameraShake: 1, flashing: 'reduced', visualSounds: false, screenReaderHints: true };
const systemReduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export const a11yOf = settings => ({ ...DEFAULT_A11Y, ...(settings?.a11y ?? {}) });

export function motionOf(settings) {
  const A = a11yOf(settings), reduced = A.motion === 'reduced' || (A.motion === 'auto' && systemReduced());
  return { reduced, cameraShake: reduced ? 0 : A.cameraShake, motionBlur: !reduced, speedEffects: !reduced, flashing: A.flashing };
}
// at most three flashes a second: a blinking lamp's period, held to that (and steady when flashing is reduced)
export const safeBlink = (settings, wanted = 0.25) => a11yOf(settings).flashing === 'reduced' ? null : Math.max(wanted, 1 / 3);

// (the new screens' styles: ui/a11y.css — added to a page that doesn't link it already)
export function ensureStyles(doc = globalThis.document) {
  if (!doc || doc.querySelector('link[href$="ui/a11y.css"]')) return;
  const l = doc.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./a11y.css', import.meta.url).href;
  doc.head.append(l);
}
export function applyAccessibility(settings, root = globalThis.document?.documentElement) {
  if (!root) return;
  ensureStyles();
  const A = a11yOf(settings), M = motionOf(settings);
  root.style.setProperty('--text-scale', String(A.textSize));
  root.style.fontSize = `${Math.round(16 * A.textSize)}px`;
  root.classList.toggle('a11y-contrast', A.contrast === 'high');
  root.classList.toggle('a11y-reduced-motion', M.reduced);
  root.classList.toggle('a11y-no-flash', A.flashing === 'reduced');
  for (const v of ['deuteranopia', 'protanopia', 'tritanopia']) root.classList.toggle(`a11y-${v}`, A.colours === v);
  const P = PALETTES[paletteName(settings)] ?? PALETTES.standard;
  for (const k of ['good', 'bad', 'warn', 'route', 'guide']) root.style.setProperty(`--c-${k}`, P[k]);
}
// The colour-coded information's palette for a vision (the settings' colours; the older palette setting kept)
export function paletteName(settings) {
  const c = a11yOf(settings).colours;
  if (c === 'tritanopia') return 'tritanopia';
  if (c === 'deuteranopia' || c === 'protanopia') return 'colourblind';
  if (c === 'high') return 'highContrast';
  return settings?.palette ?? 'standard';
}

// ---------- the screen reader's live region ----------
let live = null;
export function announce(text, { assertive = false } = {}) {
  if (typeof document === 'undefined') return;
  if (!live) {
    live = document.createElement('div');
    live.id = 'srLive';
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');
    document.body.append(live);
  }
  live.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}

// A dialog that keeps the keyboard inside it (Tab cycles its controls, Escape closes when allowed) and gives focus back
export function trapFocus(dialog, { onEscape = null } = {}) {
  const before = document.activeElement;
  const focusables = () => [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && !x.closest('[hidden]'));
  const key = e => {
    if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(); if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  };
  dialog.addEventListener('keydown', key);
  setTimeout(() => (dialog.querySelector('[autofocus]') ?? focusables()[0])?.focus(), 0);
  return () => { dialog.removeEventListener('keydown', key); before?.focus?.(); };
}

// ---------- the photosensitivity warning: on the first launch, before anything moves ----------
const SEEN = 'ognistrada.photosensitivity.v1';
export function photosensitivityWarning({ t = tr, force = false } = {}) {
  let seen = false;
  try { seen = !!localStorage.getItem(SEEN); } catch { /* ask again */ }
  if (seen && !force) return Promise.resolve(false);
  ensureStyles();
  return new Promise(resolve => {
    const d = document.createElement('div');
    d.className = 'a11yDialog';
    d.setAttribute('role', 'alertdialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-labelledby', 'psTitle');
    d.setAttribute('aria-describedby', 'psText');
    d.innerHTML = `<div class="box"><h2 id="psTitle">${t('a11y.photo.title')}</h2><p id="psText">${t('a11y.photo.text')}</p>
      <p>${t('a11y.photo.settings')}</p><button type="button" autofocus>${t('a11y.photo.ok')}</button></div>`;
    document.body.append(d);
    const release = trapFocus(d);
    d.querySelector('button').addEventListener('click', () => {
      try { localStorage.setItem(SEEN, new Date().toISOString()); } catch { /* shown again next time */ }
      release(); d.remove(); resolve(true);
    });
  });
}

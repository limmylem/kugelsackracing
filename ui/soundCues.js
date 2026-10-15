// What the sounds tell you, shown (Phase 8 Step 4; docs/ACCESSIBILITY.md) — for players who can't hear them, or play
// with the sound off (settings.a11y.visualSounds):
//   tyre grip: four corners round a car outline, each filling as its tyre uses up its grip (the squeal), amber near the
//   limit, the bad colour once it slides (a lock-up or wheelspin flashes); the engine: a lamp and words when it's
//   damaged, overheating or near the rev limiter (the knock, the limiter's bounce); other cars: an arrow at the
//   screen's edge toward a car close by that you'd hear coming, nearer ones bigger; a crash, a gear grinding, a tyre
//   blowing: a word under the speed for a moment, in the order they happen
// Colours come from the colour-blind palette when that's chosen (play/palette.js) and every cue has a shape or a word
// as well as a colour.
//
//   const cues = createSoundCues({ t, palette })   // cues.el; cues.update(snapshot, { others, heading, dt }); cues.event(kind)

import { t as tr } from './i18n.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const NEAR_CARS_M = 25;

export function createSoundCues({ t = tr, palette = () => ({ good: '#7ee08a', bad: '#ff7a6a', warn: '#ffbd4a' }) } = {}) {
  const el = document.createElement('div');
  el.id = 'soundCues';
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<div class="grip" role="img" aria-label="${t('cues.grip')}"><svg viewBox="0 0 40 64" width="40" height="64" aria-hidden="true">
      <rect x="11" y="6" width="18" height="52" rx="7" fill="none" stroke="currentColor" stroke-opacity=".6"/>
      ${[[4, 10], [30, 10], [4, 42], [30, 42]].map(([x, y], i) => `<rect data-w="${i}" x="${x}" y="${y}" width="6" height="12" rx="2"/>`).join('')}
    </svg></div>
    <div class="engine" hidden><span class="icon" aria-hidden="true">⚠</span><b></b></div>
    <div class="events"></div><div class="arrows" aria-hidden="true"></div>`;
  const tyres = [...el.querySelectorAll('[data-w]')], engine = el.querySelector('.engine'), events = el.querySelector('.events'), arrows = el.querySelector('.arrows');
  let shown = [], lastEngine = '';
  const say = (text, kind) => {
    const x = document.createElement('div');
    x.className = `cue ${kind}`; x.textContent = text;
    events.prepend(x);
    shown.push({ el: x, left: 2.2 });
    while (events.children.length > 3) events.lastChild.remove();
  };
  return {
    el,
    // s: the vehicle's snapshot (wheels[].gripUsed / slipRatio / grounded; mechanical; rpm, engine), others:
    // [{ position:[x,y,z], name }] other cars, me: { position, heading (radians, the car's yaw) }
    update(s, { others = [], me = null, dt = 0.1, redline = null } = {}) {
      const P = palette();
      // the tyres
      s.wheels?.forEach((w, i) => {
        const r = tyres[i] ?? tyres[i % 4];
        if (!r) return;
        const used = w.grounded ? clamp(w.gripUsed ?? 0, 0, 1.3) : 0, slide = used > 1 || Math.abs(w.slipRatio ?? 0) > 0.35;
        r.setAttribute('fill', slide ? P.bad : used > 0.85 ? P.warn : P.good);
        r.setAttribute('fill-opacity', String(0.25 + 0.75 * clamp(used, 0, 1)));
        r.classList.toggle('slide', slide);
      });
      // the engine
      const m = s.mechanical ?? {}, health = s.engineHealth ?? s.engine?.health;
      const word = health?.blown ? t('cues.engineBlown') : m.limp ? t('cues.limp') : m.warn ? t('cues.overheat') : health && health.condition < 0.35 ? t('cues.engineDamaged') : redline && s.rpm > redline * 0.985 ? t('cues.limiter') : '';
      if (word !== lastEngine) {
        lastEngine = word;
        engine.hidden = !word;
        engine.querySelector('b').textContent = word;
        engine.style.color = health?.blown || m.limp ? P.bad : P.warn;
      }
      // the other cars near enough to hear: an arrow toward each (up to four), on the screen's edge
      const near = !me ? [] : others.map(o => {
        const dx = o.position[0] - me.position[0], dz = o.position[2] - me.position[2], d = Math.hypot(dx, dz);
        // (the angle from straight ahead: the car looks along +z, its yaw turning it)
        const a = Math.atan2(dx, dz) - me.heading;
        return { d, a, name: o.name };
      }).filter(o => o.d < NEAR_CARS_M && o.d > 1).sort((a, b) => a.d - b.d).slice(0, 4);
      arrows.innerHTML = near.map(o => {
        const k = 1 - o.d / NEAR_CARS_M, deg = -o.a * 180 / Math.PI;
        return `<span class="near" style="--a:${deg}deg;--k:${k.toFixed(2)};color:${o.d < 8 ? P.bad : P.warn}">▲</span>`;
      }).join('');
      el.querySelector('.arrows').setAttribute('data-count', near.length);
      // the words fade
      shown = shown.filter(x => { x.left -= dt; if (x.left <= 0) { x.el.remove(); return false; } x.el.style.opacity = String(clamp(x.left, 0, 1)); return true; });
    },
    // something heard for a moment: 'crash', 'bigCrash', 'grind', 'puncture', 'blowoff', 'lockup', 'kerb', 'horn', 'limiter'
    event(kind) { say(t(`cues.event.${kind}`), kind); },
  };
}

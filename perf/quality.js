// The graphics settings (Phase 8 Step 2; docs/PERFORMANCE.md; data/performance.json quality): presets — low, medium,
// high, ultra — and custom (any one changed), the frame rate cap, power saver, and dynamic resolution. Nothing here
// touches the physics: its rate and tyre model are the same on every setting.
//
//   graphicsOf(saved, cfg) → { preset, ...every setting }     saved: the settings' graphics ({ preset, values })
//   withSetting(saved, cfg, key, value) → saved (custom unless the values are exactly a preset's)
//   withPreset(saved, cfg, name) → saved                     presetOf(values, cfg) → a preset's name or 'custom'
//   createFrameCap() → { due(now, fps) → whether to draw this frame (fps 0: every one the screen gives) }
//   createDynamicResolution(cfg.dynamic) → { scale, update(frameMs, targetMs, now, { min, max }) → scale }

export const SETTINGS = ['renderDistance', 'shadows', 'reflections', 'effects', 'antialias', 'bloom', 'motionBlur', 'carDetail', 'damageDetail', 'scenery', 'spectators', 'detailedCars', 'fullEngineSounds', 'resolution', 'maxPixelRatio', 'dynamicResolution', 'minResolution', 'fpsCap', 'powerSaver'];
export const PRESETS = ['low', 'medium', 'high', 'ultra'];

// (power saver is the player's own: on battery, always, or off — not part of a preset)
const OWN = { powerSaver: 'battery' };
const same = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b;

export function presetValues(cfg, name) { return { ...(cfg.presets[name] ?? cfg.presets[cfg.default]) }; }

export function presetOf(values, cfg) {
  for (const name of PRESETS) { const P = cfg.presets[name]; if (P && Object.keys(P).every(k => same(values[k], P[k]))) return name; }
  return 'custom';
}

export function graphicsOf(saved, cfg) {
  const name = PRESETS.includes(saved?.preset) ? saved.preset : null;
  const base = presetValues(cfg, name ?? cfg.default);
  const values = name ? base : { ...base, ...(saved?.values ?? {}) };
  for (const [k, v] of Object.entries(OWN)) values[k] = saved?.values?.[k] ?? saved?.[k] ?? v;
  return { preset: name ?? (saved?.values ? 'custom' : cfg.default), ...values };
}

export function withPreset(saved, cfg, name) {
  return { ...saved, preset: name, values: { ...presetValues(cfg, name), powerSaver: graphicsOf(saved, cfg).powerSaver } };
}

export function withSetting(saved, cfg, key, value) {
  const G = graphicsOf(saved, cfg), values = Object.fromEntries(SETTINGS.map(k => [k, G[k]]));
  values[key] = value;
  const preset = presetOf(values, cfg);
  return { ...saved, preset, values };
}

// The frame rate cap: draws a frame only when its time has come (the screen's frames in between skipped), keeping
// the rhythm (the remainder carried over, so 60 on a 144 Hz screen is 60, not 48)
export function createFrameCap() {
  let next = 0;
  return {
    due(now, fps) {
      if (!(fps > 0)) { next = 0; return true; }
      const step = 1000 / fps;
      // (a little early is on time: the screen's frames don't land exactly)
      if (next && now < next - 1.5) return false;
      next = next && now - next < step ? next + step : now + step;
      return true;
    },
  };
}

// Dynamic resolution: the render scale lowered when frames run long, raised again once they've been on time a while
// (and not straight back to a scale that just failed)
export function createDynamicResolution(D) {
  let scale = 1, sumMs = 0, n = 0, windowStart = null, steadySince = null;
  const failed = new Map();          // scale (rounded) → when it last failed
  const key = s => Math.round(s * 100);
  const R = {
    get scale() { return scale; },
    set scale(s) { scale = s; },
    reset(s = 1) { scale = s; sumMs = 0; n = 0; windowStart = null; steadySince = null; failed.clear(); },
    // frameMs: the frame just drawn; targetMs: the frame time wanted; now (ms); min, max: the limits
    update(frameMs, targetMs, now, { min = 0.5, max = 1 } = {}) {
      scale = Math.min(max, Math.max(min, scale));
      if (windowStart == null) { windowStart = now; steadySince = now; }
      sumMs += frameMs; n++;
      if (frameMs > D.under * targetMs) steadySince = now;
      if (now - windowStart >= D.window * 1000) {
        const avg = sumMs / n;
        sumMs = 0; n = 0; windowStart = now;
        if (avg > D.over * targetMs && scale > min + 1e-6) {
          failed.set(key(scale), now);
          scale = Math.max(min, scale - D.down);
          steadySince = now;
          return scale;
        }
      }
      if (scale < max - 1e-6 && now - steadySince >= D.steady * 1000) {
        const up = Math.min(max, scale + D.up), when = failed.get(key(up));
        if (when == null || now - when > D.retry * 1000) { scale = up; steadySince = now; }
      }
      return scale;
    },
  };
  return R;
}

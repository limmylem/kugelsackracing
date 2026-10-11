// The first launch's benchmark (Phase 8 Step 2; docs/PERFORMANCE.md; data/performance.json quality.autoDetect): a few
// seconds of the world as it is drawn at a preset, from the top down — the first preset whose frames keep to its frame
// rate is the one picked (the player can change it in the settings, or run this again from there). Software graphics
// (no graphics card) are low at once. Ultra only where high runs well under even a fast screen's frame time.
//
//   const r = await detectPreset({ cfg, renderer, apply(G), frames(seconds) → frame times (ms), say(text) })
//     → { preset, why, tried: [{ preset, p90Ms, targetMs, ok }], gpu }

import { presetValues } from './quality.js';

// the graphics card's name, where the browser tells it
export function gpuName(renderer) {
  try {
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { return ''; }
}
export const isSoftware = name => /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(name);

const p90 = xs => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] : Infinity; };

export async function detectPreset({ cfg, renderer, apply, frames, say = () => {} }) {
  const A = cfg.autoDetect, gpu = gpuName(renderer), tried = [];
  if (isSoftware(gpu)) return { preset: 'low', why: `software graphics (${gpu})`, tried, gpu };
  for (const name of A.order) {
    const P = presetValues(cfg, name);
    // (as the preset is, but at its full resolution — dynamic resolution would hide how it really runs — and as fast as
    // the screen goes: a frame rate cap would hide any to spare)
    apply({ preset: name, ...P, dynamicResolution: false, powerSaver: 'off', fpsCap: 0 });
    say(`Testing this computer: ${name}…`);
    await frames(A.warmup);
    const t = await frames(A.seconds), f = p90(t), targetMs = P.fpsCap > 0 ? 1000 / P.fpsCap : 1000 / 60;
    const ok = t.length >= 5 && f <= targetMs * A.slack;
    tried.push({ preset: name, p90Ms: +f.toFixed(1), targetMs: +targetMs.toFixed(1), frames: t.length, ok });
    if (ok) {
      // (high with frames to spare — a fast screen showing it can draw far quicker than 60 a second: ultra)
      if (name === 'high' && cfg.presets.ultra && f <= A.ultraIfUnderMs) return { preset: 'ultra', why: `high at ${f.toFixed(1)} ms a frame (90th percentile)`, tried, gpu };
      return { preset: name, why: `${name} at ${f.toFixed(1)} ms a frame (90th percentile; ${targetMs.toFixed(1)} wanted)`, tried, gpu };
    }
  }
  return { preset: 'low', why: 'nothing higher kept its frame rate', tried, gpu };
}

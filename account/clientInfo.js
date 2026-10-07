// What a support or feedback message says about the game and the device it came from (Phase 6 Step 5; the owner
// agreed this list: docs/PRIVACY_DATA.md "Support and feedback"): the game's version, the browser, the operating
// system, the screen, the graphics card's name, the memory, the language, and the frame rate if the game knows it.
// Nothing else — and the forms show the player exactly this before it's sent.

import { CLIENT_PROTOCOL } from './api.js';

let gpu;
function gpuName() {
  if (gpu !== undefined) return gpu;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).slice(0, 200) : (gl ? String(gl.getParameter(gl.RENDERER)).slice(0, 200) : undefined);
  } catch { gpu = undefined; }
  return gpu;
}

export function clientInfo({ fps } = {}) {
  const n = globalThis.navigator ?? {}, s = globalThis.screen;
  const info = {
    version: String(globalThis.KR_SITE?.version ?? 'unknown').slice(0, 80), protocol: CLIENT_PROTOCOL,
    url: `${location.pathname}`.slice(0, 300), userAgent: String(n.userAgent ?? '').slice(0, 400),
    platform: String(n.userAgentData?.platform ?? n.platform ?? '').slice(0, 80), language: String(n.language ?? '').slice(0, 40),
    screen: s ? `${s.width}x${s.height}@${globalThis.devicePixelRatio ?? 1}` : undefined, gpu: gpuName(),
    memoryGb: typeof n.deviceMemory === 'number' ? n.deviceMemory : undefined, fps: Number.isFinite(fps) ? Math.round(fps) : undefined,
  };
  for (const k of Object.keys(info)) if (info[k] === undefined || info[k] === '') delete info[k];
  return info;
}
// the same, as a few lines for the player to read before sending
export const describe = info => [`Game version ${info.version}`, info.userAgent, info.platform, info.screen && `Screen ${info.screen}`, info.gpu && `Graphics ${info.gpu}`, info.memoryGb && `${info.memoryGb} GB memory`, info.language, info.fps && `${info.fps} fps`].filter(Boolean).join(' · ');

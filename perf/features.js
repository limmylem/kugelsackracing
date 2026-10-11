// What this browser can do (Phase 8 Step 2; docs/PERFORMANCE.md's browser table): everything the game needs, and the
// extras it uses where they're there (with what it does instead where they aren't). The browser support test
// (tools/browsers.mjs) records it for Chrome, Edge, Firefox and Safari; the game's page checks the needed ones before
// anything loads (index.html: too old a browser is told what to use).
//
//   features() → { needed: { name: bool }, extras: { name: bool }, gpu, userAgent }

export const NEEDED = ['webgl2', 'modules', 'importMaps', 'webAssembly', 'workers', 'moduleWorkers', 'indexedDB', 'fetch', 'compressionStreams'];
export const FALLBACKS = {
  webgpu: 'WebGL 2 (the renderer the game uses everywhere: docs/PERFORMANCE.md)',
  audioWorklet: 'the engines\' simpler sound (audio/system.js: no worklet)',
  offscreenCanvas: 'canvases made on the page',
  parallelShaderCompile: 'shaders compiled at loading time, one after another',
  gpuTimer: 'frame times from the page\'s own clock (the first launch\'s benchmark)',
  battery: 'power saver "on battery" can\'t tell: "always" or off',
  memoryInfo: 'no heap figure in the overlay and the memory budget (the graphics card\'s still counted)',
  crossOriginIsolated: 'workers send their data across (transferred, not shared) — the game doesn\'t need shared memory',
};

export function features() {
  const g = globalThis, needed = {}, extras = {};
  let gl = null, gpu = '';
  try { gl = document.createElement('canvas').getContext('webgl2'); } catch { gl = null; }
  needed.webgl2 = !!gl;
  needed.modules = 'noModule' in (g.HTMLScriptElement?.prototype ?? {});
  needed.importMaps = !!g.HTMLScriptElement?.supports?.('importmap');
  needed.webAssembly = typeof g.WebAssembly === 'object';
  needed.workers = typeof g.Worker === 'function';
  needed.moduleWorkers = (() => { try { let ok = false; const w = new Worker(URL.createObjectURL(new Blob([''], { type: 'text/javascript' })), { get type() { ok = true; return 'module'; } }); w.terminate(); return ok; } catch { return false; } })();
  needed.indexedDB = !!g.indexedDB;
  needed.fetch = typeof g.fetch === 'function';
  needed.compressionStreams = typeof g.DecompressionStream === 'function';     // (the map's tiles are gzipped)
  extras.webgpu = !!g.navigator?.gpu;
  extras.audioWorklet = typeof g.AudioWorkletNode === 'function';
  extras.offscreenCanvas = typeof g.OffscreenCanvas === 'function';
  extras.parallelShaderCompile = !!gl?.getExtension('KHR_parallel_shader_compile');
  extras.gpuTimer = !!gl?.getExtension('EXT_disjoint_timer_query_webgl2');
  extras.battery = typeof g.navigator?.getBattery === 'function';
  extras.memoryInfo = !!g.performance?.memory;
  extras.crossOriginIsolated = !!g.crossOriginIsolated;
  try { const ext = gl?.getExtension('WEBGL_debug_renderer_info'); gpu = String(gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : ''); } catch { gpu = ''; }
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return { needed, extras, gpu, userAgent: g.navigator?.userAgent ?? '' };
}

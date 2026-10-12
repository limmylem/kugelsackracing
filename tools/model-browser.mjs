// Models as the game loads them, in a real browser (Phase 8 Step 3; docs/CONTENT_PIPELINE.md): three.js's GLTFLoader
// through the game's model cache (garage/visual.js) —
//   a car body made by the import pipeline: its levels of detail found (lodOf) for its meshes, fewer triangles
//   a model with a big texture made KTX2 by the pipeline (tools/content/ktx2.mjs): decoded on the graphics card (a
//   compressed texture), the transcoder fetched for it — and a model without one doesn't fetch it
//   the content bundle (garage/contentBundle.js): the data read from it; a model at its versioned address downloaded
//   once and from the browser's cache after that, after a reload too; a new version of it downloaded, the old let go
//
//   node tools/model-browser.mjs        (playwright-core and a Chromium, as the other browser checks)

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Document } from '@gltf-transform/core';
import { modelIO } from './content/io.mjs';
import { compressTextures } from './content/ktx2.mjs';
import { loadRules } from './content/rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pw;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const exe = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// the test's own files, in .scratch/ (not committed): a quad with a 512×512 texture, made KTX2; and the page
const dir = path.join(root, '.scratch/model-browser');
fs.mkdirSync(dir, { recursive: true });
{
  const doc = new Document(), buf = doc.createBuffer();
  const png = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 180, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
  const tex = doc.createTexture('photo').setImage(new Uint8Array(png)).setMimeType('image/png');
  const mat = doc.createMaterial('paint').setBaseColorTexture(tex);
  const acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', acc('VEC3', new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])))
    .setIndices(acc('SCALAR', new Uint16Array([0, 1, 2, 0, 2, 3])));
  doc.createScene('Scene').addChild(doc.createNode('quad').setMesh(doc.createMesh('quad').addPrimitive(prim)));
  await compressTextures(doc, loadRules().ktx2);
  fs.writeFileSync(path.join(dir, 'ktx2_quad.glb'), await (await modelIO()).writeBinary(doc));
}
// (a content bundle, as the site build writes one: tools/content/bundle.mjs)
const writeBundle = v => {
  fs.mkdirSync(path.join(dir, 'b/data'), { recursive: true }); fs.mkdirSync(path.join(dir, 'b/bundles'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'b/bundles/data-test.json'), JSON.stringify({ version: v, files: { 'data/finishes.json': JSON.parse(fs.readFileSync(path.join(root, 'data/finishes.json'), 'utf8')) } }));
  fs.writeFileSync(path.join(dir, 'b/data/bundle.json'), JSON.stringify({ version: v, data: 'bundles/data-test.json', models: { 'assets/cars/kaze_gt/body.glb': v } }));
};
writeBundle('aaaaaaaaaaaa');
fs.writeFileSync(path.join(dir, 'bundle.html'), `<!doctype html><meta charset="utf-8">
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/" } }</script>
<script type="module">
import { openBundle, bundled, modelUrl, CACHE_NAME } from '/garage/contentBundle.js';
import { ModelCache } from '/garage/visual.js';
const m = await openBundle({ base: '/.scratch/model-browser/b/' });
const finishes = bundled('data/finishes.json');
const url = modelUrl('/assets/cars/kaze_gt/body.glb');
await new ModelCache().acquire('/assets/cars/kaze_gt/body.glb');
await new ModelCache().acquire('/assets/cars/kaze_gt/body.glb');
const keys = (await (await caches.open(CACHE_NAME)).keys()).map(r => r.url);
window.__result = { version: m?.version, finishes: !!finishes?.finishes, url, keys };
</script>`);
fs.writeFileSync(path.join(dir, 'page.html'), `<!doctype html><meta charset="utf-8">
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/" } }</script>
<script type="module">
import * as THREE from 'three';
import { ModelCache, lodOf, setTextureRenderer } from '/garage/visual.js';
const renderer = new THREE.WebGLRenderer();
setTextureRenderer(renderer);
const cache = new ModelCache(), out = {};
const body = await cache.acquire('/assets/cars/starter_car/body.glb');
out.meshes = 0; out.withLod = 0; out.full = 0; out.far = 0;
body.traverse(o => { if (!o.isMesh) return; out.meshes++; const n = g => (g.index ? g.index.count : g.attributes.position.count) / 3; out.full += n(o.geometry); const l = lodOf(o.geometry); if (l) { out.withLod++; out.far += n(l); } });
out.transcoderBefore = performance.getEntriesByType('resource').some(e => /basis_transcoder/.test(e.name));
const quad = await cache.acquire('/.scratch/model-browser/ktx2_quad.glb');
quad.traverse(o => { if (o.isMesh && o.material.map) { out.compressed = !!o.material.map.isCompressedTexture; out.size = [o.material.map.image.width, o.material.map.image.height]; } });
out.transcoderAfter = performance.getEntriesByType('resource').some(e => /basis_transcoder/.test(e.name));
window.__result = out;
</script>`);

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(port)], { env: { ...process.env, HOST: '127.0.0.1' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) { try { await fetch(`${base}/data/finishes.json`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${what}`); if (!ok) failed++; };
const browser = await pw.chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext();
  // (three from this machine's node_modules, not the CDN: the same files)
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => {
    const rel = new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', ''), file = path.join(root, 'node_modules/three', rel);
    r.fulfill({ path: file, contentType: rel.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/.scratch/model-browser/page.html`);
  const r = await page.waitForFunction(() => window.__result, null, { timeout: 60000 }).then(h => h.jsonValue());
  check(r.withLod > 0 && r.withLod === r.meshes, `the starter car's body: all ${r.meshes} of its meshes have their LOD1`);
  check(r.far < r.full * 0.6, `drawn far away from ${r.far.toLocaleString('en-GB')} triangles, not ${r.full.toLocaleString('en-GB')}`);
  check(!r.transcoderBefore, 'no KTX2 transcoder fetched for a model without compressed textures');
  check(r.compressed === true && r.size?.[0] === 512, `a KTX2 texture decoded on the graphics card (${JSON.stringify(r.size)})`);
  check(r.transcoderAfter, 'the transcoder fetched for the model that needed it');
  // the content bundle: the data from it, a model downloaded once and cached, after a reload too
  let fetched = 0;
  await ctx.route(/kaze_gt\/body\.glb/, r => { fetched++; r.continue(); });
  await page.goto(`${base}/.scratch/model-browser/bundle.html`);
  let b = await page.waitForFunction(() => window.__result, null, { timeout: 60000 }).then(h => h.jsonValue());
  check(b.version === 'aaaaaaaaaaaa' && b.finishes, 'the data read from the content bundle');
  check(/kaze_gt\/body\.glb\?v=aaaaaaaaaaaa$/.test(b.url), `a model at its versioned address (${b.url.replace(base, '')})`);
  check(fetched === 1, `downloaded once for two cars (${fetched})`);
  await page.reload();
  b = await page.waitForFunction(() => window.__result, null, { timeout: 60000 }).then(h => h.jsonValue());
  check(fetched === 1, `after a reload, from the browser's cache: not downloaded again (${fetched} in all)`);
  writeBundle('bbbbbbbbbbbb');
  await page.reload();
  b = await page.waitForFunction(() => window.__result, null, { timeout: 60000 }).then(h => h.jsonValue());
  await page.waitForTimeout(300);
  const keys = await page.evaluate(async () => (await (await caches.open('ognistrada-content')).keys()).map(r => r.url));
  check(fetched === 2, `a new version downloaded (${fetched} in all)`);
  check(keys.some(k => k.endsWith('v=bbbbbbbbbbbb')) && !keys.some(k => k.endsWith('v=aaaaaaaaaaaa')), 'and the old one let go from the cache');
  check(!errors.length, `no errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) { check(false, `the run: ${e.message}`); }
finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed.` : '\nAll passed.');
process.exit(failed ? 1 : 0);

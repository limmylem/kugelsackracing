// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// Every car as the game draws it — its body with each stock part on its socket (garage/visual.js createCarVisual) —
// from the front three-quarter, the side, the rear three-quarter, above, straight behind and straight ahead, into one picture per car: for looking at
// the cars' models side by side (docs/MODELLING_GUIDE.md).
//
//   node server/tools/car-shots.ts --out dir [cars…] [--local-libs]

import path from 'node:path';
import fs from 'node:fs';
import { freshDatabase, testConfig, signUp, makeStaff, totp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';

const args = process.argv.slice(2), out = args[args.indexOf('--out') + 1];
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const PORT = Number(process.env.PORT ?? 8795), BASE = `http://localhost:${PORT}`;
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
fs.mkdirSync(out, { recursive: true });
const database = await freshDatabase('carshots');
const app = await buildApp({ config: testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, TRUSTED_ORIGINS: `http://localhost:8787,${BASE}` }) });
await app.listen({ port: PORT, host: '127.0.0.1' });
const boss = await makeStaff(app, await signUp(app, app.deps.mailer.outbox as any[], { email: 'shots@example.com', name: 'Sam Shots', ip: '10.9.0.7' }), 'shots@example.com', 'admin');
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r: any) => r.abort());
if (args.includes('--local-libs')) {
  const nm = path.join(REPO_DIR, 'node_modules');
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (r: any) => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
}
const page = await ctx.newPage();
page.on('pageerror', (e: any) => console.log('page error:', String(e)));
try {
  await page.goto(`${BASE}/admin/`);
  await page.evaluate(async (code: string) => { const { createApi } = await import('/account/api.js'), api = createApi(); await api.auth('/sign-in/email', { email: 'shots@example.com', password: 'correct horse battery' }); await api.auth('/two-factor/verify-totp', { code }); }, totp((boss as any).totpSecret));
  await page.goto(`${BASE}/admin/`);
  await page.waitForSelector('#tabs button');
  const cars = only.length ? only : fs.readdirSync(path.join(REPO_DIR, 'data/cars')).filter(d => fs.existsSync(path.join(REPO_DIR, 'data/cars', d, 'car.json')));
  for (const id of cars) {
    const shot = await page.evaluate(async (id: string) => {
      const THREE = await import('three'), V = await import('/garage/visual.js'), { assetUrl } = await import('/site/urls.js');
      const data = await (await fetch(`/api/v1/admin/builder/cars/${id}/preview`, { credentials: 'include' })).json();
      if (!data.car) return { error: JSON.stringify(data).slice(0, 300) };
      const W = 800, H = 450, renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(W, H); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#c9d3dc');
      const env = V.skyEnvironment(renderer); V.setEnvironment(env); scene.environment = env;
      scene.add(new THREE.HemisphereLight('#ffffff', '#555555', 1.0)); const sun = new THREE.DirectionalLight('#ffffff', 1.8); sun.position.set(4, 7, 5); scene.add(sun);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: '#9aa3ab' })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
      const models = new V.ModelCache(), url = k => k.startsWith('tyre:') ? k : assetUrl(k.startsWith('/') ? k : `/${k}`);
      const v = await V.createCarVisual({ car: { ...data.car, model: { ...data.car.model, file: url(data.car.model.file) } }, finishes: data.finishes, models: { acquire: (k, make) => models.acquire(url(k), make), release: k => models.release(url(k)) }, paint: data.car.paint ?? null });
      await v.applyBuild(data.build, { parts: data.parts, owned: data.owned });
      scene.add(v.group);
      const box = new THREE.Box3().setFromObject(v.group), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 100), d = Math.max(size.x, size.z) * 1.9;
      const views = [[0.75, 0.35, 0.8], [1, 0.12, 0], [-0.7, 0.35, -0.8], [0.0001, 1.3, 0.35], [0.0001, 0.2, -0.75], [0.0001, 0.2, 0.75]], shots = [];
      for (const [x, y, z] of views) { camera.position.set(c.x + x * d, c.y + y * d, c.z + z * d); camera.lookAt(c); renderer.render(scene, camera); shots.push(renderer.domElement.toDataURL('image/png')); }
      return { shots, size: [size.x, size.y, size.z].map(n => +n.toFixed(2)), parts: Object.keys(data.build.sockets).filter(s => data.build.sockets[s]).length };
    }, id);
    if (shot.error) { console.log(id, 'error', shot.error); continue; }
    // (the six views in a 3 × 2 sheet)
    const html = `<body style="margin:0;background:#222;color:#fff;font:20px sans-serif"><div style="padding:6px 10px">${id} — ${shot.size.join(' × ')} m, ${shot.parts} parts</div><div style="display:grid;grid-template-columns:800px 800px 800px">${shot.shots.map(s => `<img src="${s}">`).join('')}</div></body>`;
    const sheet = await ctx.newPage(); await sheet.setViewportSize({ width: 2400, height: 940 }); await sheet.setContent(html);
    await sheet.screenshot({ path: path.join(out, `${id}.png`) }); await sheet.close();
    console.log(id, shot.size.join(' × '), `${shot.parts} parts`);
  }
} finally { await browser.close(); await app.close(); await database.drop(); }
process.exit(0);

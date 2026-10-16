// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// The admin page's Devlog tab in a real browser (DEVLOG.md "From the admin page"; server/src/devlog.ts), GitHub's API a
// stand-in: the tab in the admin menu; what the video is about filled in from the highlights since the last devlog;
// the whole script written instead; a video started with the boxes as set (what GitHub was sent); the finished
// video shown with its player, Download button, the post's caption and its words; "New words, same filming" fills the
// form from it; a video still being made says which step.
//
//   node server/tools/devlog-browser.ts [--shots dir]      (playwright-core and Chromium, as content-browser.ts)

import path from 'node:path';
import zlib from 'node:zlib';
import { freshDatabase, testConfig, signUp, makeStaff, totp, endTest } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';

const args = process.argv.slice(2), shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const PORT = Number(process.env.PORT ?? 8794), BASE = `http://localhost:${PORT}`;
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };

// (GitHub, as the Devlog tab uses it: two runs, one finished with its video)
function zip(files: Record<string, Buffer>) {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const comp = zlib.deflateRawSync(data), crc = zlib.crc32(data), n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, comp); central.push(ch, n); offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const artifact = zip({ 'devlog-2026-10-15.mp4': Buffer.alloc(4000, 1), 'post.txt': Buffer.from('My racing game has a family builder 🏎️\n\n#indiedev #racinggame'), 'script.txt': Buffer.from('# notes\nHOOK: My racing game has a family builder\nMake car parts by picking options\nVoice chat in races\nEND: Race real roads in your browser\n') });
const sent: any[] = [];
const github = async (input: any, init: any = {}) => {
  const url = String(input), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
  const json = (status: number, b: any) => new Response(b == null ? null : JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/tags?per_page=100')) return json(200, [{ name: 'devlog-2026-10-08' }]);
  if (url.endsWith('/compare/devlog-2026-10-08...main')) return json(200, { files: [{ filename: 'devlog/highlights.md', patch: '+Voice chat: talk to your party anywhere\n+Make car parts on the admin page' }] });
  if (url.includes('/actions/workflows/devlog.yml/runs')) return json(200, { workflow_runs: [
    { id: 5002, status: 'in_progress', created_at: '2026-10-15T09:00:00Z', html_url: 'https://github.com/x/runs/5002' },
    { id: 5001, status: 'completed', conclusion: 'success', created_at: '2026-10-14T09:00:00Z', html_url: 'https://github.com/x/runs/5001', triggering_actor: { login: 'limmylem' } }] });
  if (method === 'POST' && url.endsWith('/dispatches')) { sent.push(body); return json(204, null); }
  if (url.endsWith('/actions/runs/5001')) return json(200, { id: 5001, path: '.github/workflows/devlog.yml', status: 'completed', conclusion: 'success', created_at: '2026-10-14T09:00:00Z', html_url: 'https://github.com/x/runs/5001' });
  if (url.endsWith('/actions/runs/5002')) return json(200, { id: 5002, path: '.github/workflows/devlog.yml', status: 'in_progress', created_at: '2026-10-15T09:00:00Z', html_url: 'https://github.com/x/runs/5002' });
  if (url.endsWith('/actions/runs/5001/jobs')) return json(200, { jobs: [{ name: 'video', steps: [{ name: 'The script', status: 'completed', conclusion: 'success' }, { name: 'The video (Remotion)', status: 'completed', conclusion: 'success' }] }] });
  if (url.endsWith('/actions/runs/5002/jobs')) return json(200, { jobs: [{ name: 'video', steps: [{ name: 'The script', status: 'completed', conclusion: 'success' }, { name: 'The gameplay, filmed (frame by frame)', status: 'in_progress', conclusion: null }] }] });
  if (url.endsWith('/actions/runs/5001/artifacts')) return json(200, { artifacts: [{ id: 61, name: 'devlog-video' }] });
  if (url.endsWith('/actions/artifacts/61/zip')) return new Response(artifact, { status: 200 });
  return json(404, { message: 'Not Found' });
};

const database = await freshDatabase('devlogbrowser');
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, TRUSTED_ORIGINS: `http://localhost:8787,${BASE}`, CONTENT_BUILDER_TOKEN: 'github_pat_test_only' });
const app = await buildApp({ config, githubFetch: github as any });
await app.listen({ port: PORT, host: '127.0.0.1' });
const boss = await makeStaff(app, await signUp(app, app.deps.mailer.outbox as any[], { email: 'boss@example.com', name: 'Bea Boss', ip: '10.9.0.5' }), 'boss@example.com', 'admin');
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-proxy-server'] });
const errors: string[] = [];
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r: any) => r.abort());
page.on('pageerror', (e: any) => errors.push(String(e)));
page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource|MEDIA_ERR|video/i.test(m.text())) errors.push(m.text()); });
page.on('dialog', async (d: any) => d.type() === 'prompt' ? d.accept('Test: this week\'s video') : d.accept());
const shot = async (name: string) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
const left = 'main > section:nth-child(1)', right = 'main > section:nth-child(2)';

try {
  await page.goto(`${BASE}/admin/`);
  await page.evaluate(async (code: string) => { const { createApi } = await import('/account/api.js'), api = createApi(); await api.auth('/sign-in/email', { email: 'boss@example.com', password: 'correct horse battery' }); await api.auth('/two-factor/verify-totp', { code }); }, totp((boss as any).totpSecret));
  await page.goto(`${BASE}/admin/`);
  await page.waitForSelector('#tabs button');
  await page.click('#tabs button:has-text("Devlog")');
  await page.waitForSelector(`${left} textarea`, { timeout: 30000 });
  const focus = await page.inputValue(`${left} textarea`);
  check('the Devlog tab: what the video is about, filled in from the highlights since the last devlog', /Voice chat: talk to your party anywhere\nMake car parts on the admin page/.test(focus), JSON.stringify(focus));
  await page.waitForSelector(`${right} .action:has-text("making it")`, { timeout: 30000 });
  const going = await page.textContent(`${right} .action`);
  check('a video being made: which step it\'s at', /The gameplay, filmed/.test(going), going.slice(0, 160));
  await shot('devlog-tab');

  // what it's about, as typed → the workflow's boxes
  await page.fill(`${left} textarea`, 'HOOK: Build your own car parts\nA family builder on the admin page\nVoice chat in races');
  await page.selectOption(`${left} label:has-text("What to film") select`, 'live');
  await page.uncheck(`${left} label:has-text("this week's devlog") input`);
  await page.click(`${left} button:has-text("Make the video")`);
  await page.waitForSelector(`${left} .msg.good`, { timeout: 15000 });
  const s = sent.pop()?.inputs;
  check('Make the video: what it\'s about and the boxes as set, sent to the devlog workflow', s?.focus === 'HOOK: Build your own car parts | A family builder on the admin page | Voice chat in races' && s.target === 'live' && s.tag === 'false' && s.multiplayer === 'true' && s.script === '', JSON.stringify(s));

  // the finished video
  await page.click(`${right} .list .action:has-text("ready")`);
  await page.waitForSelector(`${right} video`, { timeout: 30000 });
  const v = await page.$eval(`${right} video`, (e: any) => e.getAttribute('src'));
  const dl = await page.$eval(`${right} a:has-text("Download the video")`, (e: any) => e.getAttribute('href'));
  const done = await page.textContent(`${right} .action`);
  check('a finished video: its player, Download, the post\'s caption and its words', v === '/api/v1/admin/devlog/runs/5001/video' && dl === `${v}?download=1` && /#indiedev/.test(done) && /Copy the post/.test(done), `${v} · ${dl}`);
  const bytes = await page.evaluate(async (src: string) => (await (await fetch(src)).arrayBuffer()).byteLength, v);
  check('the video itself, from GitHub\'s artifact', bytes === 4000, String(bytes));
  await shot('devlog-video');

  // new words over the same filming
  await page.click(`${right} button:has-text("New words, same filming")`);
  await page.waitForSelector(`${left} input[placeholder="My racing game now has…"]`, { timeout: 15000 });
  const hook = await page.inputValue(`${left} input[placeholder="My racing game now has…"]`);
  const caps = await page.$$eval(`${left} input[placeholder^="Caption"]`, (is: any[]) => is.map(i => i.value));
  const reuse = await page.inputValue(`${left} label:has-text("Use the filming") select`);
  check('"New words, same filming": the form filled in from it, its filming picked', hook === 'My racing game has a family builder' && caps.join('|') === 'Make car parts by picking options|Voice chat in races' && reuse === '5001', `${hook} · ${caps.join('|')} · ${reuse}`);
  await page.fill(`${left} input[placeholder="Caption 1"]`, 'Make car parts by ticking boxes');
  await page.click(`${left} button:has-text("Make it")`);
  await page.waitForSelector(`${left} .msg.good`, { timeout: 15000 });
  const s2 = sent.pop()?.inputs;
  check('the whole script written: sent as the workflow\'s script, with the earlier filming', s2?.script === 'My racing game has a family builder | Make car parts by ticking boxes | Voice chat in races | END: Race real roads in your browser' && s2.reuse_clips_from === '5001' && s2.focus === '', JSON.stringify(s2));
  check('no errors on the page', !errors.length, errors.slice(0, 3).join(' | '));
} catch (err) {
  check('the browser check ran through', false, err.stack ?? String(err));
  await shot('devlog-error');
} finally {
  await browser.close();
  await app.close();
  await database.drop();
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  endTest(failed);
}

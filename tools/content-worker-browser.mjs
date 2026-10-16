// The world content service in a Web Worker (content/worker.js, content/workerService.js), in a browser: the page's
// content (content/client.js, no game server) runs in a worker; items made, edited, published and queried there answer
// as the service on the page does (?contentWorker=0); change events reach the page; changes are kept after a reload
// (IndexedDB, from the worker); a query over 3,000 quests nearby leaves the page's frames alone. Fails on any page error.
// Needs playwright-core and a Chromium (CHROMIUM=/path/to/chrome).
//
//   node tools/content-worker-browser.mjs

import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname, port = 7748;
let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { console.error('This needs playwright-core: npm i -D playwright-core'); process.exit(2); }
const server = spawn('node', ['tools/serve.mjs', String(port)], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failed = 0;
const ok = (cond, what, detail = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}${detail ? `  ${detail}` : ''}`); if (!cond) failed++; };

// (one run on a fresh page: the same steps, in the worker or on the page)
async function run(ctx, worker) {
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404|api\/|fonts|tunnel/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:${port}/index.html${worker ? '' : '?contentWorker=0'}`);
  const r = await page.evaluate(async () => {
    const { worldContent } = await import('/content/client.js'), { newItem } = await import('/content/quests.js');
    const C = await worldContent(), S = C.service, events = [];
    S.on(e => events.push(e.type));
    const at = { lat: -34.9285, lon: 138.6007 };
    const made = await S.create(newItem('poi', { location: at, name: 'Worker test lookout', now: new Date().toISOString() }));
    const moved = await S.update(made.item.id, { ...made.item, name: 'Worker test lookout, renamed' });
    const pub = await S.publish(made.item.id);
    const near = await S.query({ ...at, km: 2, view: 'published' });
    await S.flush();
    await new Promise(r => setTimeout(r, 300));
    return { worker: !!S.worker, id: made.item.id, renamed: moved.item?.name, published: pub.ok, found: near.items.some(x => x.item.id === made.item.id), events, pending: S.pending, persistent: C.persistent };
  });
  return { page, errors, r };
}

try {
  for (const worker of [true, false]) {
    console.log(worker ? 'In the worker' : 'On the page (?contentWorker=0)');
    const ctx = await browser.newContext();
    const { page, errors, r } = await run(ctx, worker);
    ok(r.worker === worker, worker ? 'the service runs in a worker' : 'the service runs on the page');
    ok(r.renamed === 'Worker test lookout, renamed' && r.published && r.found, 'made, edited, published, found nearby', `${r.id}`);
    ok(['create', 'update', 'publish'].every(t => r.events.includes(t)), 'its changes heard on the page', r.events.join(', '));
    ok(r.persistent && r.pending === false, 'kept in IndexedDB, nothing left to save');
    // (kept: a new page in the same browser finds it)
    await page.reload();
    const again = await page.evaluate(async id => { const { worldContent } = await import('/content/client.js'); const C = await worldContent(); return (await C.service.get(id, { view: 'published' })).item?.name ?? null; }, r.id);
    ok(again === 'Worker test lookout, renamed', 'still there after a reload');
    if (worker) {
      // (thousands of quests nearby: the page's frames go on while the worker answers)
      const frames = await page.evaluate(async () => {
        const { worldContent } = await import('/content/client.js'), { newItem } = await import('/content/quests.js');
        const S = (await worldContent()).service, now = new Date().toISOString(), entries = [];
        for (let i = 0; i < 3000; i++) { const it = { ...newItem('poi', { location: { lat: -34.93 + (i % 60) * 0.0004, lon: 138.6 + Math.floor(i / 60) * 0.0004 }, name: `Spot ${i}`, now }), id: `poi_bulk${i}`, status: 'published', publishedAt: now }; entries.push({ draft: it, published: it, archived: null }); }
        const imp = await S.importContent(JSON.stringify({ format: 'world-content', version: (await import('/content/quests.js')).CONTENT_VERSION, entries }));
        let worst = 0, last = performance.now(), going = true;
        const tick = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; if (going) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        const t0 = performance.now();
        for (let k = 0; k < 10; k++) await S.query({ lat: -34.92, lon: 138.61, km: 5, view: 'published', limit: 2000 });
        const ms = performance.now() - t0;
        going = false;
        return { imported: imp.imported, queriesMs: Math.round(ms), worstFrameMs: Math.round(worst) };
      });
      ok(frames.imported === 3000, '3,000 places imported', `${frames.imported}`);
      ok(frames.worstFrameMs < 100, 'the page kept drawing while it answered 10 queries', `${frames.queriesMs} ms of queries, worst frame ${frames.worstFrameMs} ms`);
    }
    ok(!errors.length, 'no page errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
} catch (e) { console.error(e); failed++; }
await browser.close(); server.kill();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);

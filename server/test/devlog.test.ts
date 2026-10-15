// The admin page's Devlog tab (server/src/devlog.ts, DEVLOG.md "From the admin page"): admins only; what this week's
// video is about filled in from the highlights added since the last devlog tag; a video started with every box the
// workflow has (what it's about, or the whole script) and in the admins' log; its run read back with its steps; the
// finished video unpacked from its artifact and served (whole, and in byte ranges for the player) with its script and
// the post's caption; a run stopped. GitHub's API is a stand-in here.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { sql } from 'drizzle-orm';
import { testApp, signUp, makeStaff, Player } from './helpers.ts';
import { unzip } from '../src/devlog.ts';

const D = '/api/v1/admin/devlog';
// (a zip, as GitHub's artifacts come: deflated entries, a central directory)
function zip(files: Record<string, Buffer>) {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const comp = zlib.deflateRawSync(data), crc = zlib.crc32(data), n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, comp); central.push(ch, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const mp4 = Buffer.alloc(5000, 7), video = zip({ 'devlog-2026-10-15.mp4': mp4, 'post.txt': Buffer.from('Build your own car parts 🏎️\n#indiedev'), 'script.txt': Buffer.from('# notes\nHOOK: Build your own car parts\nA family builder\nEND: Race real roads in your browser\n') });

const calls: { method: string; url: string; body: any }[] = [];
const github: typeof fetch = async (input: any, init: any = {}) => {
  const url = String(input), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, url, body });
  const json = (status: number, b: any) => new Response(b == null ? null : JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/tags?per_page=100')) return json(200, [{ name: 'devlog-2026-10-08' }, { name: 'devlog-2026-10-01' }, { name: 'v1' }]);
  if (url.endsWith('/compare/devlog-2026-10-08...main')) return json(200, { total_commits: 42, files: [{ filename: 'devlog/highlights.md', patch: '@@ -1 +1,3 @@\n+Voice chat in races\n+# a note\n+HOOK: Talk while you race' }] });
  if (url.includes('/actions/workflows/devlog.yml/runs')) return json(200, { workflow_runs: [{ id: 9001, status: 'completed', conclusion: 'success', created_at: '2026-10-15T01:00:00Z', html_url: 'https://github.com/x/runs/9001', triggering_actor: { login: 'limmylem' } }, { id: 9002, status: 'in_progress', created_at: '2026-10-15T02:00:00Z', html_url: 'https://github.com/x/runs/9002' }] });
  if (method === 'POST' && url.endsWith('/actions/workflows/devlog.yml/dispatches')) return json(204, null);
  if (url.endsWith('/actions/runs/9001')) return json(200, { id: 9001, path: '.github/workflows/devlog.yml', status: 'completed', conclusion: 'success', created_at: '2026-10-15T01:00:00Z', html_url: 'https://github.com/x/runs/9001' });
  if (url.endsWith('/actions/runs/9001/jobs')) return json(200, { jobs: [{ name: 'video', steps: [{ name: 'The script', status: 'completed', conclusion: 'success' }, { name: 'The video (Remotion)', status: 'completed', conclusion: 'success' }] }] });
  if (url.endsWith('/actions/runs/9001/artifacts')) return json(200, { artifacts: [{ id: 77, name: 'devlog-clips' }, { id: 78, name: 'devlog-video', expired: false }] });
  if (url.endsWith('/actions/artifacts/78/zip')) return new Response(null, { status: 302, headers: { location: 'https://storage.example.test/artifact-78.zip' } });
  if (url === 'https://storage.example.test/artifact-78.zip') return new Response(video, { status: 200 });
  if (method === 'POST' && url.endsWith('/actions/runs/9002/cancel')) return json(202, null);
  return json(404, { message: 'Not Found' });
};

let T: Awaited<ReturnType<typeof testApp>>, admin: Player, player: Player;
before(async () => {
  T = await testApp('devlog', { env: { CONTENT_BUILDER_TOKEN: 'github_pat_test_only' }, githubFetch: github });
  [admin, player] = await Promise.all([signUp(T.app, T.outbox, { email: 'adm@example.com', name: 'Ada Devlog', ip: '10.14.0.1' }), signUp(T.app, T.outbox, { email: 'pla@example.com', name: 'Pat Player', ip: '10.14.0.2' })]);
  await makeStaff(T.app, admin, 'adm@example.com', 'admin');
});
after(async () => { await T?.close(); });

test('a zip as GitHub\'s artifacts come is unpacked', () => {
  const f = unzip(video);
  assert.deepEqual(Object.keys(f).sort(), ['devlog-2026-10-15.mp4', 'post.txt', 'script.txt']);
  assert.ok(f['devlog-2026-10-15.mp4'].equals(mp4));
});

test('only admins reach the Devlog tab', async () => {
  assert.equal((await player.get(D)).status, 403);
  assert.equal((await player.post(`${D}/runs`, { reason: 'trying' })).status, 403);
  assert.equal((await new Player(T.app, '10.14.0.9').get(D)).status, 401);
});

test('the tab: its videos, and what this one is about filled in from the highlights since the last devlog', async () => {
  const r = await admin.get(D);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.canRun, true);
  assert.deepEqual(r.body.runs.map((x: any) => [x.id, x.state]), [[9001, 'done'], [9002, 'running']]);
  assert.equal(r.body.highlights.since, 'devlog-2026-10-08');
  assert.deepEqual(r.body.highlights.lines, ['Voice chat in races', 'HOOK: Talk while you race']);
});

test('making one: every box sent to the devlog workflow, and in the admins\' log', async () => {
  const bad = await admin.post(`${D}/runs`, { musicUrl: 'http://not-https.example/x.mp3', reason: 'Test: a video' });
  assert.equal(bad.status, 400);
  const r = await admin.post(`${D}/runs`, { focus: 'Voice chat in races | HOOK: Talk while you race', target: 'live', multiplayer: false, reuseClipsFrom: '9001', tag: false, reason: 'Test: this week\'s video' });
  assert.equal(r.status, 200, r.text);
  const d = calls.filter(c => c.method === 'POST' && c.url.endsWith('/dispatches')).pop()!;
  assert.equal(d.body.ref, 'main');
  assert.deepEqual(d.body.inputs, { script: '', focus: 'Voice chat in races | HOOK: Talk while you race', target: 'live', multiplayer: 'false', music_url: '', reuse_clips_from: '9001', tag: 'false' });
  const log = (await T.app.deps.db.execute(sql`select action, reason from audit_log where action like 'devlog-%' order by at`)).rows as any[];
  assert.deepEqual(log.map(x => x.action), ['devlog-run']);
});

test('a finished video: its steps, the video (whole and in byte ranges), its script and the post\'s caption', async () => {
  const r = await admin.get(`${D}/runs/9001`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.state, 'done'); assert.equal(r.body.video, 'devlog-2026-10-15.mp4');
  assert.match(r.body.post, /Build your own car parts/); assert.match(r.body.script, /HOOK: Build your own car parts/);
  assert.deepEqual(r.body.steps.map((s: any) => s.name), ['The script', 'The video (Remotion)']);
  const whole = await T.app.inject({ method: 'GET', url: `${D}/runs/9001/video?download=1`, headers: { cookie: admin.cookieHeader } });
  assert.equal(whole.statusCode, 200); assert.equal(whole.headers['content-type'], 'video/mp4'); assert.equal(whole.rawPayload.length, 5000);
  assert.match(String(whole.headers['content-disposition']), /devlog-2026-10-15\.mp4/);
  const part = await T.app.inject({ method: 'GET', url: `${D}/runs/9001/video`, headers: { cookie: admin.cookieHeader, range: 'bytes=100-199' } });
  assert.equal(part.statusCode, 206); assert.equal(part.headers['content-range'], 'bytes 100-199/5000'); assert.equal(part.rawPayload.length, 100);
});

test('a run stopped, in the admins\' log', async () => {
  const r = await admin.post(`${D}/runs/9002/cancel`, { reason: 'Test: not this one' });
  assert.equal(r.status, 200, r.text);
  assert.ok(calls.some(c => c.method === 'POST' && c.url.endsWith('/actions/runs/9002/cancel')));
});

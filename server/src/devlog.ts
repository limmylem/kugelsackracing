// The admin page's Devlog tab (DEVLOG.md "From the admin page"): the devlog workflow (.github/workflows/devlog.yml)
// run from here — every box it has, and what this video is about written here (in place of devlog/highlights.md's new
// lines) — its runs followed (waiting, filming, rendering, done or the step that failed), and the finished video played
// here with its script and the post's caption, from the run's devlog-video artifact. Admins only; each run started or
// cancelled is in the admins' log, with who and why. Through GitHub's API with CONTENT_BUILDER_TOKEN (./github.ts).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Db } from './db/index.ts';
import { auditLog } from './db/schema.ts';
import { AppError, badRequest, notFound } from './errors.ts';
import { REPO_DIR } from './config.ts';
import type { GithubApi } from './github.ts';

export const WORKFLOW = 'devlog.yml';
const HIGHLIGHTS = 'devlog/highlights.md';
const CACHE = path.join(os.tmpdir(), 'kr-devlog');
export type Actor = { id: string; name: string };
export type RunInput = { focus?: string; script?: string; target?: 'local' | 'live'; multiplayer?: boolean; musicUrl?: string; reuseClipsFrom?: string; tag?: boolean };

// The files in a zip (GitHub's artifacts): { name → bytes }, stored or deflated (no zip64: a devlog's files are small)
export function unzip(buf: Buffer): Record<string, Buffer> {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('That isn\'t a zip.');
  const count = buf.readUInt16LE(end + 10), out: Record<string, Buffer> = {};
  let p = buf.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('A broken zip.');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(start, start + size);
    if (!name.endsWith('/')) out[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function createDevlog(db: Db, { github, log = (..._: any[]) => {} }: { github: GithubApi | null; log?: (...a: any[]) => void }) {
  let highlightsCache: { at: number; value: any } | null = null;

  const need = () => { if (!github?.ready()) throw new AppError(409, 'CONFLICT', 'The Devlog tab needs the GitHub token (the CONTENT_BUILDER_TOKEN secret: docs/DEPLOYMENT.md "The live Builder").'); return github!; };
  const call = async (method: string, p: string, body?: object) => { try { return await need().call(method, p, body); } catch (err: any) { if (err instanceof AppError) throw err; throw new AppError(409, 'CONFLICT', err.message); } };
  async function audit(actor: Actor, action: string, reason: string, details: object) {
    await db.insert(auditLog).values({ actorId: actor.id, action, targetId: null, reason, details });
  }

  // (a run, as the tab shows it)
  function view(run: any, steps: any[] | null = null) {
    const state = ['queued', 'waiting', 'requested', 'pending'].includes(run.status) ? 'waiting' : run.status !== 'completed' ? 'running'
      : run.conclusion === 'success' ? 'done' : run.conclusion === 'cancelled' ? 'cancelled' : 'failed';
    const ours = (steps ?? []).filter((s: any) => !/^(Set up job|Complete job|Post |Run actions\/|Run npm ci)/.test(s.name));
    return {
      id: run.id, state, created: run.created_at, updated: run.updated_at, url: run.html_url, by: run.triggering_actor?.login ?? null, event: run.event,
      step: state === 'running' ? ours.find((s: any) => s.status === 'in_progress')?.name ?? null : null,
      failedStep: state === 'failed' ? ours.find((s: any) => s.conclusion === 'failure')?.name ?? null : null,
      steps: steps ? ours.map((s: any) => ({ name: s.name, status: s.status, conclusion: s.conclusion })) : null,
    };
  }
  async function steps(id: number) {
    const r = await call('GET', `/actions/runs/${id}/jobs`);
    return (r?.jobs ?? []).find((j: any) => j.name === 'video')?.steps ?? r?.jobs?.[0]?.steps ?? [];
  }

  // What this week's video would be about now: devlog/highlights.md's lines added since the last devlog-* tag (as the
  // draft reads them) — from GitHub, as the workflow will see them
  async function highlights() {
    if (highlightsCache && Date.now() - highlightsCache.at < 60_000) return highlightsCache.value;
    const clean = (lines: string[]) => lines.map(l => l.trim().replace(/^[-*•]\s*/, '')).filter(l => l && !l.startsWith('#') && !l.startsWith('<!--'));
    let value: any;
    try {
      const tags: any[] = await call('GET', '/tags?per_page=100');
      const last = tags.map(t => t.name).filter((n: string) => /^devlog-\d{4}-\d{2}-\d{2}$/.test(n)).sort().pop() ?? null;
      if (last) {
        const cmp = await call('GET', `/compare/${last}...main`);
        const f = (cmp.files ?? []).find((x: any) => x.filename === HIGHLIGHTS);
        value = { since: last, lines: clean(String(f?.patch ?? '').split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1))), commits: cmp.total_commits ?? null };
      } else value = { since: null, lines: clean(fs.readFileSync(path.join(REPO_DIR, HIGHLIGHTS), 'utf8').split('\n')).slice(-6), commits: null };
    } catch (err: any) {
      value = { since: null, lines: [], error: err.message };
    }
    highlightsCache = { at: Date.now(), value };
    return value;
  }

  // The run's devlog-video artifact, unpacked once (the MP4, script.txt, post.txt) into the container's temporary folder
  async function files(id: number) {
    const dir = path.join(CACHE, String(id));
    if (fs.existsSync(path.join(dir, '.done'))) return dir;
    const list = await call('GET', `/actions/runs/${id}/artifacts`);
    const a = (list?.artifacts ?? []).find((x: any) => x.name === 'devlog-video');
    if (!a) throw notFound('That run\'s video (it has no devlog-video yet)');
    if (a.expired) throw new AppError(410, 'NOT_FOUND', 'That video has expired on GitHub (videos are kept 30 days).');
    let zip: Buffer;
    try { zip = await need().bytes(`/actions/artifacts/${a.id}/zip`); } catch (err: any) { throw new AppError(409, 'CONFLICT', err.message); }
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, bytes] of Object.entries(unzip(zip))) fs.writeFileSync(path.join(dir, path.basename(name)), bytes);
    fs.writeFileSync(path.join(dir, '.done'), '');
    return dir;
  }

  return {
    available: () => !!github?.ready(),
    async overview() {
      if (!github?.ready()) return { canRun: false, runs: [], highlights: { since: null, lines: [] } };
      const r = await call('GET', `/actions/workflows/${WORKFLOW}/runs?per_page=15`);
      return { canRun: true, runs: (r?.workflow_runs ?? []).map((x: any) => view(x)), highlights: await highlights() };
    },
    async run(input: RunInput, actor: Actor, reason: string) {
      if (input.musicUrl && !/^https:\/\/\S+$/.test(input.musicUrl)) throw badRequest('The music link must be a direct https:// link.');
      if (input.reuseClipsFrom && !/^\d{1,20}$/.test(input.reuseClipsFrom)) throw badRequest('"Use the filming from" is a run\'s number (from its address).');
      const inputs = {
        script: input.script?.trim() ?? '', focus: input.focus?.trim() ?? '', target: input.target ?? 'local', multiplayer: String(input.multiplayer ?? true),
        music_url: input.musicUrl ?? '', reuse_clips_from: input.reuseClipsFrom ?? '', tag: String(input.tag ?? true),
      };
      await call('POST', `/actions/workflows/${WORKFLOW}/dispatches`, { ref: 'main', inputs });
      await audit(actor, 'devlog-run', reason, { inputs: { ...inputs, script: inputs.script.slice(0, 300), focus: inputs.focus.slice(0, 300) } });
      return { started: true };
    },
    async detail(id: number) {
      const run = await call('GET', `/actions/runs/${id}`);
      if (run?.path && !String(run.path).endsWith(WORKFLOW)) throw notFound('That devlog run');
      const v: any = view(run, await steps(id));
      if (v.state === 'done') {
        try {
          const dir = await files(id), read = (f: string) => fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null;
          v.video = fs.readdirSync(dir).find(f => f.endsWith('.mp4')) ?? null;
          v.script = read('script.txt'); v.post = read('post.txt');
        } catch (err: any) { v.filesError = err.message; }
      }
      return v;
    },
    // the run's MP4 (for the page's player and its Download button)
    async video(id: number) {
      const dir = await files(id), f = fs.readdirSync(dir).find(x => x.endsWith('.mp4'));
      if (!f) throw notFound('That run\'s video');
      return { file: path.join(dir, f), name: f };
    },
    async cancel(id: number, actor: Actor, reason: string) {
      await call('POST', `/actions/runs/${id}/cancel`);
      await audit(actor, 'devlog-cancel', reason, { run: id });
      return { cancelled: true };
    },
  };
}
export type Devlog = ReturnType<typeof createDevlog>;

// The live Builder's jobs on GitHub (config contentBuilder.mode 'github'; docs/CONTENT_PIPELINE.md "A family from the
// admin page"): the live server hasn't the repository's files, so what an admin makes or changes is sent to the
// content-builder workflow (.github/workflows/content-builder.yml) as a request — made there with the same code as on a
// computer (npm run content -- run-job), checked as a commit is, committed to main, and the deploy started (the owner
// approves it on GitHub). Its runs are read back as the Builder's jobs: waiting, running (its steps), done or failed
// (which step) — so the Jobs list shows them as it shows a computer's. The token (CONTENT_BUILDER_TOKEN) only starts,
// reads and cancels workflow runs.

export type RemoteJob = {
  id: string; type: string; target: string; title: string; by: { id: string | null; name: string } | null; reason: string; created: string;
  state: 'waiting' | 'running' | 'done' | 'failed' | 'cancelled'; step: string | null; progress: null; log: { text: string; kind: string }[];
  error: string | null; problems: string[]; result: any; url: string | null; remote: true;
};
type Sent = Pick<RemoteJob, 'id' | 'type' | 'target' | 'title' | 'by' | 'reason' | 'created'>;

export const WORKFLOW = 'content-builder.yml';
// (what GitHub takes in a workflow's inputs: about 65,000 characters in all)
const MAX_REQUEST = 60_000;

export function createGithubRunner({ repo, token, fetchFn = fetch, api = 'https://api.github.com', now = () => Date.now() }:
  { repo: string; token: string | null; fetchFn?: typeof fetch; api?: string; now?: () => number }) {
  const sent = new Map<string, Sent>();
  const steps = new Map<number, { at: number; list: { name: string; status: string; conclusion: string | null }[] }>();
  let cache: { at: number; runs: any[] } = { at: 0, runs: [] };

  async function gh(method: string, p: string, body?: object) {
    if (!token) throw new Error('The live Builder needs its GitHub token (the CONTENT_BUILDER_TOKEN secret: docs/DEPLOYMENT.md "The live Builder"), so it can\'t make anything yet.');
    const r = await fetchFn(`${api}/repos/${repo}${p}`, {
      method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'kugelsack-builder', ...(body && { 'content-type': 'application/json' }) },
      ...(body && { body: JSON.stringify(body) }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      let message = text.slice(0, 200);
      try { message = JSON.parse(text).message ?? message; } catch { /* (not JSON) */ }
      throw new Error(r.status === 401 || r.status === 403 ? `GitHub refused the Builder's token (${r.status}: ${message}): it may have expired, or lack Actions read and write on ${repo}.` : `GitHub said ${r.status}: ${message}`);
    }
    return r.status === 204 || r.status === 202 ? null : r.json();
  }
  async function runs(force = false) {
    if (!force && now() - cache.at < 8000) return cache.runs;
    const r: any = await gh('GET', `/actions/workflows/${WORKFLOW}/runs?per_page=40&event=workflow_dispatch`);
    cache = { at: now(), runs: r?.workflow_runs ?? [] };
    return cache.runs;
  }
  const idOf = (run: any) => { const m = /^builder (\S+): (.*)$/s.exec(run?.display_title ?? ''); return m ? { id: m[1], title: m[2] } : null; };
  const runOf = async (id: string, force = false) => (await runs(force)).find(r => idOf(r)?.id === id) ?? null;
  async function stepsOf(run: any, force = false) {
    const had = steps.get(run.id);
    if (had && (run.status === 'completed' || (!force && now() - had.at < 8000))) return had.list;
    const r: any = await gh('GET', `/actions/runs/${run.id}/jobs`);
    const list = (r?.jobs?.[0]?.steps ?? []).map((s: any) => ({ name: s.name, status: s.status, conclusion: s.conclusion }));
    steps.set(run.id, { at: now(), list });
    return list;
  }
  // (a run as the Builder's job)
  function view(s: Sent | null, run: any, list: { name: string; status: string; conclusion: string | null }[] | null): RemoteJob {
    const named = run ? idOf(run) : null;
    const base: Sent = s ?? { id: named!.id, type: 'family', target: '', title: named!.title, by: null, reason: '', created: run.created_at };
    const state: RemoteJob['state'] = !run || ['queued', 'waiting', 'requested', 'pending'].includes(run.status) ? 'waiting' : run.status !== 'completed' ? 'running'
      : run.conclusion === 'success' ? 'done' : run.conclusion === 'cancelled' ? 'cancelled' : 'failed';
    const ours = (list ?? []).filter(x => !/^(Set up job|Complete job|Post |Run actions\/)/.test(x.name));
    const failedStep = ours.find(x => x.conclusion === 'failure')?.name ?? null;
    const log = [{ text: 'Sent to GitHub: made, checked and committed by the content-builder workflow (about 15–20 minutes), then the deploy waits for your approval.', kind: '' },
      ...(run ? [{ text: `On GitHub: ${run.html_url}`, kind: '' }] : []),
      ...ours.filter(x => x.status !== 'queued').map(x => ({ text: `${x.conclusion === 'success' ? '✔' : x.conclusion === 'failure' ? '✘' : x.conclusion === 'skipped' ? '–' : '…'} ${x.name}`, kind: x.conclusion === 'failure' ? 'bad' : x.conclusion === 'success' ? 'good' : '' }))];
    const step = state === 'running' ? ours.find(x => x.status === 'in_progress')?.name ?? null : null;
    return {
      ...base, state, step, progress: null, log, url: run?.html_url ?? null, remote: true, problems: [],
      error: state === 'failed' ? `It didn't pass${failedStep ? ` "${failedStep}"` : ''}, so nothing was committed: the reason is in its log on GitHub (${run.html_url}).` : null,
      result: state === 'done' ? { words: 'Made, checked and committed to main. The deploy has started: approve it on GitHub (Actions → server → Review deployments → production → Approve and deploy) and it goes live — its parts arrive in the Content tab as drafts.' } : null,
    };
  }

  return {
    ready: () => !!token,
    // A request sent to be made (its title in the run's name, so its run can be found again)
    async dispatch(s: Sent, request: object) {
      const body = Buffer.from(JSON.stringify({ id: s.id, by: { name: s.by?.name ?? 'an admin' }, reason: s.reason, request })).toString('base64');
      if (body.length > MAX_REQUEST) throw new Error('That\'s too big to send to GitHub in one go: make it in smaller pieces.');
      await gh('POST', `/actions/workflows/${WORKFLOW}/dispatches`, { ref: 'main', inputs: { id: s.id, title: s.title.slice(0, 120), request: body } });
      sent.set(s.id, s);
      cache.at = 0;
      return view(s, null, null);
    },
    async list(): Promise<RemoteJob[]> {
      if (!token) return [];
      const rs = await runs(), seen = new Set<string>(), out: RemoteJob[] = [];
      for (const run of rs) { const n = idOf(run); if (!n) continue; seen.add(n.id); out.push(view(sent.get(n.id) ?? null, run, steps.get(run.id)?.list ?? null)); }
      for (const s of sent.values()) if (!seen.has(s.id)) out.push(view(s, null, null));
      return out;
    },
    async get(id: string): Promise<RemoteJob | null> {
      if (!token) return null;
      const run = await runOf(id);
      if (!run) { const s = sent.get(id); return s ? view(s, null, null) : null; }
      return view(sent.get(id) ?? null, run, await stepsOf(run));
    },
    async cancel(id: string) {
      const run = await runOf(id, true);
      if (!run) throw new Error('GitHub hasn\'t started that one yet: try again in a few seconds.');
      if (run.status !== 'completed') await gh('POST', `/actions/runs/${run.id}/cancel`);
      cache.at = 0;
      return view(sent.get(id) ?? null, { ...run, status: 'completed', conclusion: 'cancelled' }, steps.get(run.id)?.list ?? null);
    },
    // (the jobs sent from here still going: watched so a change's hold is applied once it's made)
    pending: () => [...sent.keys()],
    forget: (id: string) => { sent.delete(id); },
  };
}
export type GithubRunner = ReturnType<typeof createGithubRunner>;

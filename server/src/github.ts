// GitHub's API, as the admin page's tools use it (the live Builder's jobs: content/github.ts; the Devlog tab:
// devlog.ts): this repository's workflows started, read and cancelled, and their artifacts fetched, with the token in
// CONTENT_BUILDER_TOKEN (a fine-grained token for this repository with only Actions read and write:
// docs/DEPLOYMENT.md "The live Builder").

export function githubApi({ repo, token, fetchFn = fetch, api = 'https://api.github.com' }: { repo: string; token: string | null; fetchFn?: typeof fetch; api?: string }) {
  const headers = () => ({ authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'kugelsack-admin' });
  async function failed(r: Response) {
    const text = await r.text().catch(() => '');
    let message = text.slice(0, 200);
    try { message = JSON.parse(text).message ?? message; } catch { /* (not JSON) */ }
    return new Error(r.status === 401 || r.status === 403 ? `GitHub refused the token (${r.status}: ${message}): it may have expired, or lack Actions read and write on ${repo}.` : `GitHub said ${r.status}: ${message}`);
  }
  function need() { if (!token) throw new Error('This needs the GitHub token (the CONTENT_BUILDER_TOKEN secret: docs/DEPLOYMENT.md "The live Builder").'); }
  return {
    repo,
    ready: () => !!token,
    // a JSON call on this repository (p from /repos/<repo>)
    async call(method: string, p: string, body?: object): Promise<any> {
      need();
      const r = await fetchFn(`${api}/repos/${repo}${p}`, { method, headers: { ...headers(), ...(body && { 'content-type': 'application/json' }) }, ...(body && { body: JSON.stringify(body) }) });
      if (!r.ok) throw await failed(r);
      return r.status === 204 || r.status === 202 ? null : r.json();
    },
    // bytes (an artifact's zip): GitHub answers with a redirect to its storage, which takes no token
    async bytes(p: string): Promise<Buffer> {
      need();
      const r = await fetchFn(`${api}/repos/${repo}${p}`, { headers: headers(), redirect: 'manual' });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        const s = await fetchFn(r.headers.get('location')!);
        if (!s.ok) throw await failed(s);
        return Buffer.from(await s.arrayBuffer());
      }
      if (!r.ok) throw await failed(r);
      return Buffer.from(await r.arrayBuffer());
    },
  };
}
export type GithubApi = ReturnType<typeof githubApi>;

// Leaked secrets in the repository (Phase 6 Step 5, docs/SECURITY.md): every file tracked now and — with --history —
// every change ever committed, matched against the shapes of real credentials (cloud keys, tokens, private keys,
// database URLs with a password on a real host, secrets assigned in env files). Exits 1 with each find (its file
// and commit, the secret itself masked) so CI fails; known test-only values are allowed by name.
//
//   node tools/scan-secrets.mjs              the files as they are
//   node tools/scan-secrets.mjs --history    and every commit's changes (CI: weekly, and on main)

import { execFileSync, spawn } from 'node:child_process';
import readline from 'node:readline';

const RULES = [
  ['AWS access key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Stripe live key', /\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b/],
  ['Resend API key', /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Cloudflare API token', /\bCLOUDFLARE_API_TOKEN\s*[=:]\s*['"]?[A-Za-z0-9_-]{30,}/],
  ['private key', /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/],
  ['Sentry DSN with key', /https:\/\/[a-f0-9]{32}@o\d+\.ingest\.[a-z.]*sentry\.io\/\d+/],
  ['database URL with a password', /\bpostgres(?:ql)?:\/\/[^:\s/'"]+:([^@\s'"]{6,})@(?!localhost|127\.0\.0\.1|postgres[:/]|db[:/]|mailpit)[a-z0-9.-]+\.[a-z]{2,}/i],
  ['secret in an env file', /^\s*(?:export\s+)?[A-Z0-9_]*(?:SECRET|PASSWORD|PASSPHRASE|TOKEN|API_KEY)\s*=\s*['"]?[A-Za-z0-9+/=_-]{16,}/m],
];
// (values that are only ever test or example settings, never real)
const ALLOWED = [/test-secret-test-secret/, /ci-only-password/, /devpass/, /correct horse battery/, /example\.com/, /kr:kr@/, /\$\{\{\s*secrets\./];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(f => f && !/^(node_modules|assets|incoming|reports)\/|\.(glb|png|jpg|pmtiles|gz|bin|wasm|mp3|ogg|wav)$/i.test(f));
const finds = [];
const check = (text, where) => {
  for (const line of text.split('\n')) {
    if (line.length > 4000 || ALLOWED.some(a => a.test(line))) continue;
    for (const [name, re] of RULES) {
      const m = line.match(re);
      if (m) finds.push({ name, where, sample: m[0].slice(0, 6) + '…' + '*'.repeat(6) });
    }
  }
};
for (const f of files) {
  let text; try { text = execFileSync('git', ['show', `:${f}`], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { continue; }
  if (text.includes('\0')) continue;
  check(text, f);
}
if (process.argv.includes('--history')) {
  // (streamed: the whole history is far bigger than memory wants at once)
  const git = spawn('git', ['log', '--all', '-p', '--no-color', '--format=@@commit %h', '--', '.', ':!assets', ':!incoming', ':!reports', ':!*.glb', ':!*.png', ':!*.pmtiles', ':!package-lock.json']);
  let commit = '';
  for await (const line of readline.createInterface({ input: git.stdout, crlfDelay: Infinity })) {
    if (line.startsWith('@@commit ')) { commit = line.slice(9); continue; }
    if (line.startsWith('+') && !line.startsWith('+++')) check(line.slice(1), `commit ${commit}`);
  }
}
const unique = [...new Map(finds.map(f => [`${f.name}|${f.where}`, f])).values()];
if (unique.length) {
  console.error(`${unique.length} possible secret${unique.length > 1 ? 's' : ''} found: rotate each real one (docs/SECURITY.md), then remove it`);
  for (const f of unique) console.error(`  ${f.name}: ${f.where} (${f.sample})`);
  process.exit(1);
}
console.log(`No secrets found in ${files.length} files${process.argv.includes('--history') ? ' or the history' : ''}.`);

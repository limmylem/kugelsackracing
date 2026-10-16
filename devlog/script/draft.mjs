// The devlog's script, drafted from git (DEVLOG.md) — version 2. Since the last devlog (the newest tag devlog-YYYY-MM-DD,
// or the last 7 days if there's none):
//   1. the highlights first: the lines added to devlog/highlights.md since then, as written (a person's — or the game's
//      Claude session's — own words for what players will notice; "HOOK: …" there sets the title)
//   2. then, to fill up to five captions, the commits that changed the game itself (a commit touching only tests, docs,
//      tools, workflows, deploys or this tool is left out, whatever it says), rewritten in a casual devlog voice and cut
//      at a natural break — never mid-phrase (a subject that can't be shortened cleanly is left out)
// No AI service: plain rules, so it's free and the same history always gives the same draft. It's a draft: edit it
// before rendering.
//
//   node script/draft.mjs [--out out/script.txt] [--since <tag or commit>] [--today YYYY-MM-DD]
//
// Writes the script (HOOK:, a caption a line, END:) with every commit listed underneath as notes, and prints it.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), DEVLOG = path.resolve(HERE, '..'), ROOT = path.resolve(DEVLOG, '..');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

// (the date where you are: TZ — the workflow sets Australia/Adelaide)
export const today = () => new Date().toLocaleDateString('en-CA');
export const tagFor = date => `devlog-${date}`;

// The last devlog: the newest devlog-YYYY-MM-DD tag before today's (a second run today drafts the same as the first)
export function lastDevlog(date = today()) {
  const tags = git('tag', '--list', 'devlog-*').split('\n').filter(t => /^devlog-\d{4}-\d{2}-\d{2}$/.test(t) && t < tagFor(date)).sort();
  return tags.at(-1) ?? null;
}

export function commitsSince(since) {
  const range = since ? [`${since}..HEAD`] : ['--since=7.days', 'HEAD'];
  const out = git('log', '--no-merges', '--name-only', '--format=%x01%h%x09%s', ...range);
  return out.split('\x01').filter(Boolean).map(block => {
    const [head, ...files] = block.split('\n');
    const [hash, ...s] = head.split('\t');
    return { hash, subject: s.join('\t'), files: files.map(f => f.trim()).filter(Boolean) };
  }).reverse();
}

// The highlights added since the last devlog (devlog/highlights.md): its new lines, in order — not comments, not blank
export const HIGHLIGHTS = 'devlog/highlights.md';
export function highlightsSince(since) {
  const lines = since
    ? git('diff', '--unified=0', `${since}..HEAD`, '--', HIGHLIGHTS).split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1))
    : (fs.existsSync(path.join(ROOT, HIGHLIGHTS)) ? fs.readFileSync(path.join(ROOT, HIGHLIGHTS), 'utf8').split('\n') : []);
  return lines.map(l => l.trim().replace(/^[-*•]\s*/, '')).filter(l => l && !l.startsWith('#') && !l.startsWith('<!--'));
}

// Does a commit change the game players get? Not if every file it touches is behind the scenes. (A commit with no
// file list — the tests' made-up ones — is judged by its words alone.)
const BACKSTAGE_PATHS = /^(devlog\/|docs\/|tests\/|tools\/|perf\/|\.github\/|deploy\/|docker|admin\/|editor\/|incoming\/|server\/(tools|test|scripts)\/|[^/]+\.(md|ya?ml|json|txt)$|\.[^/]+$|Dockerfile)/i;
// What this video is about, as typed (the admin page's Devlog tab, the workflow's "focus" box): lines split on | or
// line breaks, as highlights.md's lines are read (not comments, not blank)
export const focusLines = text => String(text ?? '').split(/\||\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
export const playerFacing =c => !c.files?.length || c.files.some(f => !BACKSTAGE_PATHS.test(f));

// ---------- from a commit subject to a caption ----------
// (behind-the-scenes work players never see: left out of the captions, still listed in the notes)
const BACKSTAGE = /\b(tests?|benchmarks?|bench|soak|garbage|shaders?|geometr(y|ies)|leaks?|perf|profil\w*|helper|renamed|editor's|editor|code|api|real-time server|process(es)?|cells?|pings?|hub|bots?|swarm|handoffs?|instances|budget|memory|determinism|schema|endpoint|protocol|cache|headers?|deploy\w*|workflow|ci\b|backup|restore|secret|token|migration|infra|csp|content security|cors|cloudflare|tunnel|vps|ssh|docker|lint|typecheck|typo|readme|docs?\b|changelog|notes for claude|live-look|load test|loadtest|crash test|browser test|drill|audit|refactor|bump|dependenc|admin page|setup script|server's setup|go-live record|known issues|header|stylesheet)\b/i;
const TOPICS = [
  { key: 'sound', re: /\b(sound|audio|engine note|music|exhaust|tyres? squeal|rev)/i, weight: 4, tag: '#sounddesign' },
  { key: 'online', re: /\b(multiplayer|online|friends?|lobby|lobbies|free roam|chat|race your|players?)\b/i, weight: 4, tag: '#multiplayer' },
  { key: 'cars', re: /\b(cars?|clutch|gearbox|engine|tyres?|tires?|suspension|drift|handling|physics|brakes?|turbo|parts?|garage|paint)\b/i, weight: 3, tag: '#cars' },
  { key: 'world', re: /\b(world|map|roads?|city|cities|terrain|weather|night|rain|buildings?|track|circuit)\b/i, weight: 3, tag: '#openworld' },
  { key: 'racing', re: /\b(race|races|racing|npc|rival|lap|quests?|events?|replay|crash|damage)\b/i, weight: 3, tag: '#simracing' },
];
const FIXISH = /^(fix(ed|es)?\b|no longer\b|doesn't\b|isn't\b|now works\b|works\b)|\bworks? (after|again|online|properly)\b|\b(no longer|doesn't|don't|isn't|works again|fixed)\b/i;

// a commit subject, cleaned: no "Phase 7 Step 5 (in progress):" labels, no [skip ci], no asides in brackets, the first
// part of a long one
const DANGLING = /\s+(and|or|but|the|a|an|of|to|in|on|at|for|with|from|by|as|its|their|your|is|are|was|be|not|so|that|which|than|then|when|while|into|onto)$/i;
export const MAX_WORDS = 11;
export function clean(subject) {
  let s = String(subject)
    .replace(/\[(skip ci|ci skip|no ci)\]/gi, '')
    .replace(/^\s*phase\s+\d+(\s+step\s+\d+)?\s*(\([^)]*\))?\s*:\s*/i, '')
    .replace(/^\s*(feat|fix|chore|docs|refactor|perf|style|test|build|ci)(\([^)]*\))?!?\s*:\s*/i, m => (/^\s*fix/i.test(m) ? 'fixed ' : ''))
    .replace(/\s*\([^)]*\)/g, '')
    .trim();
  // "Regions: back to …": a short label kept in front; "done — the go-live record": the part after a one-word label
  let label = '';
  const lab = s.match(/^([A-Z][\w' ]{1,20}):\s+(.*)$/);
  if (lab && lab[1].split(/\s+/).length <= 2) { label = lab[1]; s = lab[2]; }
  const parts = s.split(/\s+[—–]\s+|\s+-\s+|;\s+|:\s+/).map(p => p.trim()).filter(Boolean);
  s = parts.length > 1 && parts[0].split(/\s+/).length < 3 ? parts[1] : parts[0] ?? '';
  // at a natural break: the first clause, when it says something on its own (3+ words) — "Adelaide, a whole city…"
  // keeps both
  const clauses = s.split(/,\s+/);
  if (clauses.length > 1 && clauses[0].split(/\s+/).length >= 3) s = clauses[0];
  else if (clauses.length > 2) s = clauses.slice(0, 2).join(', ');
  s = s.replace(/[.,;:]+$/, '').trim();
  // never cut mid-phrase: too long, it's left out (the caller drops an empty line)
  if (s.split(/\s+/).filter(Boolean).length > MAX_WORDS) return '';
  while (DANGLING.test(s)) s = s.replace(DANGLING, '');
  if (label && !new RegExp(`\\b${label}\\b`, 'i').test(s)) s = `${label}: ${s}`;
  return s.trim();
}

export function score(subject, commit = null) {
  if (commit && !playerFacing(commit)) return -10;
  if (!clean(subject)) return -10;
  // (judged on all it says, not its asides in brackets or the "Phase 8 Step 1:" label)
  const s = String(subject).replace(/\s*\([^)]*\)/g, '').replace(/^\s*phase\s+\d+(\s+step\s+\d+)?\s*:\s*/i, '');
  if (BACKSTAGE.test(s)) return -10;
  let n = 0;
  // (a big change — a whole city, a new system — touches many of the game's files: up to 3 points)
  const gameFiles = (commit?.files ?? []).filter(f => !BACKSTAGE_PATHS.test(f)).length;
  if (gameFiles) n += Math.min(3, Math.log10(gameFiles + 1) * 1.5);
  for (const t of TOPICS) if (t.re.test(s)) n += t.weight;
  if (/\b(new|added?|adds|first|now)\b/i.test(s)) n += 1;
  if (/\bdone\b/i.test(s)) n += 2;
  if (/\((work )?in progress\)/i.test(subject)) n -= 1;
  if (FIXISH.test(clean(s))) n += 0.5;
  return n;
}
export const topicsOf = s => TOPICS.filter(t => t.re.test(s)).map(t => t.key);

// a steady choice from a list (the same commit always reads the same way)
const pick = (list, seed) => { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return list[h % list.length]; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function casual(subject) {
  const raw = String(subject), c = clean(raw);
  if (!c) return '';
  if (/^[\w' ]+: /.test(c)) return c;              // ("Regions: back to …" — its label says what it's about)
  if (/\bdone\b/i.test(raw)) return pick([`Finished: ${c}`, `${cap(c)}: done!`], c);
  if (FIXISH.test(c)) return pick([`Fixed: ${c}`, `Bug squashed: ${c}`], c);
  return pick([`New: ${c}`, `${cap(c)}`, `${cap(c)}!`], c);
}

const HOOKS = {
  sound: ['My racing game finally has SOUND', 'Listen to this engine (I built the sound myself)', 'I gave my racing game a voice'],
  online: ['You can race your friends online now', 'My browser racing game went multiplayer', 'Racing strangers on real roads'],
  cars: ['I made the cars feel better this week', 'Tuning cars in my own racing game', 'This week: the cars got better'],
  world: ['I drive real roads in my own game', 'This week the world got bigger', 'Racing real roads in a browser'],
  racing: ['Racing got way better this week', 'Can you beat my AI racers?', 'This week in my racing game'],
  none: ['This week in my real-roads racing game', 'Devlog: what I built this week', 'Building a racing game in the browser'],
};

// the draft: { hook, captions, end, commits, since, topics, highlights }
export function draft({ commits, since = null, date = today(), most = 5, highlights = [] }) {
  // 1. the highlights, as written ("HOOK: …" among them sets the title)
  let hook = null;
  const lines = [];
  for (const h of highlights) {
    const m = h.match(/^hook\s*:\s*(.+)$/i);
    if (m) hook = m[1].trim(); else if (lines.length < most) lines.push(cap(h));
  }
  // 2. the game's own commits, to fill up (the newer the better: up to 2 points for the latest)
  const ranked = commits.map((c, i) => ({ ...c, i, score: score(c.subject, c) })).filter(c => c.score > 0).map(c => ({ ...c, score: c.score + 2 * (c.i + 1) / commits.length }));
  // (two about the same thing — "the sound system", "vehicle and world sound" — make one caption; and none repeats a
  // highlight)
  const words = s => new Set(clean(s).toLowerCase().match(/[a-z']{4,}/g)?.map(w => w.replace(/'s$|s$/, '')).filter(w => !['game', 'with', 'from', 'that', 'this', 'into', 'their', 'when', 'what', 'work', 'again', 'fixed'].includes(w)) ?? []);
  const same = (a, b) => { const A = words(a), B = words(b), n = [...A].filter(w => B.has(w)).length; return n > 0 && n / Math.min(A.size, B.size) >= 0.34; };
  const chosen = [];
  for (const c of [...ranked].sort((a, b) => b.score - a.score || b.i - a.i)) {
    if (lines.length + chosen.length >= most) break;
    const line = casual(c.subject);
    if (!line || chosen.some(o => same(o.subject, c.subject)) || lines.some(h => same(h, c.subject))) continue;
    chosen.push({ ...c, line });
  }
  chosen.sort((a, b) => a.i - b.i);
  const count = new Map();
  for (const t of [...chosen.map(c => c.subject), ...lines].flatMap(topicsOf)) count.set(t, (count.get(t) ?? 0) + TOPICS.find(x => x.key === t).weight);
  const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';
  const captions = [...lines, ...chosen.map(c => c.line)];
  if (!captions.length) captions.push('Lots of work under the hood this week', 'Smoother, faster, fewer bugs');
  return { hook: hook ?? pick(HOOKS[top], date), captions, end: 'Race real roads in your browser', commits, since, topics: [...count.keys()], highlights };
}

export function scriptText(d, date = today()) {
  return [
    `# Devlog script for ${date} — edit me, then render (DEVLOG.md).`,
    '# HOOK: the big title in the first 2 seconds (under ~8 words works best).',
    '# Then one caption per line, shown in order over the gameplay (under ~12 words each; 4–6 captions makes 20–45 s).',
    '# END: the line under ognistrada.com on the end card. Lines starting with # are notes and are ignored.',
    '',
    `HOOK: ${d.hook}`,
    ...d.captions,
    `END: ${d.end}`,
    '',
    `# From ${HIGHLIGHTS}: ${d.highlights?.length ? `${d.highlights.length} new line${d.highlights.length === 1 ? '' : 's'}` : 'nothing new (add a line there for each thing players will notice: DEVLOG.md)'}.`,
    `# The commits ${d.since ? `since ${d.since}` : 'of the last 7 days'} (${d.commits.length}; * changed the game itself), for ideas:`,
    ...d.commits.map(c => `#   ${playerFacing(c) ? '*' : ' '} ${c.hash} ${c.subject.slice(0, 160)}`),
    '',
  ].join('\n');
}

const HASHTAGS = ['#gamedev', '#indiedev', '#devlog', '#racinggame', '#indiegame', '#webgame', '#threejs', '#buildinpublic'];
// the post's caption for TikTok / Instagram: the hook, the captions as a list, the address, hashtags
export function postCaption(script, topics = []) {
  const extra = TOPICS.filter(t => topics.includes(t.key) || t.re.test(script.captions.join(' '))).map(t => t.tag);
  return [
    `${script.hook} 🏎️`,
    '',
    ...(script.captions.length ? ['This week:', ...script.captions.slice(0, 5).map(c => `• ${c}`), ''] : []),
    'Race real roads, free in your browser 👉 ognistrada.com',
    '',
    [...new Set([...HASHTAGS, ...extra])].join(' '),
    '',
  ].join('\n');
}

// ---------- the command ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const date = opt('--today', today());
  const since = opt('--since', null) ?? lastDevlog(date);
  // (--focus "line | line | HOOK: …": what this video is about, written on the admin page's Devlog tab or in the
  // workflow's box — used in place of devlog/highlights.md's new lines)
  const focus = opt('--focus', null), highlights = focus != null ? focusLines(focus) : highlightsSince(since);
  const d = draft({ commits: commitsSince(since), since, date, highlights });
  const out = path.resolve(opt('--out', path.join(DEVLOG, 'out/script.txt')));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, scriptText(d, date));
  console.log(scriptText(d, date).split('\n').filter(l => !l.startsWith('#  ')).join('\n'));
  console.log(`(written to ${path.relative(process.cwd(), out)}; ${d.commits.length} commits ${since ? `since ${since}` : 'in the last 7 days'})`);
}

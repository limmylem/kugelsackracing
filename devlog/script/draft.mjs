// The devlog's script, drafted from git (DEVLOG.md): the commit subjects since the last devlog — the newest tag
// devlog-YYYY-MM-DD, or the last 7 days if there's none — the player-facing ones picked out and rewritten in a casual
// devlog voice. No AI service: plain rules, so it's free and the same commits always give the same draft. It's a
// draft: edit it before rendering.
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
  const out = git('log', '--no-merges', '--format=%h%x09%s', ...range);
  return out ? out.split('\n').map(l => { const [hash, ...s] = l.split('\t'); return { hash, subject: s.join('\t') }; }).reverse() : [];
}

// ---------- from a commit subject to a caption ----------
// (behind-the-scenes work players never see: left out of the captions, still listed in the notes)
const BACKSTAGE = /\b(editor's|editor|code|api|real-time server|process(es)?|cells?|pings?|hub|bots?|swarm|handoffs?|instances|budget|memory|determinism|schema|endpoint|protocol|cache|headers?|deploy\w*|workflow|ci\b|backup|restore|secret|token|migration|infra|csp|content security|cors|cloudflare|tunnel|vps|ssh|docker|lint|typecheck|typo|readme|docs?\b|changelog|notes for claude|live-look|load test|loadtest|crash test|browser test|drill|audit|refactor|bump|dependenc|admin page|setup script|server's setup|go-live record|known issues|header|stylesheet)\b/i;
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
export function clean(subject) {
  let s = String(subject)
    .replace(/\[(skip ci|ci skip|no ci)\]/gi, '')
    .replace(/^\s*phase\s+\d+(\s+step\s+\d+)?\s*(\([^)]*\))?\s*:\s*/i, '')
    .replace(/^\s*(feat|fix|chore|docs|refactor|perf|style|test|build|ci)(\([^)]*\))?!?\s*:\s*/i, m => (/^\s*fix/i.test(m) ? 'fixed ' : ''))
    .replace(/\s*\([^)]*\)/g, '')
    .trim();
  const parts = s.split(/\s+[—–-]\s+|;\s+|:\s+/).map(p => p.trim()).filter(Boolean);
  // ("done — the go-live record": the part after a one-word label)
  s = parts.length > 1 && parts[0].split(/\s+/).length < 3 ? parts[1] : parts[0] ?? '';
  s = s.split(/,\s+(and|but|so|which|then)\s+/i)[0];
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 11) s = words.slice(0, 11).join(' ').replace(/[,.;:]$/, '');
  return s.replace(/[.,;:]+$/, '').trim();
}

export function score(subject) {
  // (judged on what it says, not its asides in brackets or the "Phase 8 Step 1:" label)
  const s = String(subject).replace(/\s*\([^)]*\)/g, '').replace(/^\s*phase\s+\d+(\s+step\s+\d+)?\s*:\s*/i, '');
  if (BACKSTAGE.test(clean(subject))) return -10;
  let n = 0;
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
  if (/\bdone\b/i.test(raw)) return pick([`Finished: ${c}`, `${cap(c)}: done!`, `Ticked off: ${c}`], c);
  if (FIXISH.test(c)) return pick([`Fixed: ${c}`, `Bug squashed: ${c}`, `${cap(c)} (finally)`], c);
  return pick([`New: ${c}`, `Added ${c}`, `${cap(c)}!`, `This week: ${c}`], c);
}

const HOOKS = {
  sound: ['My racing game finally has SOUND', 'Listen to this engine (I built the sound myself)', 'I gave my racing game a voice'],
  online: ['You can race your friends online now', 'My browser racing game went multiplayer', 'Racing strangers on real roads'],
  cars: ['I made the cars feel better this week', 'Tuning cars in my own racing game', 'This week: the cars got better'],
  world: ['I drive real roads in my own game', 'This week the world got bigger', 'Racing real roads in a browser'],
  racing: ['Racing got way better this week', 'Can you beat my AI racers?', 'This week in my racing game'],
  none: ['This week in my real-roads racing game', 'Devlog: what I built this week', 'Building a racing game in the browser'],
};

// the draft: { hook, captions, end, commits, since, topics }
export function draft({ commits, since = null, date = today(), most = 5 }) {
  // (the newer the better: up to 2 points for the latest)
  const ranked = commits.map((c, i) => ({ ...c, i, score: score(c.subject) })).filter(c => c.score > 0).map(c => ({ ...c, score: c.score + 2 * (c.i + 1) / commits.length }));
  // (two commits about the same thing — "the sound system", "vehicle and world sound" — make one caption)
  const words = s => new Set(clean(s).toLowerCase().match(/[a-z']{4,}/g)?.map(w => w.replace(/'s$|s$/, '')).filter(w => !['game', 'with', 'from', 'that', 'this', 'into', 'their', 'when', 'what'].includes(w)) ?? []);
  const same = (a, b) => { const A = words(a), B = words(b), n = [...A].filter(w => B.has(w)).length; return n > 0 && n / Math.min(A.size, B.size) >= 0.34; };
  const chosen = [];
  for (const c of [...ranked].sort((a, b) => b.score - a.score || b.i - a.i)) {
    const line = casual(c.subject);
    if (!line || chosen.some(o => same(o.subject, c.subject))) continue;
    chosen.push({ ...c, line });
    if (chosen.length >= most) break;
  }
  chosen.sort((a, b) => a.i - b.i);
  const count = new Map();
  for (const c of chosen) for (const t of topicsOf(c.subject)) count.set(t, (count.get(t) ?? 0) + (TOPICS.find(x => x.key === t).weight));
  const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';
  const captions = chosen.map(c => c.line);
  if (!captions.length) captions.push('Lots of work under the hood this week', 'Smoother, faster, fewer bugs');
  return { hook: pick(HOOKS[top], date), captions, end: 'Race real roads in your browser', commits, since, topics: [...count.keys()] };
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
    `# The commits ${d.since ? `since ${d.since}` : 'of the last 7 days'} (${d.commits.length}), for ideas:`,
    ...d.commits.map(c => `#   ${c.hash} ${c.subject}`),
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
  const d = draft({ commits: commitsSince(since), since, date });
  const out = path.resolve(opt('--out', path.join(DEVLOG, 'out/script.txt')));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, scriptText(d, date));
  console.log(scriptText(d, date).split('\n').filter(l => !l.startsWith('#   ')).join('\n'));
  console.log(`(written to ${path.relative(process.cwd(), out)}; ${d.commits.length} commits ${since ? `since ${since}` : 'in the last 7 days'})`);
}

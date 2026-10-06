// Brings world content made in the browser's editor (Phase 4: kept in that browser) into the server: the
// editor's export files (Editor → Export, "world-content" JSON) checked item by item with the same rules as
// every write (the schema, the plain-word checks for anything published, older versions migrated), bad items
// skipped with the reason, and a report written to reports/.
//
//   DATABASE_URL=… node server/tools/import-content.ts <export.json> [more.json…] --as <editor's email> [--replace] [--dry-run]
//   (npm run content:import --workspace @kr/server -- …)
//
//   --as        the editor the items are recorded against (an editor or admin account on that server)
//   --replace   items already on the server are replaced (otherwise they're kept as they are, and reported)
//   --dry-run   everything checked and reported; nothing written
//
// The same import is in the API for editors (POST /api/v1/content/import); this is for files too big to
// upload, or a server with no editor signed in yet.

import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { openDb } from '../src/db/index.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { loadRules } from '../src/content/rules.ts';
import { createContentService } from '../src/content/service.ts';
import { REPO_DIR } from '../src/config.ts';

const args = process.argv.slice(2);
const flag = (f: string) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (f: string) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v ?? null; };
const replace = flag('--replace'), dryRun = flag('--dry-run'), as = opt('--as'), files = args;
const fail = (m: string) => { console.error(m); process.exit(1); };
if (!files.length || !as) fail('Usage: node server/tools/import-content.ts <export.json> [more.json…] --as <editor\'s email> [--replace] [--dry-run]');
const url = process.env.DATABASE_URL;
if (!url) fail('DATABASE_URL isn\'t set: the server\'s database (docs/SERVER.md).');

await migrateDb(url!);
const { db, pool } = openDb(url!, { max: 2 });
try {
  const u = (await db.execute(sql`select id, name, role, is_anonymous from users where lower(email) = lower(${as})`)).rows[0] as any;
  if (!u) fail(`There's no account with the email ${as} on that server.`);
  if (u.is_anonymous || !['editor', 'admin'].includes(u.role)) fail(`${as} isn't an editor (their role is ${u.role}): an admin can make them one on the admin page.`);
  const svc = createContentService({ db, rules: loadRules() });
  const all: any[] = [];
  for (const f of files) {
    let doc: any;
    try { doc = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e: any) { fail(`${f}: can't read it as JSON (${e.message}).`); }
    const r = await svc.importContent(doc, { onConflict: replace ? 'replace' : 'skip', dryRun }, { id: u.id, name: u.name }).catch((e: any) => ({ error: e.message }));
    all.push({ file: path.resolve(f), ...r });
    if ('error' in r) { console.log(`✖ ${f}: ${r.error}`); continue; }
    console.log(`${dryRun ? '(dry run) ' : ''}${f}: ${r.imported} ${dryRun ? 'would be imported' : 'imported'}${r.migrated ? ` (${r.migrated} from older versions)` : ''}, ${r.skipped.length} skipped, in ${(r.ms / 1000).toFixed(1)} s`);
    console.log(`   by kind: ${Object.entries(r.byKind).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`);
    const why = new Map<string, string[]>();
    for (const s of r.skipped) (why.get(s.why) ?? why.set(s.why, []).get(s.why)!).push(s.id);
    for (const [w, ids] of why) console.log(`   skipped ${ids.length}: ${w} — ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ` and ${ids.length - 5} more` : ''}`);
  }
  const dir = path.join(REPO_DIR, 'reports'), at = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `content-import-${at}.json`);
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), as, replace, dryRun, files: all }, null, 2));
  console.log(`Report: ${path.relative(process.cwd(), out)}`);
  process.exitCode = all.some(r => 'error' in r) ? 1 : 0;
} finally { await pool.end(); }

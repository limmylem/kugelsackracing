// The ROADBOOK's settings on the server (docs/ROADBOOK.md): the seasons, chapters, challenges, Expeditions, shop and
// places (roadbook/data.js's bundle) kept as versions in roadbook_config, one active — as the economy's settings are
// (economy/config.ts). The admin page's ROADBOOK tab changes them: each change a new version, checked first
// (roadbook/engine.js bundleProblems), with who and why; a rollback is a new version with an older one's values; live at
// once, no deploy. The first version is the repository's files; a later deploy's new files (a new season, a new place)
// come in as a new version with only what was missing added.

import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { REPO_DIR } from '../config.ts';
import { AppError } from '../errors.ts';
import { addMissing } from '../economy/config.ts';
import { loadRoadbook } from '../../../roadbook/data.js';
import { bundleProblems } from '../../../roadbook/engine.js';

const readJson = async (p: string) => JSON.parse(fs.readFileSync(path.join(REPO_DIR, p), 'utf8'));
export const roadbookFiles = () => loadRoadbook(readJson);

export function createRoadbookConfig(db: Db) {
  let current: { version: number; data: any; checkedAt: number } | null = null, filled = false;
  const rowOut = (r: any) => ({ version: r.version, data: r.data, reason: r.reason, actorId: r.actor_id, basedOn: r.based_on, createdAt: new Date(r.created_at).toISOString(), active: r.active });
  async function ensure() {
    const has = (await db.execute(sql`select 1 from roadbook_config limit 1`)).rows.length, files = await roadbookFiles();
    if (!has) {
      await db.execute(sql`insert into roadbook_config (version, data, reason, active) values (1, ${JSON.stringify(files)}::jsonb, 'The game''s own files (data/seasons, data/places.json)', true) on conflict do nothing`);
      filled = true;
      return;
    }
    if (filled) return;
    filled = true;
    const r = (await db.execute(sql`select version, data from roadbook_config where active`)).rows[0] as any;
    if (!r) return;
    const added: string[] = [], data = addMissing(r.data, files, 'roadbook', added);
    // (places are a list: new ones by id)
    for (const p of files.places ?? []) if (!(data.places ?? []).some((x: any) => x.id === p.id)) { (data.places ??= []).push(p); added.push(`places.${p.id}`); }
    if (!added.length) return;
    await activate(data, { actorId: null, reason: `New settings from the game's files, nothing else changed: ${added.slice(0, 12).join(', ')}${added.length > 12 ? ` and ${added.length - 12} more` : ''}`, basedOn: r.version }, { skipCheck: true });
  }
  async function active() {
    if (current && Date.now() - current.checkedAt < 5000) return current;
    await ensure();
    const v = Number(((await db.execute(sql`select version from roadbook_config where active`)).rows[0] as any)?.version);
    if (!current || current.version !== v) {
      const r = (await db.execute(sql`select version, data from roadbook_config where version = ${v}`)).rows[0] as any;
      current = { version: r.version, data: r.data, checkedAt: Date.now() };
    } else current.checkedAt = Date.now();
    return current;
  }
  function check(data: any) {
    const problems = bundleProblems(data);
    if (problems.length) throw new AppError(400, 'VALIDATION', `The ROADBOOK settings aren't right: ${problems[0]}`, problems.slice(0, 30).map(m => ({ path: '', message: m })));
  }
  async function activate(data: any, { actorId, reason, basedOn }: { actorId: string | null; reason: string; basedOn: number | null }, { skipCheck = false } = {}) {
    if (!skipCheck) check(data);
    return db.transaction(async tx => {
      await tx.execute(sql`lock table roadbook_config in exclusive mode`);
      const next = Number(((await tx.execute(sql`select coalesce(max(version), 0) + 1 as v from roadbook_config`)).rows[0] as any).v);
      await tx.execute(sql`update roadbook_config set active = false where active`);
      await tx.execute(sql`insert into roadbook_config (version, data, based_on, actor_id, reason, active) values (${next}, ${JSON.stringify(data)}::jsonb, ${basedOn}, ${actorId}, ${reason}, true)`);
      current = null;
      return next;
    });
  }
  return {
    ensure, active, check,
    async data() { return (await active()).data; },
    async history(limit = 50) { return (await db.execute(sql`select * from roadbook_config order by version desc limit ${limit}`)).rows.map(rowOut); },
    async get(version: number) { const r = (await db.execute(sql`select * from roadbook_config where version = ${version}`)).rows[0]; if (!r) throw new AppError(404, 'NOT_FOUND', 'There\'s no such version.'); return rowOut(r); },
    change: (data: any, by: { actorId: string; reason: string; basedOn: number | null }) => activate(data, by),
    async rollback(version: number, { actorId, reason }: { actorId: string; reason: string }) {
      const old = await this.get(version);
      return activate(old.data, { actorId, reason: `Back to version ${version}: ${reason}`, basedOn: version });
    },
  };
}
export type RoadbookConfig = ReturnType<typeof createRoadbookConfig>;

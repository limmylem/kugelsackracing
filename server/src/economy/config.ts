// The economy's settings on the server (Phase 6 Step 2): prices, repairs, rewards, fees, anti-farming — the
// game's data/economy.json and data/quests.json, kept in the database as versions, one of them active. The
// server prices everything from the active version; the game downloads a read-only copy to show prices.
// Admins change values on the admin page: each change a new version, with who and why; a rollback is a
// new version with an older one's values. The first version is the repository's files as they are.

import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { REPO_DIR } from '../config.ts';
import { AppError } from '../errors.ts';
import { loadGarageData } from '../../../garage/data.js';

export type EconomyData = { economy: any; quests: any };
export type ConfigVersion = { version: number; data: EconomyData; reason: string; actorId: string | null; basedOn: number | null; createdAt: string; active: boolean };
const readJson = async (p: string) => JSON.parse(fs.readFileSync(path.join(REPO_DIR, p), 'utf8'));

// the game's data, once: cars, parts, damage and session rules (what never changes while it runs) and the
// validator for the economy file
let baseData: Promise<{ db: any; validator: any }> | null = null;
export const gameData = () => baseData ??= loadGarageData(readJson).then(({ db, problems, validator }) => {
  if (problems.length) console.warn(`The car and part data has ${problems.length} problem(s): ${problems.slice(0, 3).map((p: any) => `${p.file} ${p.path}: ${p.message}`).join('; ')}`);
  return { db, validator };
});

export function createEconomyConfig(db: Db) {
  let current: { version: number; data: EconomyData; checkedAt: number } | null = null;
  const rowOut = (r: any): ConfigVersion => ({ version: r.version, data: r.data, reason: r.reason, actorId: r.actor_id, basedOn: r.based_on, createdAt: new Date(r.created_at).toISOString(), active: r.active });

  // (the first version: the repository's files)
  async function ensure() {
    const has = (await db.execute(sql`select 1 from economy_config limit 1`)).rows.length;
    if (has) return;
    const data = { economy: await readJson('data/economy.json'), quests: await readJson('data/quests.json') };
    await db.execute(sql`insert into economy_config (version, data, reason, active) values (1, ${JSON.stringify(data)}::jsonb, 'The game''s own settings (data/economy.json, data/quests.json)', true) on conflict do nothing`);
  }
  // the active version (asked again every few seconds: another server may have changed it)
  async function active() {
    if (current && Date.now() - current.checkedAt < 5000) return current;
    await ensure();
    const v = Number(((await db.execute(sql`select version from economy_config where active`)).rows[0] as any)?.version);
    if (!current || current.version !== v) {
      const r = (await db.execute(sql`select version, data from economy_config where version = ${v}`)).rows[0] as any;
      current = { version: r.version, data: r.data, checkedAt: Date.now() };
    } else current.checkedAt = Date.now();
    return current;
  }
  // a new version's values checked: the economy file against its schema, the quests file's shape
  async function check(data: any) {
    if (!data || typeof data !== 'object' || !data.economy || !data.quests) throw new AppError(400, 'BAD_REQUEST', 'The settings need both parts: economy and quests.');
    const { validator, db: game } = await gameData();
    const problems = validator.validate('economy.schema.json', data.economy);
    if (problems.length) throw new AppError(400, 'VALIDATION', `The economy settings aren't right: ${problems[0].path}: ${problems[0].message}`, problems.slice(0, 20));
    if (!game.cars[data.economy.startingCar]) throw new AppError(400, 'VALIDATION', `There's no car "${data.economy.startingCar}" to start with.`);
    if (typeof data.quests !== 'object' || !data.quests.rewards || !data.quests.validation) throw new AppError(400, 'VALIDATION', 'The quest settings need their rewards and validation.');
  }
  async function activate(data: EconomyData, { actorId, reason, basedOn }: { actorId: string; reason: string; basedOn: number | null }) {
    await check(data);
    return db.transaction(async tx => {
      await tx.execute(sql`lock table economy_config in exclusive mode`);
      const next = Number(((await tx.execute(sql`select coalesce(max(version), 0) + 1 as v from economy_config`)).rows[0] as any).v);
      await tx.execute(sql`update economy_config set active = false where active`);
      await tx.execute(sql`insert into economy_config (version, data, based_on, actor_id, reason, active) values (${next}, ${JSON.stringify(data)}::jsonb, ${basedOn}, ${actorId}, ${reason}, true)`);
      current = null;
      return next;
    });
  }
  return {
    ensure, active, check,
    // the game's own data with this version's economy (what the player service prices from)
    async gameDb() { const [{ db: game }, a] = await Promise.all([gameData(), active()]); return { version: a.version, db: { ...game, economy: a.data.economy }, quests: a.data.quests }; },
    async history(limit = 50) { return (await db.execute(sql`select * from economy_config order by version desc limit ${limit}`)).rows.map(rowOut); },
    async get(version: number) { const r = (await db.execute(sql`select * from economy_config where version = ${version}`)).rows[0]; if (!r) throw new AppError(404, 'NOT_FOUND', 'There\'s no such version.'); return rowOut(r); },
    change: (data: EconomyData, by: { actorId: string; reason: string; basedOn: number | null }) => activate(data, by),
    async rollback(version: number, { actorId, reason }: { actorId: string; reason: string }) {
      const old = await this.get(version);
      return activate(old.data, { actorId, reason: `Back to version ${version}: ${reason}`, basedOn: version });
    },
  };
}
export type EconomyConfig = ReturnType<typeof createEconomyConfig>;

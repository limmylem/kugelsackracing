// Switches the admins flip without a deploy (Phase 6 Step 5; docs/OPERATIONS.md), kept in site_settings:
//   features      each feature on or off — a broken one switched off at once (its endpoints answer 503 FEATURE_OFF
//                 with the message; the rest of the game carries on) — or on for only some players (percent: a gradual
//                 rollout; each account always lands on the same side, by a hash of its id)
//   maintenance   the whole API down for everyone but editors and admins, with a message for players (503 MAINTENANCE)
//   closedBeta    signing up needs an invite code
//   client        the oldest game the server works with: older ones are told to refresh (426 CLIENT_TOO_OLD)
// Read through a few seconds' cache (every request asks); a change applies on every server within that.

import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { CLIENT_PROTOCOL } from '@kr/shared';
import type { Db } from '../db/index.ts';

export const FEATURES = {
  signUp: 'Signing up', guests: 'Playing as a guest', shop: 'The shop and dealership', quests: 'Quests', tracks: 'Handing in track results',
  replays: 'Saving race replays', editor: 'World editing', reports: 'Reporting players', support: 'Contact support and feedback',
} as const;
export type Feature = keyof typeof FEATURES;

export type SiteSettings = {
  features: Record<Feature, { on: boolean; message: string; percent: number }>;
  maintenance: { on: boolean; message: string; until: string | null };
  closedBeta: { on: boolean };
  client: { minProtocol: number };
};
export const defaults = (closedBeta = false): SiteSettings => ({
  features: Object.fromEntries(Object.keys(FEATURES).map(k => [k, { on: true, message: '', percent: 100 }])) as SiteSettings['features'],
  maintenance: { on: false, message: '', until: null },
  closedBeta: { on: closedBeta },
  client: { minProtocol: CLIENT_PROTOCOL },
});

export function createSiteSettings(db: Db, { closedBeta = false, cacheMs = 3000 } = {}) {
  let cached: { at: number; value: SiteSettings } | null = null;
  async function get(): Promise<SiteSettings> {
    if (cached && Date.now() - cached.at < cacheMs) return cached.value;
    const rows = (await db.execute(sql`select key, value from site_settings`)).rows as { key: string; value: any }[];
    const v = defaults(closedBeta), saved = Object.fromEntries(rows.map(r => [r.key, r.value]));
    if (saved.features) for (const k of Object.keys(FEATURES) as Feature[]) if (saved.features[k]) v.features[k] = { on: saved.features[k].on !== false, message: String(saved.features[k].message ?? ''), percent: Math.max(0, Math.min(100, Number(saved.features[k].percent ?? 100))) };
    if (saved.maintenance) v.maintenance = { on: !!saved.maintenance.on, message: String(saved.maintenance.message ?? ''), until: saved.maintenance.until ?? null };
    if (saved.closedBeta) v.closedBeta = { on: !!saved.closedBeta.on };
    // (never below this build's own protocol: a setting left from an older version can't let older games in)
    if (saved.client) v.client = { minProtocol: Math.max(CLIENT_PROTOCOL, Number(saved.client.minProtocol) || 0) };
    cached = { at: Date.now(), value: v };
    return v;
  }
  async function set<K extends keyof SiteSettings>(key: K, value: SiteSettings[K], by: string | null) {
    await db.execute(sql`insert into site_settings (key, value, updated_by, updated_at) values (${key}, ${JSON.stringify(value)}::jsonb, ${by}, now())
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`);
    cached = null;
    return get();
  }
  return { get, set, forget() { cached = null; } };
}
export type SiteSettingsStore = ReturnType<typeof createSiteSettings>;

// which side of a gradual rollout an account is on: 0–99, the same every time for the same account and feature
export const bucketOf = (userId: string, feature: string) => crypto.createHash('sha256').update(`${feature}:${userId}`).digest().readUInt16BE(0) % 100;

// which feature an API request belongs to (null: none that can be switched off)
const SHOP_ACTIONS = /^(buyPart|sellPart|sellParts|refundPart|buyBundle|sellCar|buyUsedCar|buyGarageSlot|buyCar|buyAndInstall)$/;
const QUEST_ACTIONS = /^(startQuest|refundQuest|finishQuest|failQuest|awardCar|forfeitCar)$/;
export function featureOf(method: string, url: string): Feature | null {
  const p = url.split('?')[0].replace(/\/{2,}/g, '/');
  if (method === 'POST' && /^\/api\/auth\/sign-up\//.test(p)) return 'signUp';
  if (method === 'POST' && p === '/api/auth/sign-in/anonymous') return 'guests';
  const a = p.match(/^\/api\/v1\/player\/actions\/([A-Za-z]+)$/);
  if (a && SHOP_ACTIONS.test(a[1])) return 'shop';
  if (a && QUEST_ACTIONS.test(a[1])) return 'quests';
  if (p === '/api/v1/player/used-lot') return 'shop';
  if (method === 'POST' && p === '/api/v1/tracks/results') return 'tracks';
  if (method === 'POST' && p === '/api/v1/replays') return 'replays';
  if (method !== 'GET' && p.startsWith('/api/v1/content/')) return 'editor';
  if (method === 'POST' && p === '/api/v1/reports') return 'reports';
  if (method === 'POST' && (p === '/api/v1/support' || p === '/api/v1/feedback')) return 'support';
  return null;
}

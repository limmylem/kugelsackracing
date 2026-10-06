// The database (PostgreSQL with PostGIS), as Drizzle tables. Every change to it is a migration made from this
// file (npm run db:generate → server/drizzle/*.sql, reviewed and committed; applied by npm run db:migrate and
// on the server's start) — never an edit by hand on a database.
//
//   accounts (Better Auth's tables: users, sessions, accounts, verifications — their fields as the library
//   needs them, with the admin and anonymous plugins' and ours: the terms, the display name's last change)
//   audit_log: every admin action · idempotency_keys: writes applied once
//   content_items / content_history / content_meta: world content (docs/WORLD_CONTENT.md, design note)
//   track_results / track_records / replays: generated tracks' results, records, leaderboards, race replays

import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, timestamp, integer, real, bigserial, jsonb, index, uniqueIndex, primaryKey, customType, bigint } from 'drizzle-orm/pg-core';

// a point on the earth (PostGIS, WGS 84 longitude/latitude). Stored as geometry: its GiST indexes serve the
// tile and cell boxes and the box round a nearby query, whose distances are then on the sphere.
export const point = customType<{ data: { lon: number; lat: number }; driverData: string }>({
  dataType: () => 'geometry(point,4326)',
  toDriver: v => sql`ST_SetSRID(ST_MakePoint(${v.lon}, ${v.lat}), 4326)` as unknown as string,
});
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ---------- accounts (Better Auth) ----------
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),                          // the display name (unique, case-insensitively)
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: created(),
  updatedAt: updated(),
  isAnonymous: boolean('is_anonymous').default(false),   // a guest (Better Auth's anonymous plugin)
  role: text('role').notNull().default('player'),        // player | editor | admin (Better Auth's admin plugin)
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires', { withTimezone: true }),
  termsVersion: text('terms_version'),                   // the terms and privacy policy accepted (null: not yet)
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
  nameChangedAt: timestamp('name_changed_at', { withTimezone: true }),
}, t => [uniqueIndex('users_name_lower').on(sql`lower(${t.name})`)]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: created(),
  updatedAt: updated(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  impersonatedBy: text('impersonated_by'),
}, t => [index('sessions_user').on(t.userId)]);

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),                            // (Better Auth's hash: scrypt; never read by us)
  createdAt: created(),
  updatedAt: updated(),
}, t => [index('accounts_user').on(t.userId), uniqueIndex('accounts_provider').on(t.providerId, t.accountId)]);

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: created(),
  updatedAt: updated(),
}, t => [index('verifications_identifier').on(t.identifier)]);

// ---------- the admins' log: every admin action, who, to whom, why ----------
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetId: text('target_id'),
  reason: text('reason'),
  details: jsonb('details').notNull().default({}),
}, t => [index('audit_target').on(t.targetId, t.at), index('audit_at').on(t.at)]);

// ---------- writes applied once (an Idempotency-Key per account, or per address for a guest's first) ----------
export const idempotencyKeys = pgTable('idempotency_keys', {
  scope: text('scope').notNull(),                        // the account (or the address)
  key: text('key').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  requestHash: text('request_hash').notNull(),           // the same key with another request: refused
  state: text('state').notNull().default('pending'),     // pending | done
  status: integer('status'),
  response: jsonb('response'),
  createdAt: created(),
}, t => [primaryKey({ columns: [t.scope, t.key] }), index('idempotency_created').on(t.createdAt)]);

// ---------- world content (docs/WORLD_CONTENT.md: one row per item and view) ----------
export const contentItems = pgTable('content_items', {
  id: text('id').notNull(),
  view: text('view').notNull(),                          // draft | published | archived
  kind: text('kind').notNull(),                          // quest | poi | spawn | route | series | venue
  version: integer('version').notNull(),
  geom: point('geom').notNull(),
  heading: real('heading').notNull().default(0),
  cell: text('cell').notNull(),                          // geohash precision 5 (the client's cells)
  enabled: boolean('enabled').notNull().default(true),   // quests: offered once published
  data: jsonb('data').notNull(),                         // the whole item, as the content schema says
  marker: jsonb('marker').notNull(),                     // what a map marker needs: light, for the game's nearby queries
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: created(),
  updatedAt: updated(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, t => [
  primaryKey({ columns: [t.id, t.view] }),
  index('content_geom').using('gist', t.geom),
  index('content_geom_published').using('gist', t.geom).where(sql`view = 'published'`),   // (what the game reads: only published rows)
  index('content_view_cell').on(t.view, t.cell),
  index('content_view_kind').on(t.view, t.kind),
]);

export const contentHistory = pgTable('content_history', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  id: text('id').notNull(),
  action: text('action').notNull(),                      // create | update | publish | unpublish | archive | restore | delete | state | import
  before: jsonb('before'),
  after: jsonb('after'),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('content_history_id').on(t.id, t.seq)]);

// (what players see changes: its counter goes up — the published responses' ETag and cache key)
export const contentMeta = pgTable('content_meta', {
  key: text('key').primaryKey(),
  value: bigint('value', { mode: 'number' }).notNull().default(0),
});

// ---------- generated tracks: results, records, leaderboards, replays ----------
export const trackResults = pgTable('track_results', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventId: text('event_id').notNull(),
  kind: text('kind').notNull(),
  code: text('code').notNull(),
  version: integer('version').notNull(),
  carClass: text('car_class').notNull(),
  type: text('type').notNull(),
  time: real('time').notNull(),
  bestLap: real('best_lap'),
  laps: jsonb('laps').notNull().default([]),
  accepted: boolean('accepted').notNull(),
  problems: jsonb('problems').notNull().default([]),
  recording: bytea('recording'),                         // the run's recording (gzip): the result's evidence
  replayId: text('replay_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('results_board').on(t.eventId, t.accepted, t.time), index('results_user').on(t.userId, t.at)]);

export const trackRecords = pgTable('track_records', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  version: integer('version').notNull(),
  carClass: text('car_class').notNull(),
  bestTime: real('best_time'),
  bestLap: real('best_lap'),
  replayId: text('replay_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.code, t.version, t.carClass] })]);

export const replays = pgTable('replays', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventId: text('event_id'),
  code: text('code'),
  title: text('title').notNull(),
  duration: real('duration').notNull(),
  cars: integer('cars').notNull(),
  bytes: integer('bytes').notNull(),
  data: bytea('data').notNull(),                         // the recording, gzip
  createdAt: created(),
}, t => [index('replays_owner').on(t.ownerId, t.createdAt)]);

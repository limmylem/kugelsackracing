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

// ---------- generated tracks: the day's and the week's, built courses, results, records, leaderboards, replays ----------
// (the day's and the week's track, worked out once — the quality-checked search — and kept: every server
// and every player the same)
export const trackDays = pgTable('track_days', {
  kind: text('kind').notNull(),                          // daily | weekly
  key: text('key').notNull(),                            // 2026-10-06 | 2026-W41
  data: jsonb('data').notNull(),                         // { code, name, seed, version, preset, info, quality }
  createdAt: created(),
}, t => [primaryKey({ columns: [t.kind, t.key] })]);
// (a track built from its code: its course as stored — what results are checked against — and its hash)
export const trackCourses = pgTable('track_courses', {
  code: text('code').primaryKey(),
  version: integer('version').notNull(),
  hash: text('hash').notNull(),
  course: jsonb('course').notNull(),
  info: jsonb('info').notNull(),
  createdAt: created(),
});
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
  rank: real('rank'),                                    // what it's ranked by: the time, or a hot lap's best lap (quest/rules.js rankedTime)
  score: real('score'),                                  // a drift's (ranked by it, highest first)
  bestLap: real('best_lap'),
  laps: jsonb('laps').notNull().default([]),
  accepted: boolean('accepted').notNull(),
  problems: jsonb('problems').notNull().default([]),
  result: jsonb('result'),                               // the result as sent (quest/result.js)
  recording: bytea('recording'),                         // the run's recording (gzip): the result's evidence
  replayId: text('replay_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('results_board').on(t.eventId, t.accepted, t.rank), index('results_board_score').on(t.eventId, t.accepted, t.score), index('results_user').on(t.userId, t.at)]);

export const trackRecords = pgTable('track_records', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  version: integer('version').notNull(),
  carClass: text('car_class').notNull(),
  bestTime: real('best_time'),
  bestLap: real('best_lap'),
  bestScore: real('best_score'),
  resultId: bigint('result_id', { mode: 'number' }),     // the best run (its recording: the ghost)
  replayId: text('replay_id'),
  runs: integer('runs').notNull().default(0),
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

// ---------- the economy (Phase 6 Step 2: the server's, the only copy) ----------
// A player's economy: the balance is the ledger's (kept here by the ledger's trigger, never written by the
// app — migration 0006), XP, the save's other parts. rev goes up with every change (other tabs and devices
// follow it).
export const playerEconomy = pgTable('player_economy', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  balance: bigint('balance', { mode: 'number' }).notNull().default(0),
  xp: bigint('xp', { mode: 'number' }).notNull().default(0),
  level: integer('level').notNull().default(1),
  rev: bigint('rev', { mode: 'number' }).notNull().default(0),
  profileVersion: integer('profile_version').notNull(),
  nextId: integer('next_id').notNull().default(1),
  currentCar: text('current_car'),
  state: jsonb('state').notNull().default({}),           // hints, quest log, track library, farming counts…
  createdAt: created(),
  updatedAt: updated(),
});
// Every money change, appended and never changed (a mistake is put right by a reversal: a new row)
export const ledger = pgTable('ledger', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
  kind: text('kind').notNull(),                          // purchase · sale · repair · entry_fee · refund · reward · grant · removal · reversal · start
  reason: text('reason').notNull(),
  ref: jsonb('ref').notNull().default({}),               // the items, the quest
  sessionId: text('session_id'),
  idemKey: text('idem_key'),
  actorId: text('actor_id'),                             // an admin's, for their grants, removals and reversals
  reverses: bigint('reverses', { mode: 'number' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('ledger_user').on(t.userId, t.id), index('ledger_at').on(t.at), index('ledger_kind_at').on(t.kind, t.at)]);
export const ownedCars = pgTable('owned_cars', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  instanceId: text('instance_id').notNull(),
  carId: text('car_id').notNull(),
  price: bigint('price', { mode: 'number' }).notNull().default(0),
  paint: jsonb('paint'),
  damage: jsonb('damage'),                               // the body shell: condition, dents (packed log), broken
  activeSetup: text('active_setup'),
  setups: jsonb('setups').notNull().default({}),
  extra: jsonb('extra'),                                 // bodyPrice, boughtAt, used (a used car's listing and history)
  createdAt: created(),
}, t => [primaryKey({ columns: [t.userId, t.instanceId] })]);
export const ownedParts = pgTable('owned_parts', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  instanceId: text('instance_id').notNull(),
  partId: text('part_id').notNull(),
  condition: real('condition').notNull(),
  price: bigint('price', { mode: 'number' }).notNull().default(0),
  tuning: jsonb('tuning'),
  paint: jsonb('paint'),
  damage: jsonb('damage'),                               // mechanical damage (garage/mechanical.js)
  dentLog: jsonb('dent_log'),                            // the compact damage events (garage/damageLog.js, packed)
  attach: text('attach'),
  extra: jsonb('extra'),                                 // boughtAt, used (the refund window: garage/shop.js)
  createdAt: created(),
}, t => [primaryKey({ columns: [t.userId, t.instanceId] })]);
// Which part copy is in which socket of which car: a copy in one place at most (the unique index)
export const carBuildSlots = pgTable('car_build_slots', {
  userId: text('user_id').notNull(),
  carInstanceId: text('car_instance_id').notNull(),
  socket: text('socket').notNull(),
  partInstanceId: text('part_instance_id').notNull(),
}, t => [primaryKey({ columns: [t.userId, t.carInstanceId, t.socket] }), uniqueIndex('build_part_once').on(t.userId, t.partInstanceId)]);
export const questProgress = pgTable('quest_progress', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  questId: text('quest_id').notNull(),
  medal: text('medal'),
  data: jsonb('data').notNull(),
}, t => [primaryKey({ columns: [t.userId, t.questId] })]);
export const itemHistory = pgTable('item_history', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  itemType: text('item_type').notNull(),                 // car · part
  instanceId: text('instance_id').notNull(),
  event: text('event').notNull(),                        // the action: bought, fitted, damaged, repaired, sold…
  details: jsonb('details').notNull().default({}),
  ledgerId: bigint('ledger_id', { mode: 'number' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('item_history_item').on(t.userId, t.instanceId, t.id)]);
// A quest's or a track event's run (and a drive in free roam: where crash damage comes from), from start to end
export const economySessions = pgTable('economy_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                          // quest · drive
  questId: text('quest_id'),
  attemptId: text('attempt_id'),
  carInstanceId: text('car_instance_id'),
  fee: bigint('fee', { mode: 'number' }).notNull().default(0),
  state: text('state').notNull(),                        // active · finished · failed · refunded · expired
  quest: jsonb('quest'),                                 // the quest as the server had it when it started
  result: jsonb('result'),
  endReason: text('end_reason'),
  paid: boolean('paid').notNull().default(false),
  damageReports: integer('damage_reports').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, t => [index('sessions_user_state').on(t.userId, t.state), index('sessions_active_seen').on(t.state, t.lastSeen)]);
// The economy's settings (prices, repairs, rewards, fees, anti-farming): versions, one active
export const economyConfig = pgTable('economy_config', {
  version: integer('version').primaryKey(),
  data: jsonb('data').notNull(),
  basedOn: integer('based_on'),
  actorId: text('actor_id'),
  reason: text('reason').notNull(),
  active: boolean('active').notNull().default(false),
  createdAt: created(),
}, t => [uniqueIndex('economy_config_one_active').on(t.active).where(sql`active`)]);
// A player's best runs' recordings (ghosts), compressed
export const playerRecordings = pgTable('player_recordings', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  id: text('id').notNull(),
  data: bytea('data').notNull(),
  createdAt: created(),
}, t => [primaryKey({ columns: [t.userId, t.id] })]);

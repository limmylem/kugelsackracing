// The database (PostgreSQL with PostGIS), as Drizzle tables. Every change to it is a migration made from this
// file (npm run db:generate → server/drizzle/*.sql, reviewed and committed; applied by npm run db:migrate and
// on the server's start) — never an edit by hand on a database.
//
//   accounts (Better Auth's tables: users, sessions, accounts, verifications — their fields as the library
//   needs them, with the admin and anonymous plugins' and ours: the terms, the display name's last change)
//   audit_log: every admin action · idempotency_keys: writes applied once
//   content_items / content_history / content_meta: world content (docs/WORLD_CONTENT.md, design note)
//   track_results / track_records / replays: generated tracks' results, records, leaderboards, race replays
//   friendships / blocks / mp_ratings / mp_races / mp_race_players: multiplayer (Phase 7 Step 2; docs/MULTIPLAYER.md)
//   mp_evidence: a contact's replay kept for a report (Phase 7 Step 3; docs/CONTACT.md)

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
  twoFactorEnabled: boolean('two_factor_enabled').default(false),   // (Better Auth's two-factor plugin)
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
  mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),   // (when this session passed two-factor sign-in)
}, t => [index('sessions_user').on(t.userId)]);

// two-factor sign-in (Better Auth's plugin): the authenticator's secret and the backup codes, encrypted
export const twoFactors = pgTable('two_factors', {
  id: text('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  verified: boolean('verified').default(true),
  failedVerificationCount: integer('failed_verification_count').default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
}, t => [index('two_factors_user').on(t.userId), index('two_factors_secret').on(t.secret)]);

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

// ---------- launch readiness (Phase 6 Step 5; migration 0011) ----------
// what links accounts for abuse review: kind 'device' (an HMAC of the game's random device id) or 'ip'; kept 90 days
export const accountSignals = pgTable('account_signals', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  value: text('value').notNull(),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  hits: integer('hits').notNull().default(1),
}, t => [primaryKey({ columns: [t.userId, t.kind, t.value] }), index('account_signals_value').on(t.kind, t.value)]);
// accounts flagged for review (server/src/abuse/detect.ts): never acted on by themselves
export const abuseFlags = pgTable('abuse_flags', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  kind: text('kind').notNull(),
  key: text('key').notNull().unique(),
  userIds: text('user_ids').array().notNull(),
  score: integer('score').notNull(),
  evidence: jsonb('evidence').notNull(),
  status: text('status').notNull().default('open'),                    // open | dismissed | actioned
  createdAt: created(), updatedAt: updated(),
  reviewedBy: text('reviewed_by'), reviewedAt: timestamp('reviewed_at', { withTimezone: true }), note: text('note'),
});
// players' reports of another player
export const reports = pgTable('reports', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  reporterId: text('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  targetId: text('target_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetName: text('target_name').notNull(),
  kind: text('kind').notNull(),                                          // cheating | name | behaviour | other
  details: text('details').notNull(),
  ref: jsonb('ref'),
  status: text('status').notNull().default('open'),                     // open | resolved
  createdAt: created(),
  resolvedBy: text('resolved_by'), resolvedAt: timestamp('resolved_at', { withTimezone: true }), resolution: text('resolution'), note: text('note'),
});
// "Contact support" and the feedback button (kept a year)
export const supportTickets = pgTable('support_tickets', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                                          // support | feedback
  category: text('category'),
  message: text('message').notNull(),
  contactEmail: text('contact_email'),
  client: jsonb('client').notNull(),                                     // the game's version, browser, OS, screen, GPU
  status: text('status').notNull().default('open'),
  createdAt: created(),
  handledBy: text('handled_by'), handledAt: timestamp('handled_at', { withTimezone: true }), note: text('note'),
});
// the closed beta's invite codes
export const inviteCodes = pgTable('invite_codes', {
  code: text('code').primaryKey(),
  note: text('note'),
  maxUses: integer('max_uses').notNull().default(1),
  uses: integer('uses').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revoked: boolean('revoked').notNull().default(false),
  createdBy: text('created_by'),
  createdAt: created(),
});
export const inviteUses = pgTable('invite_uses', {
  code: text('code').notNull().references(() => inviteCodes.code, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  emailHash: text('email_hash'),
  usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('invite_uses_code').on(t.code)]);
// switches flipped without a deploy: feature flags, maintenance mode (server/src/ops/settings.ts)
export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: updated(),
});
// alerts sent (server/src/ops/alerts.ts): one per problem until it clears
export const alerts = pgTable('alerts', {
  key: text('key').primaryKey(),
  state: text('state').notNull(),                                        // firing | resolved
  message: text('message').notNull(),
  firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
  lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  count: integer('count').notNull().default(1),
});

// ---------- multiplayer (Phase 7 Step 2; docs/MULTIPLAYER.md) ----------
// friends: one row a pair (a_id < b_id), asked by one, accepted by the other
export const friendships = pgTable('friendships', {
  aId: text('a_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bId: text('b_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),                                      // pending | accepted
  requestedBy: text('requested_by').notNull(),
  createdAt: created(), acceptedAt: timestamp('accepted_at', { withTimezone: true }),
}, t => [primaryKey({ columns: [t.aId, t.bId] }), index('friendships_b').on(t.bId)]);
// a player blocked by another: no chat, invites or friend requests from them; not matched together
export const blocks = pgTable('blocks', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  blockedId: text('blocked_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: created(),
}, t => [primaryKey({ columns: [t.userId, t.blockedId] })]);
// each player's skill rating (OpenSkill: mu, sigma), changed only by confirmed races
export const mpRatings = pgTable('mp_ratings', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  mu: real('mu').notNull(), sigma: real('sigma').notNull(),
  races: integer('races').notNull().default(0), wins: integer('wins').notNull().default(0),
  // the safety rating (Phase 7 Step 3; docs/CONTACT.md): 0–100, careless contacts down, clean races up
  safety: real('safety').notNull().default(60), safetyRaces: integer('safety_races').notNull().default(0),
  updatedAt: updated(),
});
// a race (the race server reports it as it ends: provisional; the API confirms it once the runs are checked)
export const mpRaces = pgTable('mp_races', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),                                          // quick | private | custom
  ranked: boolean('ranked').notNull(),
  venue: jsonb('venue').notNull(),                                       // what was raced: a route, a track code
  settings: jsonb('settings').notNull(),
  courseVersion: text('course_version'), trackHash: text('track_hash'),
  km: real('km').notNull(),
  humans: integer('humans').notNull(), npcs: integer('npcs').notNull(),
  state: text('state').notNull(),                                        // provisional | confirmed
  provisional: jsonb('provisional').notNull(),
  confirmed: jsonb('confirmed'),
  contacts: jsonb('contacts'),                                           // the agreed contacts (Phase 7 Step 3: each car's impulse, the blame)
  createdAt: created(), confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, t => [index('mp_races_state').on(t.state, t.createdAt)]);
export const mpRacePlayers = pgTable('mp_race_players', {
  raceId: text('race_id').notNull().references(() => mpRaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provisionalPlace: integer('provisional_place').notNull(),
  place: integer('place'),
  status: text('status').notNull(),                                      // finished | dnf | dsq (confirmed); as the server saw it before
  leftEarly: boolean('left_early').notNull().default(false),
  serverTimeMs: integer('server_time_ms'),
  run: jsonb('run'),                                                     // the run as the game handed it in (quest/result.js)
  recording: bytea('recording'),                                         // its recording, gzipped
  verdict: jsonb('verdict'),                                             // { ok, problems }
  pay: jsonb('pay'),                                                     // { money, xp, why }
  ratingBefore: jsonb('rating_before'), ratingAfter: jsonb('rating_after'),
  incidents: jsonb('incidents'),                                         // contacts at fault (Phase 7 Step 3): [{ share, strength, careless }]
  safetyBefore: real('safety_before'), safetyAfter: real('safety_after'),
  createdAt: created(),
}, t => [primaryKey({ columns: [t.raceId, t.userId] }), index('mp_race_players_user').on(t.userId, t.createdAt)]);
// what the race server kept of a contact for a report (Phase 7 Step 3: ramming — both cars' states round the hits)
export const mpEvidence = pgTable('mp_evidence', {
  id: text('id').primaryKey(),
  raceId: text('race_id'),
  kind: text('kind').notNull(),                                          // ramming
  fault: text('fault_id'), victim: text('victim_id'),
  data: bytea('data').notNull(),                                         // gzipped JSON: { cars: { uid: [{ t, pos, yaw, vel }] }, hits }
  createdAt: created(),
}, t => [index('mp_evidence_race').on(t.raceId)]);

// ---------- free roam (Phase 7 Step 4; docs/FREE_ROAM.md) ----------
// each player's free roam: settings (privacy, contact, passive), where they were (they come back there), the automatic protection's record
export const roamPlayers = pgTable('roam_players', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  settings: jsonb('settings').notNull().default({}),
  region: text('region'), pos: jsonb('pos'), heading: real('heading'), carId: text('car_id'), instanceId: text('instance_id'), damage: jsonb('damage'),
  savedAt: timestamp('saved_at', { withTimezone: true }),
  ghostUntil: timestamp('ghost_until', { withTimezone: true }), autoGhosts: integer('auto_ghosts').notNull().default(0),
  updatedAt: updated(),
});
// a challenge as the zone server recorded it, the check of it; who was paid what (the caps count these)
export const roamChallenges = pgTable('roam_challenges', {
  id: text('id').primaryKey(), type: text('type').notNull(), region: text('region'),
  players: text('players').array().notNull(), groupKey: text('group_key').notNull(), km: real('km'),
  record: jsonb('record').notNull(), verdict: jsonb('verdict'), createdAt: created(),
}, t => [index('roam_challenges_group').on(t.groupKey, t.createdAt)]);
export const roamChallengePlayers = pgTable('roam_challenge_players', {
  challengeId: text('challenge_id').notNull().references(() => roamChallenges.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  place: integer('place'), status: text('status').notNull(), timeMs: integer('time_ms'),
  money: integer('money').notNull().default(0), xp: integer('xp').notNull().default(0), why: text('why'), createdAt: created(),
}, t => [primaryKey({ columns: [t.challengeId, t.userId] }), index('roam_challenge_players_user').on(t.userId, t.createdAt)]);
// scheduled car meets at a meet spot (made on the admin page)
export const meetEvents = pgTable('meet_events', {
  id: text('id').primaryKey(), meetId: text('meet_id').notNull(), title: text('title').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(), hours: real('hours').notNull().default(2),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }), cancelled: boolean('cancelled').notNull().default(false), createdAt: created(),
}, t => [index('meet_events_start').on(t.startsAt)]);

// The data formats the game and the server share (Phase 6): every API request and response as a Zod
// schema, the one error format, the limits and the names of headers — one definition, so the client and the
// server never disagree. The server validates every request and response with these
// (fastify-type-provider-zod); the client checks what it sends and reads with the same ones (the browser
// bundle: dist/shared.browser.js, npm run build:shared).

import { z } from 'zod';

export { z };

// ---------- the API ----------
export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;
export const AUTH_PREFIX = '/api/auth';
// (a write is applied once per key: a retry with the same key gets the first answer — server/src/plugins/idempotency.ts)
export const IDEMPOTENCY_HEADER = 'idempotency-key';
// (cookie sessions: a write carries the token from GET /api/v1/csrf in this header)
export const CSRF_HEADER = 'x-csrf-token';
export const REQUEST_ID_HEADER = 'x-request-id';

export const LIMITS = {
  bodyBytes: 1_048_576,          // any request body, at most (1 MiB)
  replayBytes: 2_097_152,        // a race replay as kept, compressed (2 MiB)
  replayUploadBytes: 8_388_608,  // a race replay's upload (8 MiB of JSON)
  resultBytes: 2_097_152,        // a run's result with its recording (2 MiB)
  importBytes: 26_214_400,       // a world content import file (25 MiB)
  displayName: { min: 3, max: 20 },
  password: { min: 10, max: 128 },
  nameChangeDays: 30,            // a display name changes at most once in this many days
  queryKm: 50,                   // a nearby query's radius, at most
  queryLimit: 5000,              // a nearby query's items, at most
  idempotencyKey: { min: 8, max: 128 },
} as const;

// ---------- errors: one format for every failure ----------
export const ERROR_CODES = [
  'BAD_REQUEST', 'VALIDATION', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'GONE',
  'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'RATE_LIMITED', 'IDEMPOTENCY_MISMATCH', 'IDEMPOTENCY_IN_PROGRESS', 'IDEMPOTENCY_KEY_REQUIRED',
  'CSRF', 'TERMS_REQUIRED', 'BANNED', 'NAME_TAKEN', 'NAME_NOT_ALLOWED', 'NAME_CHANGE_TOO_SOON', 'NEEDS_CONFIRM', 'UNPUBLISHABLE',
  'REFUSED', 'OFFLINE', 'INTERNAL',
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;
export const ErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),                       // plain words, safe to show a player
    details: z.unknown().optional(),           // e.g. which fields were wrong
    requestId: z.string().optional(),          // to find it in the server's logs
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

// ---------- accounts ----------
export const ROLES = ['player', 'editor', 'admin'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;
export const EDITOR_ROLES: readonly Role[] = ['editor', 'admin'];

// a display name: 3–20 letters, digits, spaces, _ . - (no space at either end, none doubled); unique,
// case-insensitively (the server), and through the profanity filter (the server)
export const DisplayName = z.string().trim()
  .min(LIMITS.displayName.min, `A name needs at least ${LIMITS.displayName.min} characters.`)
  .max(LIMITS.displayName.max, `A name can have at most ${LIMITS.displayName.max} characters.`)
  .regex(/^[\p{L}\p{N}](?:[\p{L}\p{N}_.\- ]*[\p{L}\p{N}])?$/u, 'Use letters, digits, spaces, _ . or -, starting and ending with a letter or digit.')
  .refine(s => !/\s{2}/.test(s), 'No double spaces.');
export const Password = z.string().min(LIMITS.password.min, `A password needs at least ${LIMITS.password.min} characters.`).max(LIMITS.password.max);
export const Email = z.email().max(254);
export const IsoDate = z.iso.date();                       // YYYY-MM-DD

// what sign-up adds to Better Auth's own fields (POST /api/auth/sign-up/email): the terms accepted, and a
// birth date to check the minimum age (only the check's result is kept, never the date)
export const SignUpExtra = z.object({
  acceptTerms: z.string().min(1).max(32),    // the version of the terms (and privacy policy) accepted
  birthDate: IsoDate,
});
export const SignUpBody = z.object({ email: Email, password: Password, name: DisplayName }).extend(SignUpExtra.shape);

export const Me = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().nullable(),              // null for a guest
    emailVerified: z.boolean(),
    displayName: z.string(),
    role: Role,
    isGuest: z.boolean(),
    needsTerms: z.boolean(),                   // accepted terms missing or out of date: POST /me/terms first
    nameChangeAvailableAt: z.string().nullable(),
    createdAt: z.string(),
    providers: z.array(z.string()),            // 'credential', 'google', 'discord', 'anonymous'…
  }),
  terms: z.object({ version: z.string(), privacyVersion: z.string(), minAge: z.number().int() }),
});
export type Me = z.infer<typeof Me>;
export const AcceptTermsBody = z.object({ termsVersion: z.string().min(1).max(32), birthDate: IsoDate });
export const ChangeNameBody = z.object({ displayName: DisplayName });
export const NameCheck = z.object({ available: z.boolean(), reason: z.string().optional() });
export const DeleteAccountBody = z.object({ confirm: z.literal('DELETE'), password: z.string().max(LIMITS.password.max).optional() });

// ---------- admin ----------
export const AdminSearchQuery = z.object({ q: z.string().trim().min(1).max(100), limit: z.coerce.number().int().min(1).max(100).default(20) });
export const PlayerSummary = z.object({
  id: z.string(), email: z.string().nullable(), displayName: z.string(), role: Role, isGuest: z.boolean(),
  emailVerified: z.boolean(), banned: z.boolean(), banReason: z.string().nullable(), banExpires: z.string().nullable(), createdAt: z.string(),
});
export const PlayerDetail = PlayerSummary.extend({
  providers: z.array(z.string()), sessions: z.number().int(), records: z.number().int(), replays: z.number().int(), content: z.number().int(),
  termsVersion: z.string().nullable(), lastSeen: z.string().nullable(),
});
export const SetRoleBody = z.object({ role: Role, reason: z.string().trim().min(3).max(500) });
export const SuspendBody = z.object({ days: z.number().int().min(1).max(365), reason: z.string().trim().min(3).max(500) });
export const BanBody = z.object({ reason: z.string().trim().min(3).max(500) });
export const UnbanBody = z.object({ reason: z.string().trim().min(3).max(500) });
export const AuditEntry = z.object({
  id: z.number().int(), at: z.string(), actorId: z.string().nullable(), actorName: z.string().nullable(), action: z.string(),
  targetId: z.string().nullable(), targetName: z.string().nullable(), reason: z.string().nullable(), details: z.unknown(),
});

// ---------- world content (docs/WORLD_CONTENT.md: the same requests as content/service.js) ----------
export const VIEWS = ['draft', 'published', 'archived'] as const;
export const View = z.enum(VIEWS);
export const CONTENT_KINDS = ['quest', 'poi', 'spawn', 'route', 'series', 'venue'] as const;
export const ContentKind = z.enum(CONTENT_KINDS);
export const Lat = z.coerce.number().min(-90).max(90);
export const Lon = z.coerce.number().min(-180).max(180);
const kindsParam = z.string().max(200).optional().transform((s, ctx) => {
  if (!s) return null;
  const list = s.split(',').map(x => x.trim()).filter(Boolean);
  for (const k of list) if (!(CONTENT_KINDS as readonly string[]).includes(k)) { ctx.addIssue({ code: 'custom', message: `no such kind "${k}"` }); return z.NEVER; }
  return list;
});
export const ContentQuery = z.object({
  lat: Lat, lon: Lon,
  km: z.coerce.number().positive().max(LIMITS.queryKm),
  view: View.default('published'),
  kinds: kindsParam,
  offered: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  limit: z.coerce.number().int().min(1).max(LIMITS.queryLimit).default(LIMITS.queryLimit),
  fields: z.enum(['marker', 'full']).default('full'),
});
export const ViewQuery = z.object({
  view: View.default('published'),
  offered: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  fields: z.enum(['marker', 'full']).default('full'),
});
export const Geohash = z.string().regex(/^[0123456789bcdefghjkmnpqrstuvwxyz]{1,9}$/, 'not a geohash');
export const ItemId = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/, 'not an item id');
// an item as the client sends it: its shape is checked by the content schema on the server
// (data/schemas/content-item.schema.json, content/schema.js), the same check the editor runs
export const ContentItem = z.object({
  id: z.string().max(80).optional(),
  kind: ContentKind,
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).loose(),
}).loose();
export const ContentState = z.object({ draft: ContentItem.nullable(), published: ContentItem.nullable(), archived: ContentItem.nullable() });
export const Items = z.object({ ok: z.literal(true), items: z.array(z.record(z.string(), z.unknown())) });
export const NearItems = z.object({ ok: z.literal(true), items: z.array(z.object({ item: z.record(z.string(), z.unknown()), km: z.number() })) });
export const ItemResponse = z.object({ ok: z.literal(true), item: z.record(z.string(), z.unknown()).nullable(), route: z.record(z.string(), z.unknown()).nullable().optional() });
export const ImportQuery = z.object({ onConflict: z.enum(['replace', 'skip']).default('skip') });
export const ImportReport = z.object({
  ok: z.literal(true), imported: z.number().int(), migrated: z.number().int(), skipped: z.array(z.object({ id: z.string(), why: z.string() })),
  byKind: z.record(z.string(), z.number().int()), ms: z.number(),
});

// ---------- generated tracks: the day's and the week's, results, records, leaderboards, replays ----------
export const TRACK_KINDS = ['official', 'daily', 'weekly', 'quick', 'shared'] as const;
export const TrackKind = z.enum(TRACK_KINDS);
export const TrackCode = z.string().regex(/^[0-9A-Z]{5}(-[0-9A-Z]{1,5}){5}$/, 'not a track code');
export const CarClass = z.string().regex(/^[A-Za-z0-9_+-]{1,16}$/);
const Num = z.number().finite();
// the day's or the week's track (track/events/model.js, worked out on the server): its events are quest items
export const TrackOfDay = z.object({
  kind: z.enum(['daily', 'weekly']), key: z.string(), code: z.string(), name: z.string(), version: z.number().int(), preset: z.string().nullable(),
  seed: z.number(), info: z.record(z.string(), z.unknown()), quality: z.record(z.string(), z.unknown()).nullable(),
  hash: z.string(), endsAt: z.string(), events: z.array(z.record(z.string(), z.unknown())),
});
export const TracksToday = z.object({ now: z.string(), daily: TrackOfDay, weekly: TrackOfDay });
// a quest recording (quest/recording.js finish(): delta-coded samples, base64)
export const RecordingSchema = z.object({
  format: z.string().max(32), version: z.number().int(), hz: z.number().positive().max(240), frames: z.number().int().min(0).max(400_000),
  origin: z.array(Num).length(3), data: z.string().max(6_000_000), meta: z.record(z.string(), z.unknown()).optional(),
});
// a run's result as the game makes it (quest/result.js buildResult): its size bounded here, its sense
// checked by the game's own rules on the server (quest/validate.js)
export const RunResult = z.object({
  format: z.literal(1), attemptId: z.string().max(80).nullable(), at: z.string().max(40),
  questId: z.string().max(120), questVersion: z.string().max(80), type: z.string().max(40),
  routeId: z.string().max(120).nullable(), routeVersion: z.union([z.string().max(80), Num]).nullable(),
  status: z.string().max(20), reason: z.string().max(60).nullable(),
  car: z.object({ carId: z.string().max(80).nullable(), instanceId: z.string().max(80).nullable(), fingerprint: z.string().max(200).nullable(), className: z.string().max(16).nullable(), kw: Num.nullable(), kg: Num.nullable(), topSpeed: Num.nullable() }),
  start: z.object({ mode: z.string().max(20).nullable().optional(), jump: z.boolean() }),
  checkpoints: z.array(z.object({ id: z.string().max(60), lap: z.number().int().min(1).max(1000), time: Num })).max(20_000),
  laps: z.array(Num).max(1000),
  rawTime: Num.nullable(), time: Num.nullable(),
  penalties: z.array(z.object({ what: z.string().max(120), seconds: Num })).max(200),
  score: Num.nullable(), medal: z.string().max(12).nullable(),
  damage: z.object({ taken: Num, events: z.array(z.unknown()).max(500) }),
  cargo: z.unknown().optional(), cargoLost: Num.optional(),
  resets: z.number().int().min(0).max(100_000),
  place: z.number().int().min(1).max(64).optional(),
  field: z.array(z.object({ id: z.string().max(60), name: z.string().max(80).nullable(), player: z.boolean(), status: z.string().max(20), time: Num.nullable(), estimated: z.boolean() })).max(64).optional(),
  track: z.object({ code: TrackCode, kind: TrackKind, hash: z.string().max(60).nullable(), version: z.number().int().nullable() }).optional(),
  stints: z.unknown().optional(),
  recording: z.string().max(120).nullable(),
});
export const TrackResultBody = z.object({ eventId: z.string().max(120), result: RunResult, recording: RecordingSchema.nullable().optional(), replayId: z.string().max(80).nullable().optional() });
export const RecordEntry = z.object({
  code: z.string(), version: z.number().int(), carClass: z.string(), bestTime: z.number().nullable(), bestLap: z.number().nullable(), bestScore: z.number().nullable(),
  runs: z.number().int(), at: z.string(), replayId: z.string().nullable(),
});
export const TrackResultResponse = z.object({
  ok: z.literal(true), accepted: z.boolean(), problems: z.array(z.string()), pb: z.boolean(), record: RecordEntry.nullable(),
  board: z.object({ place: z.number().int().nullable(), of: z.number().int() }).nullable(),
});
export const LeaderboardQuery = z.object({ eventId: z.string().max(120), limit: z.coerce.number().int().min(1).max(100).default(20) });
export const Leaderboard = z.object({
  eventId: z.string(), scored: z.boolean(),           // (a drift's: by score, highest first; else by time)
  entries: z.array(z.object({ place: z.number().int(), displayName: z.string(), value: z.number(), carClass: z.string(), at: z.string(), replayId: z.string().nullable(), you: z.boolean() })),
  mine: z.object({ place: z.number().int(), value: z.number() }).nullable(), of: z.number().int(),
});
export const RecordsQuery = z.object({ code: TrackCode.optional() });
// a race replay (race/raceReplay.js createRaceRecording().finish()): kept on the server, compressed
export const ReplayRecording = z.object({
  hz: z.number().positive().max(240), duration: Num.nonnegative().max(36_000),
  events: z.array(z.record(z.string(), z.unknown())).max(5000),
  cars: z.array(z.object({ id: z.union([z.string().max(60), Num]), name: z.string().max(80).nullable(), colour: z.union([z.string().max(40), Num]).nullable(), player: z.boolean(), offset: Num, rec: RecordingSchema })).min(1).max(32),
});
export const ReplayUpload = z.object({ eventId: z.string().max(120).nullable(), code: TrackCode.nullable(), title: z.string().trim().min(1).max(120), recording: ReplayRecording });
export const ReplayMeta = z.object({ id: z.string(), title: z.string(), eventId: z.string().nullable(), code: z.string().nullable(), duration: z.number(), cars: z.number().int(), bytes: z.number().int(), createdAt: z.string(), mine: z.boolean() });
export const ReplayResponse = z.object({ meta: ReplayMeta, recording: ReplayRecording });

// ---------- the server ----------
export const Health = z.object({ ok: z.boolean(), version: z.string(), env: z.string(), db: z.enum(['ok', 'down']), dbId: z.string(), uptime: z.number() });
export const ClientConfig = z.object({
  apiBase: z.string(), env: z.string(), sentryDsn: z.string().nullable(), social: z.array(z.enum(['google', 'discord'])),
  termsVersion: z.string(), privacyVersion: z.string(), minAge: z.number().int(),
});
export const Ok = z.object({ ok: z.literal(true) });

// ---------- the economy (Phase 6 Step 2): what the game may ask the server's player service ----------
// Each action's arguments: what the player wants done — never a price, an amount of money or a car's stats
// (the server works those out). Anything else in a request is refused.
const InstanceId = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/, 'not an id');
const DataId = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/, 'not an id');
const Socket = z.string().regex(/^[A-Za-z0-9_.:-]{1,60}$/);
const Paint = z.object({ colour: z.string().max(32), finish: z.string().max(40) }).strict();
const Look = z.object({ colour: z.string().max(32).optional(), finish: z.string().max(40).optional() }).strict();
const SessionId = z.string().regex(/^(ses|drv)_[0-9a-f-]{36}$/, 'not a session id');
const Hit = z.object({ p: z.array(Num).length(3), d: z.array(Num).length(3), s: Num, w: Num.optional() }).strict();
const Hits = z.array(Hit).max(32);
const PartDamage = z.object({ condition: z.number().min(0).max(100).optional(), hits: Hits.optional(), damage: z.record(z.string().max(40), z.union([Num, z.record(z.string().max(40), Num)])).optional(), attach: z.enum(['attached', 'loose', 'detached']).optional() }).strict();
const ShellDamage = z.object({ condition: z.number().min(0).max(100).optional(), hits: Hits.optional(), broken: z.array(z.string().max(80)).max(64).optional() }).strict();
const RepairItem = z.object({ target: z.union([InstanceId, z.literal('shell')]), scope: z.union([z.literal('all'), z.string().max(60), z.record(z.string().max(40), z.unknown())]).optional() }).strict();
export const PLAYER_ACTION_ARGS = {
  buyPart: z.object({ partId: DataId, quantity: z.number().int().min(1).max(20).optional() }).strict(),
  sellPart: z.object({ instanceId: InstanceId }).strict(),
  repairPart: z.object({ instanceId: InstanceId }).strict(),
  repairParts: z.object({ instanceIds: z.array(InstanceId).min(1).max(200) }).strict(),
  repairBody: z.object({ carInstanceId: InstanceId }).strict(),
  repairCar: z.object({ carInstanceId: InstanceId, opts: z.object({ kind: z.enum(['quick', 'full']).optional(), items: z.array(RepairItem).max(200).optional() }).strict().optional() }).strict(),
  replaceWithSpare: z.object({ carInstanceId: InstanceId, socket: Socket, instanceId: InstanceId }).strict(),
  basicRepair: z.object({ carInstanceId: InstanceId }).strict(),
  installPart: z.object({ carInstanceId: InstanceId, instanceId: InstanceId, opts: z.object({ socket: Socket.optional(), auto: z.boolean().optional() }).strict().optional() }).strict(),
  removePart: z.object({ carInstanceId: InstanceId, which: Socket, opts: z.object({ auto: z.boolean().optional() }).strict().optional() }).strict(),
  buyAndInstall: z.object({ carInstanceId: InstanceId, partId: DataId, opts: z.object({ socket: Socket.optional(), auto: z.boolean().optional() }).strict().optional() }).strict(),
  setBuild: z.object({ carInstanceId: InstanceId, build: z.object({
    sockets: z.record(Socket, InstanceId.nullable()).optional(), tuning: z.record(InstanceId, z.record(z.string().max(40), Num.nullable()).nullable()).optional(),
    partPaint: z.record(InstanceId, Look.nullable()).optional(), paint: Paint.nullable().optional(), activeSetup: z.string().max(80).nullable().optional() }).strict() }).strict(),
  setTuning: z.object({ instanceId: InstanceId, settings: z.record(z.string().max(40), Num.nullable()) }).strict(),
  setPaint: z.object({ carInstanceId: InstanceId, paint: Paint.nullable() }).strict(),
  setPartFinish: z.object({ instanceIds: z.array(InstanceId).min(1).max(64), look: Look.nullable() }).strict(),
  selectCar: z.object({ carInstanceId: InstanceId }).strict(),
  buyCar: z.object({ carId: DataId }).strict(),
  // (Phase 6 Step 4: the shop, the dealership, selling)
  sellParts: z.object({ instanceIds: z.array(InstanceId).min(1).max(200) }).strict(),
  refundPart: z.object({ instanceId: InstanceId }).strict(),
  buyBundle: z.object({ bundleId: DataId, opts: z.object({ carInstanceId: InstanceId.optional(), install: z.boolean().optional() }).strict().optional() }).strict(),
  sellCar: z.object({ carInstanceId: InstanceId, opts: z.object({ keep: z.array(InstanceId).max(80).optional() }).strict().optional() }).strict(),
  buyUsedCar: z.object({ listingId: z.string().regex(/^used_\d{8}_\d{2}$/, 'not a listing') }).strict(),
  buyGarageSlot: z.object({}).strict(),
  saveSetup: z.object({ carInstanceId: InstanceId, opts: z.object({ name: z.string().trim().max(40).optional(), setupId: z.string().max(80).optional() }).strict().optional() }).strict(),
  renameSetup: z.object({ carInstanceId: InstanceId, setupId: z.string().max(80), name: z.string().trim().min(1).max(40) }).strict(),
  deleteSetup: z.object({ carInstanceId: InstanceId, setupId: z.string().max(80) }).strict(),
  switchSetup: z.object({ carInstanceId: InstanceId, setupId: z.string().max(80), opts: z.object({ force: z.boolean().optional() }).strict().optional() }).strict(),
  markHint: z.object({ id: z.string().regex(/^[a-zA-Z0-9_]{1,60}$/) }).strict(),
  favouriteTrack: z.object({ track: z.object({ code: TrackCode, kind: TrackKind, name: z.string().max(80).nullable().optional() }).strict(), on: z.boolean() }).strict(),
  startQuest: z.object({ questId: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/), trackCode: TrackCode.nullable().optional(), carInstanceId: InstanceId.optional(), restart: z.boolean().optional() }).strict(),
  refundQuest: z.object({ sessionId: SessionId }).strict(),
  finishQuest: z.object({ sessionId: SessionId, result: RunResult, recording: RecordingSchema.nullable().optional() }).strict(),
  failQuest: z.object({ sessionId: SessionId, status: z.string().regex(/^[a-z_]{1,24}$/).optional(), reason: z.string().max(80).nullable().optional() }).strict(),
  awardCar: z.object({ sessionId: SessionId, result: RunResult }).strict(),
  forfeitCar: z.object({ sessionId: SessionId, carInstanceId: InstanceId }).strict(),
  damageCar: z.object({ sessionId: SessionId, carInstanceId: InstanceId, report: z.object({ parts: z.record(InstanceId, PartDamage).optional(), shell: ShellDamage.nullable().optional() }).strict(), cause: z.string().max(80).nullable().optional() }).strict(),
  wearPart: z.object({ sessionId: SessionId, instanceId: InstanceId, condition: z.number().min(0).max(100), cause: z.string().max(80).nullable().optional() }).strict(),
  sessionReset: z.object({ sessionId: SessionId }).strict(),
} as const;
export type PlayerActionName = keyof typeof PLAYER_ACTION_ARGS;
export const PlayerActionBody = z.object({ args: z.record(z.string(), z.unknown()) }).strict();
export const DriveStart = z.object({ carInstanceId: InstanceId, mode: z.enum(['free', 'test']).default('free') }).strict();
export const AdminMoney = z.object({ amount: z.number().int().refine(n => n !== 0, 'not zero').refine(n => Math.abs(n) <= 100_000_000, 'too big'), reason: z.string().trim().min(3).max(500) }).strict();
export const AdminItem = z.object({ give: z.object({ partId: DataId.optional(), carId: DataId.optional(), quantity: z.number().int().min(1).max(20).optional() }).strict().optional(), remove: z.object({ instanceId: InstanceId.optional(), carInstanceId: InstanceId.optional() }).strict().optional(), reason: z.string().trim().min(3).max(500) }).strict();
export const AdminReverse = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
// the shop's catalogue on the admin page (Phase 6 Step 4): one change at a time, each a new version of the economy's
// settings (who, why: logged; any version can be rolled back to)
const When = z.string().datetime({ offset: true });
const UnlockRule = z.object({ level: z.number().int().min(1).max(100).optional(), series: z.string().regex(/^series_[0-9a-z]{4,40}$/).optional(), seriesName: z.string().max(80).optional() }).strict();
const Ids = z.array(DataId).max(500);
export const ShopSale = z.object({ id: DataId, name: z.string().trim().min(1).max(80), starts: When, ends: When, discount: z.number().gt(0).max(0.9), all: z.boolean().optional(), parts: Ids.optional(), cars: Ids.optional(), categories: Ids.optional(), tiers: Ids.optional(), classes: z.array(z.string().max(8)).max(20).optional(), disabled: z.boolean().optional() }).strict()
  .refine(s => Date.parse(s.ends) > Date.parse(s.starts), 'it has to end after it starts');
export const ShopBundle = z.object({ id: DataId, name: z.string().trim().min(1).max(80), car: DataId.optional(), parts: z.array(DataId).min(2).max(20), discount: z.number().min(0).max(0.5), unlock: UnlockRule.optional(), hidden: z.boolean().optional(), from: When.optional(), until: When.optional() }).strict();
export const ShopChange = z.object({
  change: z.discriminatedUnion('op', [
    z.object({ op: z.literal('item'), kind: z.enum(['part', 'car']), id: DataId, set: z.object({ price: z.number().int().min(0).max(100_000_000).nullable().optional(), hidden: z.boolean().nullable().optional(), unlock: UnlockRule.nullable().optional(), from: When.nullable().optional(), until: When.nullable().optional(), maker: z.string().trim().min(1).max(60).nullable().optional() }).strict() }).strict(),
    z.object({ op: z.literal('bundle'), bundle: ShopBundle }).strict(),
    z.object({ op: z.literal('bundle-remove'), id: DataId }).strict(),
    z.object({ op: z.literal('sale'), sale: ShopSale }).strict(),
    z.object({ op: z.literal('sale-remove'), id: DataId }).strict(),
    z.object({ op: z.literal('usedLot'), settings: z.record(z.string(), z.unknown()) }).strict(),
    z.object({ op: z.literal('unlock'), settings: z.object({ partTiers: z.record(z.string(), UnlockRule).optional(), carClasses: z.record(z.string(), UnlockRule).optional() }).strict() }).strict(),
  ]),
  reason: z.string().trim().min(3).max(500), basedOn: z.number().int().positive(),
}).strict();
export const EconomyChange = z.object({ data: z.object({ economy: z.record(z.string(), z.unknown()), quests: z.record(z.string(), z.unknown()) }).strict(), reason: z.string().trim().min(3).max(500), basedOn: z.number().int().positive() }).strict();

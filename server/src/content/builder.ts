// The Content tab's family builder on the server (docs/CONTENT_PIPELINE.md "A family from the admin page"): families,
// engines and cars made and changed by picking options, what they'll make worked out before anything is made, and
// made as background jobs — the content pipeline's own modules (tools/content/builder.mjs, jobs.mjs), writing the same
// files as npm run content and a person do. Where the server runs from a development copy of the game (config
// contentBuilder mode 'local': npm run server:dev) the jobs run here; on the live server (mode 'github': its files
// aren't the repository) what a family makes and its previews are worked out here, and what's made is sent to the
// content-builder workflow (./github.ts), which makes it, commits it to main and starts the deploy. Every action is in the history (catalogue_history: kind family, engine,
// preset or car) and the admins' log, with who and why.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { REPO_DIR } from '../config.ts';
import { AppError, badRequest, notFound } from '../errors.ts';
import { gameData, reloadGameData } from '../economy/config.ts';
import { auditLog } from '../db/schema.ts';
import type { ContentManager } from './manager.ts';
import { fitWithNeeds } from '../../../garage/balance.js';
import { withContent } from '../../../garage/content.js';
import { Garage } from '../../../garage/data.js';
import type { GithubRunner } from './github.ts';

export type Actor = { id: string; name: string };
const load = (f: string) => import(pathToFileURL(path.join(REPO_DIR, f)).href);

export function createContentBuilder(db: Db, { manager, enabled, remote = null, log = (..._: any[]) => {} }: { manager: ContentManager; enabled: boolean; remote?: GithubRunner | null; log?: (...a: any[]) => void }) {
  // (previews are made in a folder of their own: the live server's own files can't be written)
  const PREVIEWS = remote ? path.join(os.tmpdir(), 'kr-builder-previews') : '.cache/builder';
  let B: any = null, J: any = null, P: any = null, why: string | null = null, jobs: any = null, ctx: any = null, loading: Promise<void> | null = null;
  // (what players have of the parts a job changes, taken before it starts: held as published once it's done)
  const holds = new Map<string, { held: Record<string, any>; actor: Actor; reason: string }>();
  const listeners = new Set<(job: any) => void>();

  async function ready() {
    if (B || why) return;
    loading ??= (async () => {
      if (!enabled) { why = 'The Builder is switched off on this server (config contentBuilder.enabled).'; return; }
      try { [B, J, P] = await Promise.all([load('tools/content/builder.mjs'), load('tools/content/jobs.mjs'), load('tools/content/preview.mjs')]); }
      catch (err: any) { why = `The content pipeline isn't here (${err.message.split('\n')[0]}): the builder needs a development copy with its tools installed (npm install).`; B = null; return; }
      jobs = J.createJobs({ root: REPO_DIR, onChange: (j: any) => { for (const f of listeners) f(j); }, onFinish });
    })();
    await loading;
  }
  async function need() { await ready(); if (!B) throw new AppError(409, 'CONFLICT', why ?? 'The builder isn\'t available here.'); }
  async function context(fresh = false) { await need(); if (!ctx || fresh) ctx = await B.builderContext({ root: REPO_DIR }); return ctx; }
  const forget = () => { ctx = null; };

  // ---------- history and the admins' log ----------
  async function record(kind: string, id: string, action: string, actor: Actor | null, reason: string, edits: object = {}) {
    await db.execute(sql`insert into catalogue_history (id, kind, version, action, status, set, edits, actor_id, reason) values (${id}, ${kind}, 0, ${action}, 'draft', null, ${JSON.stringify(edits)}::jsonb, ${actor?.id ?? null}, ${reason})`);
    if (actor) await db.insert(auditLog).values({ actorId: actor.id, action: `content-builder-${action.replace(/\s+/g, '-')}`, targetId: null, reason, details: { kind, id, ...edits } });
  }
  async function history(kind: string, id: string) {
    const rows = (await db.execute(sql`select h.seq, h.action, h.edits, h.reason, h.at, u.name as actor from catalogue_history h left join users u on u.id = h.actor_id where h.kind = ${kind} and h.id = ${id} order by h.seq desc limit 100`)).rows as any[];
    return rows.map(h => ({ seq: Number(h.seq), action: h.action, details: h.edits, reason: h.reason, actor: h.actor ?? null, at: new Date(h.at).toISOString() }));
  }
  const KIND_OF: Record<string, string> = { family: 'family', engine: 'engine', car: 'car', build: 'family', preview: 'family', preset: 'preset' };
  async function onFinish(j: any) {
    if (j.writes) { reloadGameData(); manager.reload(); forget(); }
    const hold = holds.get(j.id);
    holds.delete(j.id);
    if (hold && j.state === 'done') { try { await manager.applyHold(hold.held, hold.actor.id, hold.reason); } catch (err) { log({ err }, 'content builder: holding the published versions failed'); } }
    const r = j.result ?? {};
    const details = { job: j.id, title: j.title, ...(r.words && { result: r.words }), ...(r.parts && { parts: r.parts.length }), ...(j.error && { error: j.error }) };
    try { for (const id of j.payload?.ids ?? String(j.target).split(',')) await record(KIND_OF[j.type] ?? j.type, id, `${j.type} ${j.state}`, j.by, j.reason || '(the job)', details); }
    catch (err) { log({ err }, 'content builder: recording a job failed'); }
  }
  // A job that writes the game's files: run here, or (the live server) sent to GitHub as the request it came from
  async function send(spec: any, request: object, actor: Actor, reason: string, hold: Record<string, any> = {}) {
    if (!remote) { const job = await startJob(spec, actor, reason); if (Object.keys(hold).length) holds.set(job.id, { held: hold, actor, reason }); return job; }
    await need();
    const id = `gh_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    let job;
    try { job = await remote.dispatch({ id, type: spec.type, target: spec.target, title: spec.title, by: actor, reason, created: new Date().toISOString() }, request); }
    catch (err: any) { throw new AppError(409, 'CONFLICT', err.message); }
    if (Object.keys(hold).length) holds.set(id, { held: hold, actor, reason });
    await record(KIND_OF[spec.type] ?? spec.type, spec.target, `${spec.type} sent`, actor, reason, { job: id, title: spec.title, to: 'GitHub (content-builder workflow)' });
    watch();
    return job;
  }
  // (the live server: GitHub's runs for what was sent from here, watched until they end — then in the history, and a
  // change's hold applied: players keep the published versions until they're published again)
  let watching: NodeJS.Timeout | null = null;
  function watch() {
    if (!remote || watching) return;
    watching = setInterval(async () => {
      const ids = remote.pending();
      if (!ids.length) { clearInterval(watching!); watching = null; return; }
      for (const id of ids) {
        try {
          const j = await remote.get(id);
          if (!j || ['waiting', 'running'].includes(j.state)) continue;
          remote.forget(id);
          await onFinish({ ...j, writes: false });
        } catch (err) { log({ err }, 'content builder: reading a GitHub run failed'); }
      }
    }, 30_000);
    watching.unref?.();
  }
  async function startJob(spec: any, actor: Actor, reason: string) {
    await need();
    let job;
    try { job = jobs.start({ ...spec, by: actor, reason }); }
    catch (err: any) { throw new AppError(409, 'CONFLICT', err.message); }
    await record(KIND_OF[spec.type] ?? spec.type, spec.type === 'build' ? spec.payload.ids.join(',') : spec.target, `${spec.type} started`, actor, reason, { job: job.id, title: spec.title });
    return job;
  }

  // ---------- families ----------
  // (what the form sends, as a family: refused, with every reason, if it isn't one)
  async function familyFrom(input: any, { editing = null }: { editing?: string | null } = {}) {
    const c = await context(), { def, problems } = B.normaliseFamily(input, c, { editing });
    if (!def || problems.length) throw new AppError(400, 'VALIDATION', problems[0] ?? 'That isn\'t a family.', problems.map((p: string) => ({ problem: p })));
    if (editing && !c.families[editing]) throw notFound(`The family "${editing}"`);
    return { c, def };
  }
  async function summary(input: any, { editing = null }: { editing?: string | null } = {}) {
    const { c, def } = await familyFrom(input, { editing });
    const s = await B.summarise(def, c, { editing });
    const out: any = { ...s, text: B.familyText(def), def, previewPicks: P.previewPicks(s.parts, { max: c.config.preview.maxParts }) };
    if (editing) out.changes = await withOwners(await B.familyChanges(def, c, { summary: s }));
    return out;
  }
  async function withOwners(changes: any) {
    const ids = changes.retired.map((x: any) => x.id);
    const counts = ids.length ? (await db.execute(sql`select part_id, count(distinct user_id)::int as players, count(*)::int as copies from owned_parts where part_id in (${sql.join(ids.map((id: string) => sql`${id}`), sql`, `)}) group by part_id`)).rows as any[] : [];
    const by = new Map(counts.map(r => [r.part_id, r]));
    for (const x of changes.retired) { x.players = by.get(x.id)?.players ?? 0; x.copies = by.get(x.id)?.copies ?? 0; }
    return changes;
  }
  // A new family: its file written as a draft, then built and checked (a job)
  async function make(input: any, actor: Actor, reason: string) {
    const { c, def } = await familyFrom(input);
    const s = await B.summarise(def, c, { suggest: false });
    if (s.problems.length) throw new AppError(400, 'VALIDATION', s.problems[0], s.problems.map((p: string) => ({ problem: p })));
    const text = B.familyText({ ...def, status: 'draft' });
    const job = await send({ type: 'family', target: def.id, title: `New family: ${def.name}`, payload: { def: { ...def, status: 'draft' }, text } }, { type: 'family', input: def }, actor, reason);
    return { job, text, file: `data/families/${def.id}.json`, remote: !!remote };
  }
  // An existing family changed: what changes (parts added, changed, retired — and who owns those), then its file
  // written and the family built and checked again (a job). Ids of parts it still makes stay the same.
  async function change(id: string, input: any, actor: Actor, reason: string) {
    const { c, def } = await familyFrom({ ...input, id }, { editing: id });
    const s = await B.summarise(def, c, { editing: id, suggest: false });
    if (s.problems.length) throw new AppError(400, 'VALIDATION', s.problems[0], s.problems.map((p: string) => ({ problem: p })));
    const changes = await withOwners(await B.familyChanges(def, c, { summary: s }));
    const was = c.families[id], text = B.familyText({ ...def, _note: was._note ?? def._note, status: was.status ?? 'draft' });
    if (text === fs.readFileSync(path.join(REPO_DIR, `data/families/${id}.json`), 'utf8')) throw badRequest('Nothing changed: the family file would be the same.');
    // (players keep what's published until it's published again: the parts it changes become new versions, drafts)
    const held = await manager.prepareHold(changes.changed.map((x: any) => x.id));
    const job = await send({ type: 'family', target: id, title: `Change family: ${def.name}`, payload: { def, text } }, { type: 'family', input: def, editing: id }, actor, reason, held);
    return { job, text, file: `data/families/${id}.json`, changes, held: Object.keys(held), remote: !!remote };
  }
  async function rebuild(ids: string[], actor: Actor, reason: string) {
    const c = await context();
    for (const id of ids) if (!c.families[id] && !c.engines[id]) throw notFound(`The family or engine "${id}"`);
    return send({ type: 'build', target: ids.join(','), title: `Build and check: ${ids.join(', ')}`, payload: { ids } }, { type: 'build', ids }, actor, reason);
  }
  async function family(id: string) {
    const c = await context(), def = c.families[id];
    if (!def) throw notFound(`The family "${id}"`);
    const parts = Object.values<any>(c.db.parts).filter(p => p.generated?.family === id);
    return { def, text: fs.readFileSync(path.join(REPO_DIR, `data/families/${id}.json`), 'utf8'), parts: { made: parts.filter(p => !p.retired).length, retired: parts.filter(p => p.retired).length }, history: await history('family', id) };
  }

  // ---------- previews ----------
  async function preview(input: any, ids: string[] | null, cars: string[] | null, actor: Actor, reason: string) {
    const { c, def } = await familyFrom(input, { editing: input?.editing ?? null });
    const s = await B.summarise(def, c, { editing: input?.editing ?? null, suggest: false });
    const picks = ids?.length ? ids : P.previewPicks(s.parts, { max: c.config.preview.maxParts });
    if (!picks.length) throw badRequest(s.problems[0] ?? 'It makes no parts to preview.');
    const target = `preview:${def.id}`;
    // (a newer preview of the same family replaces one still going)
    for (const j of jobs.list().filter((x: any) => x.target === target && ['waiting', 'running'].includes(x.state))) jobs.cancel(j.id);
    await new Promise(r => setTimeout(r, 0));
    const job = await startJob({ type: 'preview', target, title: `Preview: ${def.name} (${picks.length} part${picks.length === 1 ? '' : 's'})`, payload: { def, ids: picks, cars, out: `${PREVIEWS}/${target.replace(/[^a-z0-9_]/g, '_')}_${Date.now().toString(36)}` } }, actor, reason);
    return { job, picks };
  }
  // A preview's file (its models, icons, thumbnails), from its job's folder only
  async function previewFile(jobId: string, file: string) {
    await need();
    const j = jobs.get(jobId);
    if (!j || j.type !== 'preview' || !j.result?.folder) throw notFound('That preview');
    if (!/^[a-z0-9_]+\.(glb|png|webp)$/.test(file)) throw notFound('That file');
    const full = path.resolve(REPO_DIR, j.result.folder, file);
    if (!fs.existsSync(full)) throw notFound('That file');
    return { body: fs.readFileSync(full), type: file.endsWith('.glb') ? 'model/gltf-binary' : file.endsWith('.png') ? 'image/png' : 'image/webp' };
  }
  // A previewed part on a car, for the 3D preview: as manager.preview, with the preview's model
  async function previewOnCar(jobId: string, partId: string, carId: string, url: (f: string) => string) {
    await need();
    const j = jobs.get(jobId), entry = j?.type === 'preview' && j.state === 'done' ? j.result.parts.find((x: any) => x.id === partId) : null;
    if (!entry?.part) throw notFound(`The part "${partId}" in that preview`);
    const { db: game } = await gameData(), base = withContent(game, await manager.overlay());
    if (!base.cars[carId]) throw notFound(`The car "${carId}"`);
    const file = (f: string) => url(path.basename(f));
    const part = { ...entry.part, model: file(entry.model), byCar: Object.fromEntries(Object.entries(entry.byCar ?? {}).map(([k, v]: any) => [k, { model: file(v.model) }])) };
    const db2 = { ...base, parts: { ...base.parts, [partId]: part } };
    const r = fitWithNeeds(db2, carId, partId);
    let build = r.garage.build, owned = r.garage.state.parts;
    if (!r.ok) {
      const g = new Garage(db2, null, carId), copy = 'preview_copy', sockets = { ...g.build.sockets };
      owned = { ...g.state.parts, [copy]: { instanceId: copy, partId, condition: 100 } };
      for (const sk of g.socketsFor(partId)) sockets[sk] = copy;
      build = { ...g.build, sockets };
    }
    const parts: Record<string, any> = {};
    const add = (id: string) => { for (let q = db2.parts[id], n = 0; q && n < 8 && !parts[q.id]; q = q.variantOf ? db2.parts[q.variantOf] : null, n++) parts[q.id] = q; };
    for (const x of Object.values<any>(owned)) add(x.partId);
    return { car: db2.cars[carId], finishes: db2.finishes, build, owned, parts, fitted: r.ok, why: r.ok ? null : r.error, with: r.with ?? [] };
  }
  // The live shape preview: one part's model, made there and then (not a job: one small model)
  async function shapeModel(input: any, partId: string | null) {
    const { c, def } = await familyFrom(input, { editing: input?.editing ?? null });
    try { return await B.shapeModel(def, partId, c); } catch (err: any) { throw new AppError(err.status ?? 400, 'VALIDATION', err.message); }
  }

  // ---------- presets and variations ----------
  async function presets() { await need(); return B.listPresets(REPO_DIR); }
  async function savePreset(name: string, input: any, actor: Actor, reason: string) {
    const { c, def } = await familyFrom({ ...input, name: input?.name || 'Preset' });
    const p = B.presetProblem(name);
    if (p) throw badRequest(p);
    const s = await B.summarise({ ...def, name: def.name }, c, { suggest: false });
    const bad = s.problems.filter((x: string) => !/name|id "|There's already a family|ids would start/.test(x));
    if (bad.length) throw new AppError(400, 'VALIDATION', bad[0], bad.map((x: string) => ({ problem: x })));
    const file = B.presetFile(name), text = B.presetText(B.presetFrom(name, def));
    if (remote) { const job = await send({ type: 'preset', target: path.basename(file, '.json'), title: `Preset saved: ${name}` }, { type: 'preset-save', name, input: def }, actor, reason); return { file, text, job, remote: true }; }
    fs.mkdirSync(path.join(REPO_DIR, path.dirname(file)), { recursive: true });
    const existed = fs.existsSync(path.join(REPO_DIR, file));
    fs.writeFileSync(path.join(REPO_DIR, file), text);
    await record('preset', path.basename(file, '.json'), existed ? 'preset changed' : 'preset saved', actor, reason, { file });
    return { file, text };
  }
  async function deletePreset(name: string, actor: Actor, reason: string) {
    await need();
    const file = B.presetFile(name), full = path.join(REPO_DIR, file);
    if (!fs.existsSync(full)) throw notFound(`The preset "${name}"`);
    if (remote) { const job = await send({ type: 'preset', target: path.basename(file, '.json'), title: `Preset deleted: ${name}` }, { type: 'preset-delete', name }, actor, reason); return { file, job, remote: true }; }
    fs.rmSync(full);
    await record('preset', path.basename(file, '.json'), 'preset deleted', actor, reason, { file });
    return { file };
  }
  async function variationsPlan(from: any, vary: any, count: number, seed: number) {
    const c = await context();
    try { return await B.variationPlan(from, vary, c, { count, seed }); } catch (err: any) { throw new AppError(err.status ?? 400, err.status === 404 ? 'NOT_FOUND' : 'VALIDATION', err.message); }
  }
  async function makeVariations(families: any[], actor: Actor, reason: string) {
    const c = await context();
    if (families.length > c.config.variations.max) throw badRequest(`At most ${c.config.variations.max} at once (data/content/builder.json variations.max).`);
    const checked: any[] = [];
    for (const f of families) { const { def } = await familyFrom(f); const s = await B.summarise(def, c, { suggest: false }); if (s.problems.length) throw new AppError(400, 'VALIDATION', `${def.name}: ${s.problems[0]}`, s.problems.map((p: string) => ({ problem: `${def.name}: ${p}` }))); checked.push(def); }
    const ids = checked.map(d => d.id);
    if (new Set(ids).size !== ids.length) throw badRequest('Two of them have the same id: give them different names.');
    if (remote) { const job = await send({ type: 'family', target: ids.join(','), title: `New families: ${checked.map(d => d.name).join(', ')}` }, { type: 'variations', families: checked }, actor, reason); return { made: checked.map(d => ({ job, file: `data/families/${d.id}.json` })), remote: true }; }
    const out: any[] = [];
    for (const def of checked) out.push(await make(def, actor, reason));
    return { made: out };
  }

  // ---------- engines and cars ----------
  async function engineSummary(input: any, { editing = null }: { editing?: string | null } = {}) {
    const c = await context();
    return B.engineSummary(input, c, { editing });
  }
  async function makeEngine(input: any, actor: Actor, reason: string, { editing = null }: { editing?: string | null } = {}) {
    const c = await context(), s = await B.engineSummary(input, c, { editing });
    if (s.problems.length) throw new AppError(400, 'VALIDATION', s.problems[0], s.problems.map((p: string) => ({ problem: p })));
    const held = editing ? await manager.prepareHold([`crate_${editing}`]) : {};
    const job = await send({ type: 'engine', target: s.def.id, title: `${editing ? 'Change' : 'New'} engine: ${s.name}`, payload: { def: s.def, text: s.text } }, { type: 'engine', input, editing }, actor, reason, held);
    return { job, text: s.text, file: `data/engines/${s.def.id}.json`, remote: !!remote };
  }
  async function makeCar(input: { id: string; type: string; name?: string; model?: string | null }, actor: Actor, reason: string) {
    const c = await context(), p = B.carProblems(input, c);
    if (p.length) throw new AppError(400, 'VALIDATION', p[0], p.map((x: string) => ({ problem: x })));
    if (remote) {
      if (input.model) throw badRequest('On the live server a new car starts as its placeholder: add its model afterwards (npm run import on a computer; docs/MODELLING_GUIDE.md).');
      return send({ type: 'car', target: input.id, title: `New car: ${input.name || input.id}` }, { type: 'car', input: { id: input.id, type: input.type, name: input.name ?? null } }, actor, reason);
    }
    let model: string | null = null;
    if (input.model) {
      const bytes = Buffer.from(input.model, 'base64');
      if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'glTF') throw badRequest('The model isn\'t a glTF binary (.glb).');
      model = `incoming/upload_car_${input.id}.glb`;
      fs.mkdirSync(path.join(REPO_DIR, 'incoming'), { recursive: true });
      fs.writeFileSync(path.join(REPO_DIR, model), bytes);
    }
    return startJob({ type: 'car', target: input.id, title: `New car: ${input.name || input.id}`, payload: { type: input.type, name: input.name ?? null, model } }, actor, reason);
  }

  // A car as it comes (its stock build), for the 3D preview: a new car's placeholder, ready to drive and fill in
  async function carPreview(carId: string) {
    const { db: game } = await gameData(), base = withContent(game, await manager.overlay());
    if (!base.cars[carId]) throw notFound(`The car "${carId}"`);
    const g = new Garage(base, null, carId), parts: Record<string, any> = {};
    for (const x of Object.values<any>(g.state.parts)) for (let q = base.parts[x.partId], n = 0; q && n < 8 && !parts[q.id]; q = q.variantOf ? base.parts[q.variantOf] : null, n++) parts[q.id] = q;
    return { car: base.cars[carId], finishes: base.finishes, build: g.build, owned: g.state.parts, parts, fitted: true, why: null, with: [] };
  }

  return {
    available: async () => { await ready(); return { ok: !!B, why, mode: remote ? 'github' : 'local', canMake: !remote || remote.ready() }; },
    carPreview,
    overview: async () => { const c = await context(); return { kinds: B.kindList(c), presets: B.listPresets(REPO_DIR), engines: Object.values<any>(c.engines).map(e => ({ id: e.id, name: e.name ?? null, maker: e.maker })), config: c.config, carTypes: B.carOptions(c) }; },
    kind: async (kind: string) => { const c = await context(), o = B.kindOptions(kind, c); if (!o) throw notFound(`The kind "${kind}"`); return o; },
    names: async (kind: string, seed: number) => { const c = await context(); return B.suggestFamilyNames(kind, c, { seed }); },
    nameProblem: async (name: string) => { const c = await context(); return B.nameProblemOf(name, c); },
    summary, make, change, rebuild, family, preview, previewFile, previewOnCar, shapeModel,
    presets, savePreset, deletePreset, variationsPlan, makeVariations,
    engineOptions: async () => B.engineOptions(await context()), engineSummary, makeEngine, engine: async (id: string) => { const c = await context(); if (!c.engines[id]) throw notFound(`The engine "${id}"`); return { def: c.engines[id], text: fs.readFileSync(path.join(REPO_DIR, `data/engines/${id}.json`), 'utf8'), history: await history('engine', id) }; },
    makeCar,
    jobs: async () => {
      await ready();
      const here = jobs ? jobs.list() : [];
      if (!remote) return here;
      let there: any[] = [];
      try { there = await remote.list(); } catch (err: any) { there = [{ id: 'github', type: 'note', target: '', title: 'GitHub', state: 'failed', log: [], error: err.message, created: new Date().toISOString(), by: null, reason: '' }]; }
      return [...here, ...there].sort((a, b) => String(b.created).localeCompare(String(a.created)));
    },
    job: async (id: string) => {
      await need();
      const j = jobs.get(id) ?? (remote ? await remote.get(id).catch((err: any) => { throw new AppError(409, 'CONFLICT', err.message); }) : null);
      if (!j) throw notFound('That job');
      return j;
    },
    cancel: async (id: string, actor: Actor, reason: string) => {
      await need();
      const here = jobs.get(id);
      if (!here && remote) {
        let r;
        try { r = await remote.cancel(id); } catch (err: any) { throw new AppError(409, 'CONFLICT', err.message); }
        await record(KIND_OF[r.type] ?? r.type, r.target || id, `${r.type} cancel`, actor, reason, { job: id });
        return r;
      }
      if (!here) throw notFound('That job');
      const r = jobs.cancel(id); await record(KIND_OF[here.type] ?? here.type, here.target, `${here.type} cancel`, actor, reason, { job: id }); return r;
    },
    onJob: (f: (job: any) => void) => { listeners.add(f); return () => listeners.delete(f); },
    close: async () => { if (watching) clearInterval(watching); await jobs?.close(); },
  };
}
export type ContentBuilder = ReturnType<typeof createContentBuilder>;

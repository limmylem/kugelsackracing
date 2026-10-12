// The content manager's live checks (server/src/content/manager.ts), off the API's thread: an edited part's version
// against its tier and the class limits (garage/liveChecks.js), with the game's data as published plus that version.
import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { loadGarageData } from '../../../garage/data.js';
import { withContent } from '../../../garage/content.js';
import { liveChecks } from '../../../garage/liveChecks.js';

const repo: string = workerData.repo, read = (p: string) => JSON.parse(fs.readFileSync(path.join(repo, p), 'utf8'));
const { db: game } = await loadGarageData(async (f: string) => read(f));
const tiers = read('data/content/tiers.json'), balance = read('data/content/balance.json');
const checks = fs.existsSync(path.join(repo, 'data/content/checks.json')) ? read('data/content/checks.json') : { classes: {} };
parentPort!.on('message', (m: { id: string; overlay: any }) => {
  try {
    const db = withContent(game, m.overlay);
    parentPort!.postMessage({ id: m.id, result: liveChecks(db, db.parts[m.id], { tiers, balance, classes: checks.classes }) });
  } catch (err: any) { parentPort!.postMessage({ id: m.id, error: err?.message ?? String(err) }); }
});

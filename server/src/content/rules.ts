// The world content rules the server checks every write with: the same code the editor runs in the browser
// (content/schema.js against data/schemas/content-item.schema.json, content/quests.js's plain-word problems,
// content/rating.js's ratings and rewards, content/migrations.js for items saved by older versions) and the
// same data files. One copy of the rules: the server and the editor never disagree.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_DIR } from '../config.ts';
// (the game's own modules, plain JavaScript shared with the browser)
import { contentChecker } from '../../../content/schema.js';
import { makeRater } from '../../../content/rating.js';
import { blocking, CONTENT_VERSION, MARKER_KINDS } from '../../../content/quests.js';
import { migrate } from '../../../content/migrations.js';
import { encode, decode, CELL_PRECISION, tileBox, boxAround } from '../../../content/geo.js';

const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(REPO_DIR, p), 'utf8'));

export type Rules = ReturnType<typeof loadRules>;
export function loadRules() {
  const schema = readJson('data/schemas/content-item.schema.json'), economy = readJson('data/economy.json'), classesFile = readJson('data/classes.json');
  const quests = readJson('data/quests.json'), carIndex = readJson('data/cars/index.json');
  const cars = Object.fromEntries(carIndex.cars.map((f: string) => { const c = readJson(`data/cars/${f}`); return [c.id ?? f.split('/')[0], { name: c.name ?? f.split('/')[0], class: c.class ?? null }]; }));
  const check = contentChecker(schema, { economy, classes: classesFile.classes, cars });
  const rate = makeRater({ config: quests, classes: classesFile.classes });
  return { check, rate, blocking, migrate, CONTENT_VERSION: CONTENT_VERSION as number, MARKER_KINDS: MARKER_KINDS as string[], cellOf: (lat: number, lon: number) => encode(lat, lon, CELL_PRECISION) as string, decode, tileBox, boxAround: boxAround as (lat: number, lon: number, km: number) => number[], CELL_PRECISION: CELL_PRECISION as number };
}

// what a map marker needs: everything but a route's whole course (the heavy part: its line, roads, racing line)
export function markerOf(item: any) {
  if (!item || typeof item !== 'object') return item;
  const { course, ...rest } = item;
  return course === undefined ? item : { ...rest, course: null, light: true };
}

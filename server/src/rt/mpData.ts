// The game's data the multiplayer rooms read (Phase 7 Step 2): data/multiplayer.json, and data/npc.json's drivers (an NPC
// filling a grid slot is one of them: their name, car and colour).
import fs from 'node:fs';
import path from 'node:path';
import { REPO_DIR } from '../config.ts';

const json = (f: string) => JSON.parse(fs.readFileSync(path.join(REPO_DIR, f), 'utf8'));
export const MP = json('data/multiplayer.json');
// (Phase 7 Step 4) free roam: zones, instances, privacy, contact, challenges, chat, meets (docs/FREE_ROAM.md)
export const ROAM = json('data/roam.json');
export const NPC_DRIVERS: { id: string; name: string; car: string; colour: string; skill: number }[] = json('data/npc.json').drivers;

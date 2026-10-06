// Display names: the shape (@kr/shared DisplayName), the profanity filter (obscenity: its English dataset and
// recommended transformers — leetspeak, repeated letters, spacing), unique case-insensitively (the database's
// unique index on lower(name)), and generated ones for guests and social sign-ins.

import crypto from 'node:crypto';
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { DisplayName, LIMITS } from '@kr/shared';

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const randomTag = (n = 6) => Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');

// (Phase 6 Step 5) names that pass for the game's own staff or the game itself: not for players, however they're
// written (spaces, dots, digits for letters: "4dm1n", "Mod.Team", "Kugel Sack Support")
const RESERVED = /(admin|administrator|moderator|^mod$|^mods$|^mod[\s._-]|[\s._-]mod$|support|staff|official|kugelsack|ognistrada|system|developer|^dev$|gamemaster|^gm$)/i;
const unLeet = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[0@]/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5\$/g, 's').replace(/7/g, 't');
export function reservedName(name: string): boolean {
  const plain = unLeet(name), squeezed = plain.replace(/[\s._-]+/g, '');
  return RESERVED.test(plain) || /(admin|moderator|support|staff|official|kugelsack|ognistrada|gamemaster)/.test(squeezed);
}

// null: fine; otherwise why not (plain words)
export function nameProblem(name: string): string | null {
  const p = DisplayName.safeParse(name);
  if (!p.success) return p.error.issues[0]?.message ?? 'That name isn\'t allowed.';
  if (matcher.hasMatch(p.data) || matcher.hasMatch(unLeet(p.data))) return 'That name isn\'t allowed.';
  if (reservedName(p.data)) return 'That name is kept for the game\'s own team: pick another.';
  return null;
}
export const guestName = () => `Guest-${randomTag(6)}`;
// a name from a social profile, made to fit (or a racer's name, if it can't be)
export function nameFromProfile(raw: string | null | undefined): string {
  const cleaned = (raw ?? '').normalize('NFKC').replace(/[^\p{L}\p{N}_.\- ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.displayName.max - 5).trim();
  return cleaned.length >= LIMITS.displayName.min && !nameProblem(cleaned) ? cleaned : `Racer-${randomTag(5)}`;
}
export const withTag = (name: string) => `${name.slice(0, LIMITS.displayName.max - 5).trim()}-${randomTag(4)}`;

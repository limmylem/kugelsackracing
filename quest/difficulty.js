// A quest's difficulty, pure: 1–5 stars from what its route asks of a driver (route/stats.js routeFeatures:
// length, corners and how sharp, hairpins, height up and down, the steepest grade, narrow roads,
// junctions, unguarded drops if measured), its rivals (how many, how good) and how tight its gold medal
// is; and the car performance it asks for (the recommended rating, garage/rating.js). The rules are
// data/quests.json difficulty.
//
//   difficultyOf(quest, course, { config, classes, medals }) → { stars, points, parts: [{ what, points }], recommended, recommendedClass }
//   carWarning(difficulty, rating, config) → plain words | null      starsText(n) → '★★★☆☆'

import { routeFeatures } from '../route/stats.js';

const clamp01 = x => Math.max(0, Math.min(1, x));
export const starsText = n => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

// what makes the route hard, from its stats (a route baked before routeFeatures: worked out from its line)
export function featuresOf(course) {
  if (course?.stats?.features) return course.stats.features;
  if (course?.line?.length > 1) return routeFeatures(course.line, { loop: !!course.loop });
  return null;
}

export function difficultyOf(quest, course, { config, classes = null, medals = null } = {}) {
  const D = config.difficulty, P = D.points, F = featuresOf(course), parts = [];
  const add = (what, value, rule) => { if (value == null || !rule) return; const pts = clamp01(value / rule.full) * rule.weight; if (pts > 0.005) parts.push({ what, points: Math.round(pts * 100) / 100 }); };
  const laps = course?.loop ? Math.max(1, quest.params?.laps ?? 1) : 1;
  if (F) {
    add('length', F.km * laps, P.length);
    add('corners', F.cornersPerKm, P.corners);
    add('sharpness', F.sharpnessPerKm, P.sharpness);
    add('hairpins', F.hairpins * laps, P.hairpins);
    add('elevation', F.elevationPerKm ?? F.climbPerKm, P.elevation);
    add('grade', F.maxGrade, P.grade);
    add('narrow', F.narrowShare, P.narrow);
    add('junctions', F.junctionsPerKm, P.junctions);
    add('exposure', course?.stats?.exposure ?? null, P.exposure);
  }
  // the rivals: how many × how good, and the best of them
  const npc = quest.npc ?? {}, count = quest.type === 'pink_slip' ? 1 : (npc.count ?? 0);
  if (count > 0) {
    const [lo, hi] = npc.skill ?? [0.4, 0.8];
    add('rivals', count * (lo + hi) / 2, P.rivals);
    add('rivalSkill', hi, P.rivalSkill);
  }
  // the gold medal against the starter car's estimate (a time quest)
  const est = course?.stats?.estimatedTime ? course.stats.estimatedTime * laps : null;
  if (medals?.kind === 'time' && medals.gold && est && P.medal) {
    const r = medals.gold / est, pts = clamp01((P.medal.from - r) / (P.medal.from - P.medal.to)) * P.medal.weight;
    if (pts > 0.005) parts.push({ what: 'medal times', points: Math.round(pts * 100) / 100 });
  }
  const byType = D.byType?.[quest.type] ?? 0;
  if (byType) parts.push({ what: 'quest type', points: byType });
  if (quest.type === 'delivery' && quest.params?.cargo?.fragile) parts.push({ what: 'fragile cargo', points: 0.3 });
  const points = Math.round(parts.reduce((a, p) => a + p.points, 0) * 100) / 100;
  const stars = 1 + D.stars.filter(t => points >= t).length;
  // the car it asks for: by stars, inside the class the quest lets in (its highest)
  let recommended = D.recommended.byStars[stars - 1], recommendedClass = null;
  const C = classes?.classes ?? classes;
  if (Array.isArray(C)) {
    const order = C.map(c => c.class), allowed = (quest.entry?.classes ?? []).filter(c => order.includes(c));
    if (allowed.length) {
      const top = allowed.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0], i = order.indexOf(top);
      const from = C[i].from, to = C[i + 1]?.from ?? from + 150;
      // (a quest for a class: the band's bottom at 1 star, near its top at 5)
      recommended = Math.round(from + (to - 1 - from) * (0.15 + 0.2 * (stars - 1)));
    }
    recommendedClass = [...C].reverse().find(c => recommended >= c.from)?.class ?? null;
  }
  return { stars, points, parts, recommended, recommendedClass };
}

// The card's warning when the player's car is well under what the quest asks for
export function carWarning(difficulty, rating, config) {
  if (!difficulty || rating == null) return null;
  const below = config.difficulty.recommended.warnBelow ?? 0.85;
  if (rating >= difficulty.recommended * below) return null;
  return `Your car (rating ${Math.round(rating)}) is well below the ${Math.round(difficulty.recommended)} this quest is made for: expect a hard time.`;
}

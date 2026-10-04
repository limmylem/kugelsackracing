// A quest's rating, stored with it (content item `rating`) whenever it's saved or published and again by
// bulk validation: its difficulty (quest/difficulty.js) from its route's stored course, and how long it
// is. Its reward, fee and tier follow from it (content/quests.js rewardsOf). Pure.
//
//   rateQuest(quest, routeItem, { config (data/quests.json), classes }) → rating | null (no route yet)
//   makeRater(ctx) → (item, { route }) → item with its rating (the content service's rate hook)

import { difficultyOf } from '../quest/difficulty.js';
import { medalTargets } from '../quest/rules.js';
import { routeVersionOf } from '../route/model.js';

// (a stored course as the rules read it: loop or not)
const courseOf = route => route?.course ? { ...route.course, loop: route.course.kind === 'loop' } : null;

export function rateQuest(quest, route, { config, classes = null, now = null } = {}) {
  const course = courseOf(route);
  if (!course?.stats) return null;
  const medals = medalTargets(quest, course, config);
  const d = difficultyOf(quest, course, { config, classes, medals });
  const laps = course.loop ? Math.max(1, quest.params?.laps ?? 1) : 1;
  return {
    stars: d.stars, points: d.points, km: Math.round((course.length ?? course.stats.length ?? 0) * laps / 10) / 100,
    recommended: d.recommended, recommendedClass: d.recommendedClass, parts: d.parts, routeVersion: routeVersionOf(course), ...(now ? { at: now } : {}),
  };
}

export function makeRater(ctx) {
  return (item, { route } = {}) => {
    if (item.kind !== 'quest') return item;
    const rating = route ? rateQuest(item, route, ctx) : null;
    return { ...item, rating: rating ?? item.rating ?? null };
  };
}

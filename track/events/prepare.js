// A track event made ready to race (Phase 5 Step 3): its course from the built track (route/model.js
// viewCourse: the gates, grid, corridor and racing line the quest session and the NPCs use) with the
// track's hash and its AI reference times (track/events/reference.js) on it, and the event rated from them
// — its stars (quest/difficulty.js) and km, so its reward and medal targets follow the Phase 4 rules.
//
//   eventCourse(data, R, carClass) → the course (viewCourse + trackHash + aiTimes)
//   rateEvent(event, data, R, { config, classes }) → rating (content/rating.js rateQuest's shape)
//   readyEvent(event, data, R, { config, classes }) → { event (its track's hash and rating filled in), course, hashOk }
//   classKey(event) (quest/rules.js): the class its reference times are for

import { viewCourse } from '../../route/model.js';
import { trackProjection } from '../build.js';
import { trackHash } from './hash.js';
import { aiTimesOf } from './reference.js';
import { rateQuest } from '../../content/rating.js';
import { classKey } from '../../quest/rules.js';
import { trackInfo } from './model.js';

export { classKey };

export function eventCourse(data, R = null, carClass = 'open') {
  const course = viewCourse(data.course, trackProjection);
  course.trackHash = trackHash(data);
  const t = aiTimesOf(R);
  if (t) course.aiTimes = { ...(course.aiTimes ?? {}), [carClass]: t };
  return course;
}

export function rateEvent(event, data, R = null, { config, classes = null } = {}) {
  const t = aiTimesOf(R), stored = { ...data.course, ...(t ? { aiTimes: { [classKey(event)]: t } } : {}) };
  return rateQuest(event, { course: stored }, { config, classes });
}

// The event as it'll be raced here: its track's hash (the event's own, if it has one — an official
// event's, kept when it was published — else this one), its rating, and whether the track made here is the
// event's (a mismatch: results pay nothing)
export function readyEvent(event, data, R = null, { config, classes = null, course = null } = {}) {
  course ??= eventCourse(data, R, classKey(event));
  const info = trackInfo(data), hash = course.trackHash;
  const track = { ...event.track, hash: event.track.hash ?? hash, layout: event.track.layout ?? info.layout, km: event.track.km ?? info.km, corners: event.track.corners ?? info.corners, theme: event.track.theme ?? info.theme, version: event.track.version ?? data.version };
  const rating = rateEvent({ ...event, track }, data, R, { config, classes }) ?? event.rating;
  return { event: { ...event, track, rating }, course, hashOk: track.hash === hash };
}

// A trip from the real world to a generated track and back (Phase 5 Step 3): the spot the car was on is
// kept, the screen fades to the loading screen, the track is made (or loaded from the cache: track/client.js)
// and its AI reference times worked out (or read from theirs: track/events/reference.js), the event made
// ready (its course, hash and rating: track/events/prepare.js) and the car put on its grid; leaving, the
// real world comes back and the car is put down on the very spot it left, facing the same way, still.
// Damage isn't the trip's to carry: it's the player's car's (PlayerService, the game's session), the same
// car in both worlds — what happened on the track is on it back in the real world, and the other way.
// Nothing of the page in here: the game hands it adapters, so the tests run it in Node (tests/track-events.ts).
//
//   const trip = createTrackTrip({ adapters, config (data/quests.json), classes, onState })
//     adapters: {
//       spot() → { world, x, y, z, heading, … }   where the car is now (and in which world)
//       load(code, { onProgress }) → Promise<handle: { data, … }>   the track world made (one kept at a time)
//       reference(handle, carClass, { onProgress }) → Promise<R>   the AI reference times (cached by code)
//       enter(handle, prepared) / back(spot)   go to the track world / to the real world, the car on that spot
//       fade(to: 0–1, seconds) → Promise       the screen (in Node: nothing)
//     }
//   await trip.go(event, { onProgress }) → { ok, error, prepared: { event, course, hashOk }, handle }
//   await trip.leave() → { ok, spot }      trip.state: 'roam' | 'loading' | 'track' | 'leaving'   trip.spot

import { readyEvent, classKey } from '../track/events/prepare.js';

export function createTrackTrip({ adapters: A, config, classes = null, onState = () => {} }) {
  let state = 'roam', spot = null, handle = null, prepared = null;
  const set = s => { state = s; onState(s); };

  return {
    get state() { return state; },
    get spot() { return spot; },
    get handle() { return handle; },
    get prepared() { return prepared; },
    async go(event, { onProgress = () => {} } = {}) {
      if (state === 'loading' || state === 'leaving') return { ok: false, error: 'Already on the way.' };
      if (!event?.track?.code) return { ok: false, error: 'That event has no track.' };
      // (already on a track: straight from it to the next one — the real world's spot is still the one it left)
      if (state === 'roam') spot = A.spot();
      set('loading');
      try {
        await A.fade?.(1, null);
        onProgress('track', 0);
        handle = await A.load(event.track.code, { onProgress: (step, share) => onProgress('track', share, step) });
        const cls = classKey(event);
        onProgress('reference', 0);
        const R = await A.reference(handle, cls, { onProgress: share => onProgress('reference', share) });
        prepared = readyEvent(event, handle.data, R, { config, classes });
        await A.enter(handle, prepared);
        set('track');
        await A.fade?.(0, null);
        return { ok: true, prepared, handle, reference: R };
      } catch (e) {
        // (it couldn't be made: back where it was)
        set('roam');
        if (spot) await A.back(spot);
        await A.fade?.(0, null);
        return { ok: false, error: e.message ?? String(e) };
      }
    },
    async leave() {
      if (state !== 'track' || !spot) return { ok: false, error: 'Not on a track.' };
      set('leaving');
      await A.fade?.(1, null);
      await A.back(spot);
      const at = spot;
      spot = null; prepared = null;
      set('roam');
      await A.fade?.(0, null);
      return { ok: true, spot: at };
    },
  };
}

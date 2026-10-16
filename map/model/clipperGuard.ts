// Clipper2-js (1.2.4, the latest) can loop for good. It's a port of C#, where a point is a value; here points are
// shared objects, and its sweep can leave a run of edges all at one height that closes on itself — a ring of no area.
// ClipperBase.getCurrYMaximaVertex then walks round that ring forever: a whole-region bake stopped on a verge at
// -34.8616, 138.6228 and a footpath at -34.9332, 138.5388. Guarded here: a walk that comes back to where it began throws, which Clipper's own
// execute() catches — its result then empty — and counts it in clipperLoops, so an operation can tell it failed and
// try again (map/model/crossSection.ts: on its input snapped to a few mm). Imported for its effect: once per process.
import * as Clipper from 'clipper2-js';

export const clipperLoops = { count: 0 };
const B: any = Clipper.ClipperBase, VF: any = Clipper.VertexFlags;
const walk = (open: boolean) => (ae: any) => {
  let result = ae.vertexTop;
  const start = result, more = (v: any) => !open || (v.flags & (VF.OpenEnd | VF.LocalMax)) === VF.None;
  const round = () => { clipperLoops.count++; throw new Error('Clipper2-js: a ring of edges all at one height'); };
  if (ae.windDx > 0) { while (result.next.pt.y === result.pt.y && more(result)) { result = result.next; if (result === start) round(); } }
  else { while (result.prev.pt.y === result.pt.y && more(result)) { result = result.prev; if (result === start) round(); } }
  return B.isMaxima(result) ? result : undefined;
};
if (!B.__guarded) {
  B.getCurrYMaximaVertex = walk(false);
  B.getCurrYMaximaVertex_Open = walk(true);
  B.__guarded = true;
}

// an operation that must not lose its result to a loop: run again on its input snapped to each grid in turn (mm, as
// Clipper's integer points are), until one runs through; null if every one loops
export function unlooped<T>(run: (snap: number) => T, snaps = [0, 4, 16]): { result: T | null; snap: number } {
  for (const snap of snaps) {
    const n = clipperLoops.count, result = run(snap);
    if (clipperLoops.count === n) return { result, snap };
  }
  return { result: null, snap: -1 };
}

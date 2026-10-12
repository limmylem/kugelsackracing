// The last steps a model goes through before it's written into the game (Phase 8 Step 3; docs/CONTENT_PIPELINE.md),
// after it's checked and fixed: its levels of detail made (tools/content/lods.mjs: a model of at least lods.from
// triangles), its big textures compressed (tools/content/ktx2.mjs) — and, for a part that can come off in a crash,
// what the physics and the damage need from it (partDamage): its collision hulls and how it hangs when it's loose.
//
//   const did = await finishModel(doc, { rules })                         → ['made LOD1: 544 triangles (35%)', …]
//   const { detach, collision } = await partDamage(info, type, rules, existingDetach)

import { makeLods } from './lods.mjs';
import { compressTextures } from './ktx2.mjs';
import { collisionHulls } from './collision.mjs';
import { inspect } from './inspect.mjs';

export async function finishModel(doc, { rules, lods = true, ktx2 = true }) {
  const did = [], info = inspect(doc);
  if (lods && rules.lods && info.triangleCount >= rules.lods.from) {
    const r = await makeLods(doc, rules.lods);
    for (const L of r.levels) did.push(`${L.own ? 'kept its own' : 'made'} LOD${L.level}: ${L.triangles.toLocaleString('en-GB')} triangles (${Math.round(L.triangles / Math.max(1, r.base) * 100)}% of ${r.base.toLocaleString('en-GB')})`);
  }
  if (ktx2 && rules.ktx2) did.push(...await compressTextures(doc, rules.ktx2));
  return did;
}

// A part that comes off in a crash (its type's template has detach): its detach block — the template's, with its
// mounts worked out from the model ('ends': the two ends of its longest side, a tenth in from each, where a hanging
// part's fixings are) unless it has its own — and its collision hulls. Anything else: {}
export async function partDamage(info, type, rules, own = null) {
  const tpl = rules.types[type]?.template?.detach;
  if (!tpl || !info.triangleCount) return {};
  const detach = own ? { ...own } : structuredClone(tpl);
  if (detach.mounts === 'ends') detach.mounts = endsOf(info);
  const collision = rules.collision ? await collisionHulls(info.triangles, rules.collision) : null;
  return { detach, collision };
}
function endsOf(info) {
  const { min, max } = info.bounds, size = max.map((v, k) => v - min[k]);
  const ax = size[0] >= size[2] ? 0 : 2, mid = (min[ax] + max[ax]) / 2, half = size[ax] / 2 * 0.9;
  return [mid + half, mid - half].map(v => { const p = [0, 0, 0]; p[ax] = +v.toFixed(3) + 0; return p; });
}

// Map v4's road surface model (MAP_README.md, "The road surface model"): the one authoritative description of every
// road, built at bake time, from which everything else is made — the drawn road surface and markings, the ground
// shaped under it, the road colliders, the exclusion mask (trees, props), the street lamps, the railings and the
// navigation graph. Nothing else works roads out again.
//
//   graph.ts      OSM's drivable ways → the planar graph (nodes at junctions, ends, layer changes, tile borders)
//   widths.ts     each road's drivable and visual width, side by side roads kept apart (medians kept)
//   topology.ts   joints, junctions, trims, clusters, each cluster's patch outline
//   heights.ts    heights solved on the graph: profiles, junction planes, chains, bridges, grades
//   surface.ts    the mesh: ribbons and patches sharing their vertices, kerbs, skirts, decks, markings
//
//   const R = buildRoadModel({ roads: osm.roads, points: osm.points, demAt, cfg (data/map/v4.json), v3roads, tileSize, P, style })
//   R.nodes, R.segs, R.clusters, R.surface { mesh, marks, edges, classes }, R.stats, R.version

import type { Way } from '../bake/osmData.ts';
import type { Projection } from '../format/projection.ts';
import { buildGraph } from './graph.ts';
import { assignWidths } from './widths.ts';
import { buildTopology, unionStats } from './topology.ts';
import { solveHeights } from './heights.ts';
import { buildSurface } from './surface.ts';

export function buildRoadModel({ roads, points = [], demAt, cfg, v3roads, tileSize, P, style = 'AU', log = (_: string) => {} }: { roads: Way[]; points?: any[]; demAt: (x: number, z: number) => number; cfg: any; v3roads: any; tileSize: number; P: Projection; style?: string; log?: (s: string) => void }) {
  const t0 = performance.now(), lap = (s: string) => log(`    ${s} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  const G = buildGraph(roads, { cfg, v3roads, tileSize });
  // (border nodes: their lat/lon from the projection)
  for (const n of G.nodes) if (!Number.isFinite(n.lat)) { const [la, lo] = P.toLatLon(n.x, n.z); n.lat = la; n.lon = lo; }
  lap(`graph: ${G.nodes.length} nodes, ${G.segs.length} segments (${G.joins.merged} merged, ${G.joins.joined} loose ends joined)`);
  assignWidths(G, cfg);
  lap(`widths: ${G.segs.filter(g => g.adjusted).length} segments narrowed beside another road`);
  const T = buildTopology(G, cfg);
  lap(`junctions: ${T.stats.junctions} (${T.stats.clusters} patches, ${T.stats.merged} merged into clusters), ${T.stats.joints} joints, ${T.stats.ends} ends; ${T.stats.clamped} trims clamped, ${T.stats.unresolvedCorners} open corners, ${T.stats.unionFailures} union failures, ${unionStats.skipped} pieces a union couldn't take`);
  const Hs = solveHeights(G, T, demAt, cfg);
  lap(`heights: ${Hs.stats.chains} chains, ${Hs.stats.lifted} bridges lifted, ${Hs.stats.gradeLimited} grade-limited, junction planes moved ${Hs.stats.planesMoved} times to meet their neighbours`);
  // (OSM's crossings, stops and give ways, by node id: markings where they're mapped)
  const crossings = new Map<number, string>();
  for (const p of points) { const h = p.tags?.highway; if (h === 'crossing' || h === 'stop' || h === 'give_way') crossings.set(p.id, h); else if (p.tags?.crossing && p.tags.crossing !== 'no') crossings.set(p.id, 'crossing'); }
  const surface = buildSurface(G, T, cfg, { style, crossings });
  lap(`surface: ${(surface.mesh.indices.length / 3 / 1e3).toFixed(0)}k triangles (${surface.stats.ribbons} ribbons, ${surface.stats.patches} patches), ${(surface.marks.indices.length / 3 / 1e3).toFixed(0)}k marking triangles, ${surface.stats.folds} edge points unfolded, ${surface.stats.tJunctions} T-junctions closed, ${surface.stats.patchHoles} patches not covered`);
  return { nodes: G.nodes, segs: G.segs, clusters: T.clusters, chains: Hs.chains, surface, stats: { graph: { nodes: G.nodes.length, segs: G.segs.length, joins: G.joins }, topology: T.stats, heights: Hs.stats, surface: surface.stats }, version: cfg.model };
}

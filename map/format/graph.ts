// Map v3's road graph (graph.json.gz in a region's folder): the drivable network as nodes and segments,
// for navigation, route drawing and traffic later — from the same baked roads the tiles' surfaces are.
//
//   nodes: { osm: [OSM node id], lat, lon, x, z, h }   (parallel arrays; x east, z south, h m EGM2008)
//   segs: [{ id, from, to, way (OSM way id), name, class, rank, link, lanes, lanesEstimated, oneway
//            (1 along, −1 against, 0 both), maxspeed (km/h | null), width, widthEstimated, structure
//            ('ground' | 'bridge' | 'tunnel'), layer, surface,
//            points: [x, z, h, …] the centreline (every OSM node of it, and the curve points between),
//            osm: [[point index, OSM node id, lat, lon], …] which points are OSM's own nodes }]
// A segment runs from node `from` to node `to`; its points run the same way.

export interface GraphSeg {
  id: number; from: number; to: number; way: number; name: string | null; class: string; rank: number; link: boolean;
  lanes: number; lanesEstimated: boolean; oneway: number; maxspeed: number | null; width: number; widthEstimated: boolean;
  structure: 'ground' | 'bridge' | 'tunnel'; layer: number; surface: string; points: number[]; osm: [number, number, number, number][];
}
export interface Graph { version: number; region: string; nodes: { osm: number[]; lat: number[]; lon: number[]; x: number[]; z: number[]; h: number[] }; segs: GraphSeg[] }

export const GRAPH_VERSION = 1;
const r2 = (v: number) => Math.round(v * 100) / 100;

export function encodeGraph(region: string, nodes: any[], segs: any[]): Graph {
  return {
    version: GRAPH_VERSION, region,
    nodes: { osm: nodes.map(n => n.id), lat: nodes.map(n => n.lat), lon: nodes.map(n => n.lon), x: nodes.map(n => r2(n.x)), z: nodes.map(n => r2(n.z)), h: nodes.map(n => r2(n.h)) },
    segs: segs.map(g => ({
      id: g.id, from: g.from, to: g.to, way: g.osmWay, name: g.name, class: g.cls, rank: g.rank, link: g.link, lanes: g.lanes, lanesEstimated: g.lanesEstimated, oneway: g.oneway,
      maxspeed: g.maxspeed, width: r2(g.width), widthEstimated: g.widthEstimated, structure: g.structure, layer: g.layer, surface: g.surface,
      points: g.xs.flatMap((x, k) => [r2(x), r2(g.zs[k]), r2(g.h[k])]),
      osm: g.orig.map((o, k) => (o ? [k, g.osmNodes[k], g.lat[k], g.lon[k]] : null)).filter(Boolean),
    })),
  };
}

// the nearest segment to a point (x, z), within `reach` m: { seg, distance, at (point index) } | null
export function nearestSeg(G: Graph, x: number, z: number, reach = 30) {
  let best = null;
  for (const s of G.segs) {
    const P = s.points;
    for (let k = 0; k + 5 < P.length; k += 3) {
      const ax = P[k], az = P[k + 1], dx = P[k + 3] - ax, dz = P[k + 4] - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < reach && (!best || d < best.distance)) best = { seg: s, distance: d, at: k / 3 };
    }
  }
  return best;
}

// The light at a time of day, for the test worlds (their sun, sky and fog) and for the effects (smoke
// is lit by it, sparks and flames glow brighter at night). lightAt(hours) is a simple day: the sun
// rises in the east (+x) at 6:00, is highest (62°) at noon a little to the south (+z), sets in the west
// at 18:00; below the horizon the moon lights the scene, dimly and blue. lightFromSun(direction) is the
// same from a real sun direction (the real world: Cesium's sun), so both worlds light effects alike.
//
// { key: { dir (toward the light, unit), colour [r, g, b], intensity } — the sun, or the moon at night,
//   ambient: { sky, ground [r, g, b], intensity } — the hemisphere light, background [r, g, b] (the sky),
//   fog [r, g, b], night 0 (day) … 1 (dark), elevation (the sun's, degrees) }

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const DEG = Math.PI / 180;

const DAY_SKY = [0.612, 0.788, 0.941], DUSK_SKY = [0.91, 0.62, 0.45], NIGHT_SKY = [0.035, 0.06, 0.12];
const NOON = [1, 0.97, 0.92], LOW_SUN = [1, 0.6, 0.3], MOON = [0.56, 0.66, 0.85];

export function lightAt(hours) {
  const a = ((hours - 6) / 12) * Math.PI, el = Math.sin(a) * 62;
  const c = Math.cos(el * DEG);
  const dir = norm([Math.cos(a) * c, Math.sin(el * DEG), 0.35 * c]);
  return lightFromSun(dir, el);
}

// dir: toward the sun in a frame with y up (unit); elevation in degrees (from dir if not given)
export function lightFromSun(dir, elevation = Math.asin(clamp(dir[1], -1, 1)) / DEG) {
  const el = elevation, day = smoothstep(-4, 10, el), night = 1 - smoothstep(-8, 3, el), dusk = smoothstep(-6, 2, el) * (1 - smoothstep(4, 18, el));
  const sunColour = mix(LOW_SUN, NOON, smoothstep(4, 30, el));
  // (at night the moon: high up, opposite the sun's path)
  const key = day > 0.02 || night < 0.5
    ? { dir: norm(dir[1] > 0.02 ? dir : [dir[0], 0.02, dir[2]]), colour: sunColour, intensity: 1.8 * day }
    : { dir: norm([-dir[0] * 0.4, 0.8, -dir[2] * 0.4 + 0.3]), colour: MOON, intensity: 0.28 * night };
  const sky = mix(mix(NIGHT_SKY, DAY_SKY, day), DUSK_SKY, dusk * 0.7);
  return {
    key,
    ambient: { sky: mix([0.45, 0.55, 0.8], [1, 1, 1], day), ground: mix([0.12, 0.13, 0.16], [0.33, 0.4, 0.33], day), intensity: 0.18 + 0.92 * day },
    background: sky, fog: sky, night, elevation: el,
  };
}

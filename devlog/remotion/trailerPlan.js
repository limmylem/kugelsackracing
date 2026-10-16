// The trailer's timeline (remotion/Trailer.jsx; devlog/trailer/make.mjs): the clips one after another in their order,
// the title over the start of the first, a caption over some of them, the end card after the last — and how hard the
// music drives at each moment (intensityAt: the music's own scale, 0..1, audio/music.js), so the music is rendered to
// the same plan as the pictures.
//
//   trailerPlan({ clips: [{ name, src, seconds, sound, label }], fps }) → { frames, seconds, cuts, captions, title, end, intensityAt(t) }

export const TITLE_SECONDS = 3.5, END_SECONDS = 5.5;
// what's said, and over which shot (by its name in trailer/shots.json)
export const CAPTIONS = {
  adelaide: 'Real cities. Real roads.',
  sf: 'Built from open map data',
  monaco: 'Drive them all in your browser',
  stelvio: 'Seven regions, and counting',
  'track-rival': 'Race your friends online',
  'track-side': 'Race on endless new tracks',
  'track-cockpit': 'Build it. Tune it. Learn to drive it.',
};

export function trailerPlan({ clips = [], fps = 30 }) {
  const cuts = [], captions = [];
  let at = 0;
  for (const c of clips) {
    const n = Math.round(c.seconds * fps);
    if (n < fps / 2) continue;
    cuts.push({ from: at, to: at + n, src: c.src, sound: !!c.sound, trimBefore: 0, name: c.name, place: c.label ?? null, kind: c.name.startsWith('track') ? 'track' : 'region' });
    const say = CAPTIONS[c.name];
    // (not over the title)
    if (say && at >= Math.round(TITLE_SECONDS * fps) - 1) captions.push({ from: at + 6, to: at + n - 2, text: say });
    at += n;
  }
  const title = { from: 0, to: Math.round(TITLE_SECONDS * fps) };
  // (with no clips: the title, then the end card)
  if (!cuts.length) at = title.to;
  const end = { from: at, to: at + Math.round(END_SECONDS * fps) };
  const frames = end.to;
  // the music: calm under the title, building through the cities, flat out on the tracks, settling under the end card
  const firstTrack = cuts.find(c => c.kind === 'track')?.from ?? end.from;
  const intensityAt = t => {
    const f = t * fps;
    if (f < title.to) return 0.3;
    if (f < firstTrack) return 0.45 + 0.25 * (f - title.to) / Math.max(1, firstTrack - title.to);
    if (f < end.from) return 0.85 + 0.15 * (f - firstTrack) / Math.max(1, end.from - firstTrack);
    return 0.55;
  };
  return { frames, seconds: frames / fps, cuts, captions, title, end, intensityAt };
}

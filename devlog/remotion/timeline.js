// The video's plan (DEVLOG.md): from the script and the clips, when each caption shows and which piece of which clip
// is on screen. Pure — the render (render.mjs), the composition (Devlog.jsx) and the tests use the same one.
//
//   plan({ script, clips, fps }) → { fps, frames, hook: {from, to}, captions: [{text, from, to}], end: {from, to},
//                                    cuts: [{clip, src, trimBefore, from, to}], warnings }
//   script: { hook, captions: [text], end }   clips: [{ src, seconds }]   (frames: from inclusive, to exclusive)

export const LIMITS = { min: 20, max: 45 };              // the video's length (s)
export const HOOK_SECONDS = 2, END_SECONDS = 3;
export const CAPTION = { min: 1.8, max: 4.5, perWord: 0.32, base: 1.2 };  // a caption's time: read at a comfortable pace
export const CUT = { min: 1.4, max: 2.4 };                // a cut every 1.4–2.4 s: quick, not frantic

const words = s => String(s).trim().split(/\s+/).filter(Boolean).length;
export const readingSeconds = text => Math.min(CAPTION.max, Math.max(CAPTION.min, CAPTION.base + words(text) * CAPTION.perWord));

// a steady sequence of numbers from a seed (the same script always cuts the same way)
function random(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

export function plan({ script, clips, fps = 30 }) {
  const warnings = [];
  let captions = (script.captions ?? []).map(t => String(t).trim()).filter(Boolean);
  let secs = captions.map(readingSeconds);
  const fixed = HOOK_SECONDS + END_SECONDS, room = LIMITS.max - fixed;
  // too long: the captions shown quicker, down to their minimum — then the last ones left out
  let sum = secs.reduce((a, b) => a + b, 0);
  if (sum > room) {
    const k = room / sum;
    secs = secs.map(s => Math.max(CAPTION.min, s * k));
    while (secs.reduce((a, b) => a + b, 0) > room + 1e-9) {
      warnings.push(`"${captions.at(-1)}" left out: the video would be over ${LIMITS.max} s (fewer or shorter captions keep it in)`);
      captions = captions.slice(0, -1); secs = secs.slice(0, -1);
    }
  }
  // too short: each caption held longer (and with no captions at all, the gameplay alone)
  sum = secs.reduce((a, b) => a + b, 0);
  const atLeast = LIMITS.min - fixed;
  let gap = 0;
  if (sum < atLeast) {
    if (sum > 0) secs = secs.map(s => s * atLeast / sum);
    else gap = atLeast;
  }
  const f = s => Math.round(s * fps);
  const hook = { from: 0, to: f(HOOK_SECONDS) };
  let at = hook.to;
  const capFrames = captions.map((text, i) => { const c = { text, from: at, to: at + f(secs[i]) }; at = c.to; return c; });
  at += f(gap);
  const end = { from: at, to: at + f(END_SECONDS) };
  const frames = end.to;

  // the cuts: through the clips in turn, each piece a little further into its clip than the last, so nothing repeats
  // until a clip's used up (then it starts again from the top)
  const cuts = [];
  const usable = (clips ?? []).filter(c => c && c.src && c.seconds > 0.5);
  if (!usable.length) warnings.push('No clips: the video is the captions on a plain background');
  const rnd = random(`${script.hook}|${captions.join('|')}`);
  const pos = usable.map(() => 0);
  let t = 0, k = 0;
  while (usable.length && t < frames) {
    const want = f(CUT.min + rnd() * (CUT.max - CUT.min));
    // (a cut on the hook's end: the title card gives way to a fresh shot)
    let len = t < hook.to ? hook.to - t : Math.min(want, frames - t);
    if (frames - (t + len) < f(CUT.min) * 0.6) len = frames - t;      // (no sliver of a cut at the very end)
    const i = k % usable.length, clip = usable[i], clipFrames = Math.floor(clip.seconds * fps);
    let take = Math.min(len, clipFrames);
    if (pos[i] + take > clipFrames) pos[i] = 0;
    cuts.push({ clip: i, src: clip.src, trimBefore: pos[i], from: t, to: t + take });
    pos[i] += take;
    t += take; k++;
  }
  return { fps, frames, hook, captions: capFrames, end, cuts, warnings };
}

// The script as text (DEVLOG.md, script/draft.mjs): "HOOK: …", then a caption a line, "END: …"; lines starting with #
// are notes. One line with " | " between the parts works too (the workflow's input box): the first part is the hook.
export function parseScript(text) {
  const out = { hook: '', captions: [], end: '' };
  let lines = String(text ?? '').replace(/\r/g, '').split('\n');
  if (lines.filter(l => l.trim() && !l.trim().startsWith('#')).length === 1 && lines.join('').includes('|')) {
    lines = lines.join('').split('|').map((l, i) => (i === 0 && !/^\s*(hook|end)\s*:/i.test(l) ? `HOOK: ${l}` : l));
  }
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const m = l.match(/^(hook|end|caption)\s*:\s*(.*)$/i);
    if (m && m[1].toLowerCase() === 'hook') out.hook = m[2].trim();
    else if (m && m[1].toLowerCase() === 'end') out.end = m[2].trim();
    else out.captions.push((m ? m[2] : l).replace(/^[-*•]\s*/, '').trim());
  }
  out.captions = out.captions.filter(Boolean);
  if (!out.hook && out.captions.length) out.hook = out.captions.shift();
  return out;
}

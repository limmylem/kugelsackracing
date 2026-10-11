// The game's typeface for the video — Barlow Condensed (SIL Open Font License), from npm (@fontsource), copied into
// Remotion's public folder (out/fonts): the render needs nothing from the internet for it.
//   node lib/fonts.mjs   (npm run studio does it first)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const FONT_FILES = ['700', '800'].map(w => `barlow-condensed-latin-${w}-normal.woff2`);

export function copyFonts(outDir) {
  const from = path.join(path.dirname(createRequire(import.meta.url).resolve('@fontsource/barlow-condensed/package.json')), 'files');
  fs.mkdirSync(path.join(outDir, 'fonts'), { recursive: true });
  for (const f of FONT_FILES) fs.copyFileSync(path.join(from, f), path.join(outDir, 'fonts', f));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) copyFonts(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out'));

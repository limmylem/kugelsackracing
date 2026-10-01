// The preview sheet: every generated part's icon in a grid, a row of headings per generator, each with
// its id, name and triangles, so they can all be looked over at once (docs/generated_parts.png).

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../../content/rules.mjs';

const TILE = 190, ICON = 150, COLS = 8, HEAD = 34, PAD = 16;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function previewSheet(project, file = 'docs/generated_parts.png') {
  const parts = Object.values(project.db.parts).filter(p => p.madeBy && !p.retired && p.icon && fs.existsSync(path.join(ROOT, p.icon)));
  const items = parts.sort((a, b) => a.madeBy.generator.localeCompare(b.madeBy.generator) || a.id.localeCompare(b.id)).map(p => {
    const cars = Object.keys(p.byCar ?? {}).length;
    return { id: p.id, group: path.basename(p.madeBy.generator, '.js'), icon: path.join(ROOT, p.icon), note: `${p.todo?.length ? 'NEW · price to do' : p.tier ?? ''}${cars ? ` · ${cars + 1} cars` : ''}`, warn: !!p.todo?.length };
  });
  await sheetOf(items, path.join(ROOT, file), `Generated parts — ${items.length} (npm run generate-parts)`);
  return { file, count: items.length };
}

// A sheet of icons: items [{ id, group, icon (a PNG file), note, warn }] → file
export async function sheetOf(list, file, title) {
  const groups = new Map();
  for (const p of list) { if (!groups.has(p.group)) groups.set(p.group, []); groups.get(p.group).push(p); }
  // the layout: per group a heading, then its tiles
  const items = [], texts = [];
  let y = PAD + 40;
  texts.push(`<text x="${PAD}" y="${PAD + 22}" font-size="24" font-weight="700" fill="#e8edf2">${esc(title)}</text>`);
  for (const [g, list] of groups) {
    texts.push(`<text x="${PAD}" y="${y + 24}" font-size="19" font-weight="700" fill="#7fc4ff">${esc(g)} · ${list.length}</text>`);
    y += HEAD;
    list.forEach((p, i) => {
      const x = PAD + (i % COLS) * TILE, ty = y + Math.floor(i / COLS) * TILE;
      items.push({ p, x, y: ty });
      texts.push(`<rect x="${x + 2}" y="${ty + 2}" width="${TILE - 4}" height="${TILE - 4}" rx="8" fill="#20262c"/>`);
      texts.push(`<text x="${x + TILE / 2}" y="${ty + ICON + 16}" font-size="11.5" font-weight="700" text-anchor="middle" fill="#e8edf2">${esc(p.id.length > 28 ? p.id.slice(0, 27) + '…' : p.id)}</text>`);
      texts.push(`<text x="${x + TILE / 2}" y="${ty + ICON + 31}" font-size="10.5" text-anchor="middle" fill="${p.warn ? '#ffc35a' : '#9aa6b2'}">${esc(p.note ?? '')}</text>`);
    });
    y += Math.ceil(list.length / COLS) * TILE + 10;
  }
  const W = PAD * 2 + COLS * TILE, H = y + PAD;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#14181c"/><g font-family="DejaVu Sans, Arial, sans-serif">${texts.join('')}</g></svg>`;
  const icons = await Promise.all(items.map(async ({ p, x, y }) => ({ input: await sharp(p.icon).resize(ICON, ICON).png().toBuffer(), left: Math.round(x + (TILE - ICON) / 2), top: y + 6 })));
  await sharp(Buffer.from(svg)).composite(icons).png({ compressionLevel: 9, palette: true }).toFile(file);
}

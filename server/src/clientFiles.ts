import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What of the repository is the game (served to browsers, and what the site build copies — tools/build-site.mjs):
// nothing else — not the server, tests, tools or docs.
export const CLIENT_DIRS = ['ai', 'assets', 'site', 'content', 'data', 'dev', 'editor', 'effects', 'garage', 'map', 'physics', 'play', 'quest', 'race', 'realworld', 'route', 'scenes', 'testtrack', 'track', 'ui', 'world', 'admin', 'account', 'net'];
export const CLIENT_FILES = ['index.html', 'lowpoly.html', 'roadster.glb', 'favicon.ico'];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The hashes of every inline <script> in the game's pages (the import maps, the small start-up scripts): the content
// security policy allows exactly these. tools/build-site.mjs does the same for the static site.
let scriptHashes: string[] | null = null;
export function inlineScriptHashes(root = ROOT): string[] {
  if (scriptHashes && root === ROOT) return scriptHashes;
  const pages: string[] = [...CLIENT_FILES.filter(f => f.endsWith('.html'))];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(rel); }
      else if (e.name.endsWith('.html')) pages.push(rel);
    }
  };
  for (const d of CLIENT_DIRS) if (d !== 'assets' && fs.existsSync(path.join(root, d))) walk(d);
  const out = new Set<string>();
  for (const f of pages) {
    const html = fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : '';
    for (const m of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) if (m[1].length) out.add(`'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
  const list = [...out].sort();
  if (root === ROOT) scriptHashes = list;
  return list;
}

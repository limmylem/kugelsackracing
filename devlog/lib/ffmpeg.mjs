// ffmpeg for the capture (frames → MP4) and the checks: the system's if there is one, else the one that comes with
// Remotion (node_modules/@remotion/compositor-*: no extra install needed)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

let found;
function locate(tool) {
  try { execFileSync(tool, ['-version'], { stdio: 'ignore' }); return { bin: tool, env: process.env }; } catch {}
  const require = createRequire(import.meta.url);
  for (const pkg of ['@remotion/compositor-linux-x64-gnu', '@remotion/compositor-linux-x64-musl', '@remotion/compositor-darwin-arm64', '@remotion/compositor-darwin-x64', '@remotion/compositor-linux-arm64-gnu', '@remotion/compositor-win32-x64-msvc']) {
    let dir;
    try { dir = path.dirname(require.resolve(`${pkg}/package.json`)); } catch { continue; }
    const bin = path.join(dir, process.platform === 'win32' ? `${tool}.exe` : tool);
    if (fs.existsSync(bin)) return { bin, env: { ...process.env, LD_LIBRARY_PATH: [dir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'), DYLD_LIBRARY_PATH: dir } };
  }
  throw new Error(`No ${tool}: install it (or run npm ci in devlog/, which brings Remotion's)`);
}
// [command, args, { env }] for child_process.spawn / execFileSync
export function ffmpegCommand(args, tool = 'ffmpeg') {
  found ??= {};
  found[tool] ??= locate(tool);
  return [found[tool].bin, args, { env: found[tool].env }];
}

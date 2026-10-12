// The Blender add-on (Phase 8 Step 3; tools/blender/ognistrada_tools, docs/CONTENT_PIPELINE.md): its copy of the model
// rules up to date with the game's; and, where Blender is here (BLENDER_PYTHON: a Python with bpy, or BLENDER: the
// blender program), the add-on run headless — models made in code, checked as the add-on checks them, with its plain
// words ("LOD1 has 3× too many triangles", "Front bumper missing socket …") — and what it exports passing the game's
// own import checks, its own LOD1 kept by the importer's finishing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addonRules } from '../../tools/blender/build.mjs';
import { readModel, modelIO } from '../../tools/content/io.mjs';
import { inspect } from '../../tools/content/inspect.mjs';
import { checkModel } from '../../tools/content/check.mjs';
import { loadRules } from '../../tools/content/rules.mjs';
import { finishModel } from '../../tools/content/finish.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the add-on\'s copy of the model rules is up to date (npm run guide)', () => {
  assert.equal(fs.readFileSync(path.join(root, 'tools/blender/ognistrada_tools/model_rules.json'), 'utf8'), addonRules(root), 'run npm run guide');
});

// (Blender, if it's here)
function runBlender(out) {
  const script = path.join(root, 'tests/blender/addon_test.py'), args = [path.join(root, 'tools/blender'), out];
  const py = process.env.BLENDER_PYTHON, app = process.env.BLENDER;
  const r = py ? spawnSync(py, [script, ...args], { encoding: 'utf8', timeout: 300000 })
    : app ? spawnSync(app, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', ...args], { encoding: 'utf8', timeout: 300000 }) : null;
  if (!r) return null;
  const line = r.stdout.split('\n').find(l => l.startsWith('RESULT '));
  assert.ok(line, `the add-on's test didn't finish: ${(r.stderr || r.stdout).slice(-1500)}`);
  return JSON.parse(line.slice(7));
}

test('the add-on, headless: its checks in plain words, and what it exports passes the game\'s import', { skip: !process.env.BLENDER_PYTHON && !process.env.BLENDER ? 'no Blender here (BLENDER_PYTHON or BLENDER)' : false }, async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ogn-blender-')), R = runBlender(out);
  try {
    assert.equal(R.good.verdict, 'pass', JSON.stringify(R.good));
    assert.match(R.centimetres.fails[0], /100× too big, so it was probably made in centimetres/);
    assert.equal(R.refused, true, 'a model that fails isn\'t exported');
    assert.match(R.origin.fails[0], /its bottom is 1\.00 m above the origin/);
    assert.equal(R.placed.verdict, 'pass', 'Place at origin puts it right');
    assert.match(R.lod_heavy.fails.join(' '), /LOD1 has 3× too many triangles/);
    assert.notEqual(R.lod_ok.verdict, 'fail');
    assert.match(R.material.fails[0], /"Material\.001" isn't a name the game knows/);
    assert.deepEqual(R.car_one_missing.fails, ['Front bumper missing socket "socket_bumper_front": a new car needs it.']);
    assert.ok(R.car_typo.fails.some(f => /"socket_spoilr" .* probably socket_spoiler/.test(f)));
    // what it exported: the game's own checks
    const rules = loadRules(root);
    const good = inspect(await readModel(R.exported));
    assert.equal(checkModel(good, { rules, type: 'spoiler', file: 'spoiler_addon_test.glb' }).verdict, 'pass');
    const doc = await readModel(R.exported_lod), info = inspect(doc);
    assert.equal(info.lods.length, 1); assert.equal(info.lods[0].own, true, 'its own LOD1, as it was named');
    assert.notEqual(checkModel(info, { rules, type: 'spoiler', file: 'spoiler_addon_lod.glb' }).verdict, 'fail');
    // finished as the importer finishes it: its own LOD1 kept (moved to the lods scene), not made again
    const did = await finishModel(doc, { rules });
    assert.ok(did.some(d => /kept its own LOD1/.test(d)), did.join('; '));
    const back = await (await modelIO()).readBinary(await (await modelIO()).writeBinary(doc));
    const lods = back.getRoot().listScenes().find(s => s.getName() === 'lods');
    assert.ok(lods && lods.listChildren().every(n => n.getExtras().lodOf === 'wing' && n.getExtras().lod === 1));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

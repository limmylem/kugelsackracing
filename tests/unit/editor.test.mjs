// The world editor's parts that run without a screen (Phase 4 Step 1): snapping to the road graph of the
// baked San Francisco (editor/roads.js), who may open the editor (editor/access.js), and the 3D markers
// (editor/markers3d.js: the nearest drawn, faded by distance, picked, labels made and disposed).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { createRoadFinder } from '../../editor/roads.js';
import { editorAccess, setEditorFlag } from '../../editor/access.js';
import { createMarkers3d } from '../../editor/markers3d.js';
import { newItem } from '../../content/quests.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const fileFetch = async u => { const p = u.replace(/^file:\/\//, ''), b = fs.readFileSync(p.startsWith('/') ? p : path.join(ROOT, p)); return { ok: true, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
const roads = createRoadFinder({ regions: [{ manifestUrl: path.join(ROOT, 'assets/map/sf/manifest.json') }], tiles: false, fetch: fileFetch });

test('snapping: onto the nearest road of the baked graph, facing along it, its height and nearest intersection', async () => {
  // a click 5 m off Spear Street, at the Embarcadero
  const s = await roads.snap(37.7936, -122.3955, { heading: 10 });
  assert.equal(s.road.name, 'Spear Street');
  assert.equal(s.road.source, 'graph');
  assert.ok(s.distanceM < 10, `${s.distanceM} m`);
  assert.equal(s.altFrom, 'road'); assert.ok(s.alt > 0 && s.alt < 10, `${s.alt} m`);
  assert.match(s.road.intersection.name, /Spear Street & .*Market Street|Market Street.*Spear Street/);
  // facing along the road: the way nearest the heading asked for, or the other way round
  const back = await roads.snap(37.7936, -122.3955, { heading: (s.heading + 180) % 360 });
  assert.ok(Math.abs(((back.heading - s.heading + 540) % 360) - 180) > 170, `${s.heading}° and ${back.heading}°`);
  assert.equal(await roads.snap(37.7936, -122.3955, { reach: 1 }), null, 'nothing within a metre');
  assert.equal(await roads.snap(40.71, -74.0), null, 'outside the region, with no map tiles: nothing');
  assert.equal((await roads.describe(37.7936, -122.3955)).name, 'Spear Street');
  assert.ok((await roads.heightAt(37.7936, -122.3955)).alt > 0);
});

test('who may open the editor: development builds, or the editor flag', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  try {
    assert.equal(editorAccess({ hostname: 'localhost', protocol: 'http:', search: '' }).allowed, true);
    assert.equal(editorAccess({ hostname: 'game.example.com', protocol: 'https:', search: '' }).allowed, false);
    assert.equal(editorAccess({ hostname: 'game.example.com', protocol: 'https:', search: '?dev' }).allowed, true);
    setEditorFlag(true);
    assert.equal(editorAccess({ hostname: 'game.example.com', protocol: 'https:', search: '' }).how, 'editor flag');
    setEditorFlag(false);
    assert.equal(editorAccess({ hostname: 'localhost', protocol: 'http:', search: '' }).allowed, false, 'off is off, even in a development build');
  } finally { delete globalThis.localStorage; }
});

test('3D markers: the nearest drawn, faded with distance, picked by a ray, labels made and disposed', () => {
  const scene = new THREE.Scene(), place = it => [it.location.lon, it.location.alt, it.location.lat];
  const M = createMarkers3d({ THREE, parent: scene, place, max: 50, near: 100, far: 1000, labels: 4, labelDist: 300 });
  const items = [];
  for (let k = 0; k < 200; k++) items.push(newItem(['quest', 'poi', 'spawn'][k % 3], { id: `t_${String(k).padStart(4, '0')}`, location: { lat: 0, lon: k * 20, alt: 0, heading: 0 }, name: `M${k}` }));
  M.setItems(items);
  M.update({ x: 0, y: 5, z: 0 });
  assert.equal(M.stats.drawn, 50, 'only the nearest max are drawn (within far)');
  assert.equal(M.stats.labels, 4, 'labels for the nearest few');
  const alpha = M.group.children[0].geometry.getAttribute('instanceAlpha').array;
  assert.equal(alpha[0], 1, 'near: solid');
  assert.ok(alpha[40] < 0.4 && alpha[40] > 0, `further: fading (${alpha[40]})`);
  // a ray down onto the third one picks it
  const ray = new THREE.Raycaster(new THREE.Vector3(40, 50, 0), new THREE.Vector3(0, -1, 0));
  scene.updateMatrixWorld(true);
  assert.equal(M.pick(ray), 't_0002');
  // moved far away: nothing drawn, every label disposed
  M.update({ x: 1e6, y: 5, z: 0 });
  assert.equal(M.stats.drawn, 0); assert.equal(M.stats.labels, 0);
  assert.equal(M.group.children.length, 3, 'only the three shared meshes left');
  // the selected one is drawn whatever its distance
  M.select('t_0199'); M.update({ x: 0, y: 5, z: 0 });
  assert.ok(M.stats.drawn >= 1);
  M.dispose();
  assert.equal(scene.children.length, 0);
});

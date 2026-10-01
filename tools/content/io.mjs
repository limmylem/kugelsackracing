// Reading and writing models for the content tools (gltf-transform): every extension the game's
// loader handles, meshopt compression both ways, and the warnings gltf-transform prints kept quiet.
//
//   const io = await modelIO();  const doc = await io.read('x.glb');  await io.writeBinary(doc)

import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

let shared = null;
export async function modelIO() {
  if (shared) return shared;
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  shared = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  return shared;
}
export const quiet = doc => { doc.setLogger(new Logger(Logger.Verbosity.ERROR)); return doc; };
export async function readModel(file) { const io = await modelIO(); return quiet(await io.read(file)); }
export { MeshoptEncoder };

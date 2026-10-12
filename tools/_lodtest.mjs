import { readModel, modelIO } from './content/io.mjs';
import { makeLods } from './content/lods.mjs';
for (const f of ['assets/cars/starter_car/body.glb', 'assets/parts/aero/spoiler_ducktail.glb', process.argv[2]].filter(Boolean)) {
  try {
    const doc = await readModel(f), t = Date.now();
    const r = await makeLods(doc, { levels: [{ ratio: 0.35, error: 0.02 }] });
    const io = await modelIO(), bytes = await io.writeBinary(doc);
    const back = await io.readBinary(bytes);
    console.log(f, JSON.stringify(r), Date.now() - t, 'ms', bytes.length, 'bytes; scenes', back.getRoot().listScenes().map(s => s.getName()));
  } catch (e) { console.log(f, e.message); }
}

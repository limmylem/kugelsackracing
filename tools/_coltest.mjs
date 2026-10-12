import { readModel } from './content/io.mjs';
import { inspect } from './content/inspect.mjs';
import { collisionHulls } from './content/collision.mjs';
for (const f of process.argv.slice(2)) {
  const info = inspect(await readModel(f));
  for (const coacd of [false]) {
    const t = Date.now(), c = await collisionHulls(info.triangles, { maxHulls: 6, maxPoints: 20, concavity: 0.25, cells: 40, coacd });
    console.log(f.split('/').pop().padEnd(34), (c?.method ?? '-').padEnd(9), 'hulls', c?.hulls.length, 'pts', c?.hulls.map(h => h.length / 3).join('/'), 'vol', c?.volumes.reduce((a, b) => a + b, 0).toFixed(4), 'mesh vol', info.closed ? info.volume.toFixed(4) : 'open', Date.now() - t, 'ms', JSON.stringify(c).length, 'B');
  }
}

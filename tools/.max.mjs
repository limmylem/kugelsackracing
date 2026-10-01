import { loadProject } from './content/project.mjs';
import { maxBuild } from './content/maxbuild.mjs';
const { db } = await loadProject();
const r = maxBuild(db), s = r.garage.stats();
console.log(r.rating.index, r.rating.class, JSON.stringify(r.rating.estimates), JSON.stringify(r.rating.scores));
console.log(r.steps.join('\n'));

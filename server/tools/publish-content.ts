// Every part and car published (the owner's choice, 2026-10-17): what the files have now goes live, with every deploy
// (deploy.yml step 6) — so nothing new waits as a draft, and a part whose files changed after it was published (its
// pinned version: server/src/content/manager.ts) is published again as it is now. What a person moved back to a draft or
// into review in the admin page's Content tab stays as they left it; a part whose checks fail is left as it was, and said.
//
//   DATABASE_URL=… node server/tools/publish-content.ts

import { openDb } from '../src/db/index.ts';
import { createContentManager } from '../src/content/manager.ts';

const { db, pool } = openDb(process.env.DATABASE_URL ?? 'postgres://kr:kr@localhost:5432/kr_dev', { max: 2 });
let failed = false;
try {
  const manager = createContentManager(db);
  const r = await manager.publishEverything();
  console.log(`${r.done.length} published (catalogue version ${r.version}).${r.done.length ? ` ${r.done.slice(0, 40).map(x => x.id).join(', ')}${r.done.length > 40 ? '…' : ''}` : ''}`);
  if (r.keptAsDrafts.length) console.log(`${r.keptAsDrafts.length} kept as a person left them (a draft or in review): ${r.keptAsDrafts.join(', ')}`);
  for (const x of r.refused) console.log(`::warning title=Not published: ${x.id}::${x.why}`);
  await manager.close?.();
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  await pool.end();
}
process.exit(failed ? 1 : 0);

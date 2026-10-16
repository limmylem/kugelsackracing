// The ROADBOOK's files read into one bundle (docs/ROADBOOK.md): data/seasons/index.json, each season's season.json,
// shop.json and expeditions/<id>.json, and data/places.json. The server keeps this bundle as versions the admin page
// edits (server/src/roadbook/config.ts); a game with no server uses the files as they are.
//
//   const all = await loadRoadbook(readJson)     readJson('data/…') → the parsed file

export async function loadRoadbook(readJson) {
  const index = await readJson('data/seasons/index.json'), places = (await readJson('data/places.json')).places ?? [];
  const seasons = {};
  for (const id of index.seasons ?? []) {
    const season = await readJson(`data/seasons/${id}/season.json`), shop = await readJson(`data/seasons/${id}/shop.json`).catch(() => ({ items: [] }));
    const expeditions = {};
    for (const x of season.expeditions ?? []) expeditions[x] = await readJson(`data/seasons/${id}/expeditions/${x}.json`);
    seasons[id] = { season, shop, expeditions };
  }
  return { current: index.current, seasons, places };
}

// Who the world's map comes from, as the game must say it (the licences require it): OpenStreetMap
// (ODbL: roads, land use, water, car parks, details, many buildings), Overture Maps (buildings and the
// OSM-derived themes, under ODbL and CDLA Permissive 2.0), and the terrain's sources once there are some
// (Stage B adds the elevation data). Shown in the corner of the game, and kept in each map file's metadata.

export const ATTRIBUTION = {
  sources: [
    { name: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL 1.0' },
    { name: 'Overture Maps Foundation', url: 'https://overturemaps.org', licence: 'ODbL 1.0 / CDLA Permissive 2.0' },
  ],
  get text() { return this.sources.map(s => `© ${s.name}`).join(' · '); },
  get html() { return this.sources.map(s => `<a href="${s.url}" target="_blank" rel="noopener">© ${s.name}</a>`).join(' · '); },
};

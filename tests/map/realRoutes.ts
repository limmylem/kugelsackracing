// The real-road routes the tests drive, one per baked region (tests/map/routes.test.ts, quests.test.ts).

export const REAL_ROUTES: Record<string, any> = {
  // (to Rue du Portier: on from there the way east is the Fairmont hairpin, a 150° turn from a 10 m road
  // into a 5 m one-way — a driver takes it at walking pace with the whole road; the autopilot can't yet)
  monaco: { what: 'city streets, a tunnel, bridges', kind: 'p2p', waypoints: [[43.7395, 7.4275], [43.7433, 7.4298], [43.74225, 7.42965]], roads: ['Avenue Princesse Grace', 'Boulevard du Larvotto', 'Rue du Portier'] },
  tokyo: { what: 'city streets, steep', kind: 'p2p', waypoints: [[35.6595, 139.7005], [35.6604, 139.7052], [35.6675, 139.7075]], roads: ['表参道'] },
  stelvio: { what: 'mountain pass', kind: 'p2p', waypoints: [[46.52862, 10.45321], [46.53379, 10.47700]], roads: ['Stilfserjoch Staatsstraße'], minTurns: 15 },
  munich: { what: 'motorway', kind: 'p2p', waypoints: [[48.22174, 11.62972], [48.2483, 11.6430]], classes: ['motorway'] },
  sf: { what: 'city streets, the game\'s own region', kind: 'p2p', waypoints: [[37.7936, -122.3955], [37.7880, -122.4075], [37.7765, -122.4170]], roads: ['Market Street', 'Powell Street'] },
  mk: { what: 'roundabouts, a loop', kind: 'loop', waypoints: [[52.04408, -0.76447], [52.03807, -0.75242], [52.03413, -0.76187], [52.04101, -0.77558]], roads: ['North Saxon Roundabout', 'South Saxon Roundabout', 'H6 Childs Way'], laps: 1 },
};

# World content and the world editor

Phase 4 Steps 1 and 2. The editor places world content (quest starts, points of interest, spawn points)
anywhere on Earth and fills in the details, and draws routes on the region's real roads (Step 2:
[ROUTES.md](ROUTES.md) — the route tool, checkpoints and shortcuts, test drives). The game shows what's published near the player. Everything
goes through one interface, `WorldContentService` (`content/service.js`). For now a local backend keeps
it in the browser. A server with PostGIS can take over later with no change to the editor or the game
(see the design note below).

## Using the editor

- **Open it** with **F2**, or the **✎ Editor** button in the world bar.
  - It's there in development builds: the game served from your own computer with `npm start`, or any
    address with `?dev`.
  - It's also there for accounts with the editor flag. For now that's a setting in this browser: in the
    console, `localStorage['kugelsack.editor'] = 'on'` (or `'off'`, even in a development build).
  - The server will decide this later.
- **Opening it pauses play safely.** Nothing is simulated, the car holds where it is, the game's controls
  and sound are off, and an automated test stops. Leaving with F2 carries on from exactly where you were.
- **An orange frame and banner** show you're in the editor.
- **Two views**, switched with **M**:
  - **Map**: the whole Earth. It's a globe zoomed out and tilted streets close in (MapLibre, OpenFreeMap's
    world map). If that can't be reached, it shows the baked region's own map.
    - Drag to pan, right-drag to turn and tilt, the wheel zooms.
    - W A S D pan, Q / E turn, R / F tilt, Z / X zoom; Shift is faster.
  - **3D**: a free-flying camera over the baked world the game drives in (San Francisco for now).
    - W A S D fly, Q / E down and up, right-drag or the arrow keys to look round.
    - The wheel sets the speed; Shift is faster.
- **Find a place** with the search box:
  - a place name (OpenStreetMap's Nominatim, plus the region's own places, which need no network);
  - coordinates in any form (`37.7936, -122.3965`, or degrees, minutes and seconds).
- **Bookmarks** (★): add the current place; right-click one to remove it.
- **Place** with the tools: **1** quest start, **2** point of interest, **3** spawn point. Then click the
  world or the map. **4** draws a route ([ROUTES.md](ROUTES.md)).
  - In 3D, the click lands on the road surface first, then the ground, buildings and the rest. The exact
    latitude, longitude and height are stored.
  - **Snap to road** (**N**, on by default) moves the marker onto the nearest road and faces it along the
    road (the direction nearest the camera's; a one-way street's own direction):
    - inside a baked region, using its road graph (OpenStreetMap's roads, with heights from the road
      surface);
    - elsewhere, using OpenFreeMap's map tiles (no heights there: the map's terrain gives one).
  - Each marker's **road name and nearest intersection** are shown, snapped or not.
- **Edit**:
  - **V** select, then click a marker. Drag the selected marker to move it; it settles (and snaps)
    where you let go.
  - **[ ]** turn by 15° (with Shift, by 1°). **Ctrl+D** duplicates; **Delete** deletes.
  - **Ctrl+Z / Ctrl+Shift+Z** undo and redo every action: place, move, turn, edit, duplicate, delete,
    archive, restore, publish.
- **The properties panel** (right): name, description, place, the quest's type and its own fields, entry
  requirements, fee and reward, and conditions.
  - What it still needs is listed in plain words. Errors (red) stop publishing; warnings (amber) don't.
    Click one to go to its field.
- **Publish** makes it visible to players. Edits after that are a draft until published again (marked
  *changed*).
  - **Unpublish** takes it back out of the game.
  - **Deleting** something published asks first, then **archives** it (kept: tick *archived* to see and
    restore it). A draft that was never published is deleted, and undo brings it back.
- **Drafts are saved as you work.** Publishing, archiving and importing save at once. The page warns
  before closing with anything unsaved.
- **Export / Import** (JSON): this area, everything, or only what's published.
  - Imports are checked: the format, its version (older versions are brought up to date; a file from a
    newer game is refused), and each item. Bad items are skipped with the reason.

## The format (version 3)

`data/schemas/content-item.schema.json` defines the shape. `content/quests.js` checks the rest in plain
words.

- **Every item:**
  - `id`, `version`, `kind` (`quest` | `poi` | `spawn` | `route`), `name`, `description`, `icon`;
  - `location` { `lat`, `lon`, `alt` (metres above sea level, EGM2008, as the baked world's heights),
    `heading` (degrees from north), `altFrom` (`road` | `ground` | `terrain` | `estimate`) };
  - `road` (the road it was snapped to), `status`, `author`, `created`, `updated`, `publishedAt`.
- **Quests also have:**
  - `type`: `sprint` | `time_trial` | `checkpoint` | `drift` | `delivery` | `pink_slip`;
  - `route`: a route's id (an item of kind `route`), or null. One route can serve several quests;
  - `entry` { `classes`, `maxPowerKw`, `minWeightKg`, `maxWeightKg`, `maxKwPerTonne`, `minLevel` };
  - `fee`;
  - `rewards` { `tier` };
  - `npc`: filled in Step 4;
  - `conditions` { `timeOfDay`, `weather` };
  - `enabled`;
  - `params`: the type's own fields. A sprint has its finish line and laps; a time trial its finish, laps
    and target time; a checkpoint run its checkpoints, time limit and laps; a drift its score target; a
    delivery its cargo, destination and damage penalty; a pink slip the rival's car and its finish. With
    a route, the route's finish and checkpoints stand in for those; laps need a loop route.
- **Routes also have** `course`: the waypoints, road options, the baked centreline, the OSM road segments
  used, grid, checkpoints and the rest ([ROUTES.md](ROUTES.md#saved-data-in-the-route-items-course)).
  Their `location` is the start line. The game shows routes through their quests, not as markers.
- **Rewards are never stored as money.** A quest names a reward tier, and the money and xp come from the
  economy's rules (`data/economy.json` `quests`):
  - money = base × tier × type × the lowest car class the quest lets in;
  - xp = base × tier.

  So changing the rules changes every quest. The entry fee is the author's, at most
  `fee.maxShareOfReward` of the reward.
- **Migrations** (`content/migrations.js`) bring older items up one version at a time. Version 1 (the
  first draft) had flat coordinates and hard-coded reward money. It becomes version 2 with the nearest
  reward tier. Version 3 added routes and laps on more quest types; a version 2 item is a version 3 one
  as it is.

## The service

`content/service.js` `METHODS` lists every request. All are async and answer `{ ok, error, … }`.

| Request | What it does |
|---|---|
| `query({ lat, lon, km, view, kinds, offered, limit })` | content within X km, nearest first |
| `inCell(geohash)` / `inTile(z, x, y)` | everything in a cell or a map tile |
| `get(id, { view })` | one item |
| `create(item)` / `update(id, item)` | drafts (the service gives ids, author and times) |
| `publish(id)` / `unpublish(id)` | what players see (refused while it has errors) |
| `remove(id, { confirm })` / `restore(id)` | delete a draft; archive a published item (only with `confirm`) |
| `getState(id)` / `setState(id, state)` | an item's whole state, for undo |
| `exportContent({ area, views })` / `importContent(json, { onConflict })` | JSON files |

- **Views:**
  - `draft` is the editor's working copies;
  - `published` is what the game asks for, with `offered: true` keeping out quests that are switched
    off;
  - `archived` is kept, not shown.
- **Cells:** content is kept by geohash cell (precision 5, about 4.9 × 4.9 km at the equator), so only
  the cells near the camera or the player are loaded. Wide areas use a coarser prefix index; cells not
  used lately leave memory.
- **Local backend:**
  - IndexedDB (database `world-content`): one record per cell per view, and an index (which cells have
    content, which cell each item is in).
  - `content/client.js` makes the page's one service, and is the place to swap in a remote one.

### Measured (`npm run stress:content`, 50,000 markers)

- **Nearby queries** (1–10 km): under 0.6 ms at the 95th percentile, anywhere or in the busiest cities.
  The limits are 5 ms at p95 and 25 ms at worst.
- **The content's work per frame:** 0.04 ms at p95 while flying 400 km at 250 m/s, or driving a city at
  200 km/h. The limit is 2 ms.
- **Memory** stays level, with cells and labels disposed as they're left.
- **5,000 markers within 3 km:** at most 1,500 are drawn (three instanced draw calls, plus a label for
  each of the nearest 16), and the update stays near 2.6 ms.
- **In the browser**, the editor's own work per frame while flying is about 0.1 ms. The rest is the
  world streaming in, which the game does anyway.

## In the game

`play/contentLayer.js` handles published content in play:
- **Fetching:** published content within 3 km of the player is fetched by cell, again every 250 m and
  whenever something's published.
- **In the world:** markers are drawn as the editor draws them (`editor/markers3d.js`), fading with
  distance.
- **On the maps:** markers appear on the minimap, and on the full map (Tab), clustered when zoomed out.
- **Info card:** driving up to a marker, or clicking it in the world or on the map, shows a card. It has
  the name, the type, whether your car meets each requirement, the reward and the fee. A quest's card is
  the quests' own (start it, set a route to it): see [QUESTS.md](QUESTS.md).
- **Quest states:** each quest's marker on the maps shows new, attempted or completed (in its medal's
  colour).

## Design note: a server with PostGIS

The server answers the same requests as `WorldContentService`. A `RemoteWorldContentService` in
`content/client.js` calls these endpoints, and nothing else changes.

### Tables

```sql
CREATE TABLE content_item (            -- one row per item and view
  id          text        NOT NULL,
  view        text        NOT NULL CHECK (view IN ('draft', 'published', 'archived')),
  kind        text        NOT NULL CHECK (kind IN ('quest', 'poi', 'spawn')),
  version     int         NOT NULL,
  geom        geography(PointZ, 4326) NOT NULL,      -- lon, lat, alt (EGM2008 metres)
  heading     real        NOT NULL,
  cell        text        NOT NULL,                  -- geohash precision 5 (the client's cells)
  enabled     boolean     NOT NULL DEFAULT true,     -- quests: offered once published
  data        jsonb       NOT NULL,                  -- the whole item, as the schema says
  author_id   uuid        NOT NULL REFERENCES account(id),
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  published_at timestamptz,
  PRIMARY KEY (id, view)
);
CREATE INDEX content_item_geom ON content_item USING gist (geom);
CREATE INDEX content_item_cell ON content_item (view, cell);
CREATE INDEX content_item_kind ON content_item (view, kind);

CREATE TABLE content_history (         -- every change, for audit and server-side undo
  seq        bigserial PRIMARY KEY,
  id         text NOT NULL, action text NOT NULL,     -- create | update | publish | unpublish | archive | restore | import
  before     jsonb, after jsonb,                       -- the item's whole state (draft, published, archived)
  author_id  uuid NOT NULL, at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE editor_account (account_id uuid PRIMARY KEY REFERENCES account(id), can_publish boolean NOT NULL DEFAULT false);
```

- Content within X km is
  `ST_DWithin(geom, ST_MakePoint(:lon, :lat)::geography, :km * 1000)` ordered by `geom <-> point`.
- Content in a tile is `geom && ST_TileEnvelope(z, x, y)`.
- Content in a cell is `cell = :hash` (or `LIKE :prefix || '%'`).
- The server validates every write with the same schema and rules (`content/schema.js`,
  `content/quests.js`, the economy file). Rewards stay rule-based on the server too.

### Endpoints

| Method | Path | Service request |
|---|---|---|
| GET | `/world-content?lat&lon&km&view&kinds&offered&limit` | `query` |
| GET | `/world-content/cells/:hash?view` · `/world-content/tiles/:z/:x/:y?view` | `inCell` · `inTile` |
| GET | `/world-content/items/:id?view` · `/world-content/items/:id/state` | `get` · `getState` |
| POST | `/world-content/items` | `create` |
| PUT | `/world-content/items/:id` | `update` |
| PUT | `/world-content/items/:id/state` | `setState` (undo / redo) |
| POST | `/world-content/items/:id/publish` · `/unpublish` · `/restore` | `publish` · `unpublish` · `restore` |
| DELETE | `/world-content/items/:id?confirm=true` | `remove` (409 with `needsConfirm` if published and not confirmed) |
| GET | `/world-content/export?lat&lon&km&cell&views` · POST `/world-content/import?onConflict` | `exportContent` · `importContent` |

- **Access:** the game only ever reads `view=published&offered=true`. Every write needs an editor
  account; publishing, unpublishing and archiving need `can_publish`.
- **Caching:** the published tile and cell responses can be cached at a CDN by cell, and invalidated on
  publish.

## Tests

- **`npm run test:unit`**:
  - `tests/unit/world-content.test.mjs`: geohash cells and lat/lon parsing; the format and its plain-word
    checks for every type; rewards from the economy's rules; drafts and publishing; archiving; spatial
    queries; surviving a restart; export and import round trip, version checks and migrating version 1;
    undo and redo of every action.
  - `tests/unit/editor.test.mjs`: snapping on San Francisco's road graph; who may open the editor; the
    3D markers.
  - `tests/unit/route.test.mjs`: routes ([ROUTES.md](ROUTES.md#tests)).
- **`npm run stress:content`**: 50,000 markers. Query times, the content's work per frame while flying
  and driving, memory over hundreds of cells, and 5,000 markers within 3 km.

// Where the game's parts are (docs/DEPLOYMENT.md): read by the pages before anything else (a plain <script>, so
// it's there when the modules start). This file is for a page served as it is (npm start, or the server with
// everything on one address — which answers /site/config.js itself); the site build writes one for each
// environment:
//   api    the API server's address ('' = this page's own)
//   game   the game's address ('' = this page's own)
//   tiles  map files, cars, parts and sounds (/assets/…) ('' = this page's own)
//   rt     the real-time server (wss://…) ('' = none)
globalThis.KR_SITE ??= Object.freeze({ env: 'local', api: '', game: '', tiles: '', rt: '' });

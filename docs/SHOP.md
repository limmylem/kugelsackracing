# The shop, the dealership and selling (Phase 6 Step 4)

Parts, kits, new and used cars, selling, refunds and garage space. The server decides every price and every sale:
the game only shows them and asks. The rules are one file, `garage/shop.js`. The game uses it to show prices,
the player service (`garage/player/service.js`) uses it to charge, and the server runs the same service with
its own settings. The settings are `data/economy.json` `shop` and `sell`; on the server they are the active
version of the economy's settings (docs/ECONOMY_SERVER.md).

No real money and no premium currency: everything is bought with the game's own money.

## Prices

| What | Price |
|---|---|
| A part | Its own (`data/parts/…json` `price`), unless the catalogue sets one (`shop.catalogue.parts[id].price`). A part for a group of sockets (wheels, tyres) comes as a set: price × the set's size. |
| A new car | Its class's (`carPrices`) × its `priceFactor`, unless the catalogue sets one. |
| A sale | `shop.sales`: a name, a start and an end, a discount, and what it covers (everything, categories, tiers, parts, cars, car classes). The best sale on an item counts; sales don't add up. Once a sale ends, the price is the list price again, whatever the game last showed. |
| A limited-time item | `catalogue…[id].from` / `until`: only sold between them. The shop shows the end date. |
| A kit | `shop.bundles`: its parts as sets for the car, each at its price now, less the kit's discount (8% by default). Each part's share of the kit price counts as what was paid for that part. |
| A used car | The day's lot (below): the body and each part priced by condition, × the lot's factor. |
| Garage space | `shop.garage`: 3 spaces to start; another costs `slotPrice` × `growth` for each one already bought, at most `maxExtra`. |

Hidden items (`catalogue…[id].hidden`) aren't sold. A part copy someone already has still works.

## Locks

An item can need a level, or a quest series finished. The shop shows what unlocks it and won't sell it until
then. Test drives are still allowed.

- **Default locks:** race-tier parts need level 5 (`shop.unlock.partTiers`). A-class cars need level 4,
  S-class level 6 and X-class level 10 (`carClasses`). A medium player reaches level 10 in 8 hours.
- **Per item:** `catalogue…[id].unlock` (`{ level, series, seriesName }`) replaces the default.
- **Kits:** need their own lock (if they have one) and every part's.

## Selling

`sell` in `data/economy.json`:

> sell value = worth × `ratio` − `repairShare` × what putting it right would cost (scaled to its worth),
> and at least worth × `ratio` × `floor`

- **Worth** is the lowest of three prices: what was paid, the list price, and the price now. Something bought in a
  sale is worth what was paid for it. Nothing sells for as much as it costs.
- **The repair cost** includes the condition, dents and mechanical damage (`garage/repair.js`).
- **Defaults:** `ratio` 0.6, `repairShare` 0.5, `floor` 0.1. A new part sells for 60% of what was paid.
- **Why `repairShare` is at most 1:** repairing something just to sell it never pays. The old rule used a
  condition curve, which fell faster than repair costs below 70%. Under it, a wrecked engine was worth fully
  repairing just to sell, for a profit of $1,806. The exploit check now catches this (below).

**Selling a car.** A car sells for its body's sell value plus the sell value of every part on it.
- The body's list price is the car's price less its factory parts' prices.
- Before selling, the player can tick parts to keep. Kept parts go to the inventory.
- The dialog asks for confirmation and shows what the car fetches.
- These can't be sold: the last car that can be driven, and a car in a race (a quest under way with it).

**Selling several parts** takes one confirmation. A single sale asks "Sell for $X?" on the button.

**Refunds.** A part bought new can go back for exactly what was paid, once, within `shop.refund.minutes` (30). It
must never have been fitted, and it must be as it came (no wear, dents or tuning). Kits can be refunded part by
part.

## The used car lot

- **Daily and shared.** A new lot each day (UTC), made from the day and `shop.usedLot.seed`. Everyone sees the
  same lot all day, and each player can buy each car once.
- **What's on it.** `count` cars (8), by class weights. Each has:
  - mileage, and wear that grows with it;
  - sometimes an accident: the body and the parts in one zone knocked down, sometimes glass broken;
  - sometimes aftermarket parts, kept only if the car still drives;
  - an owner count;
  - a history: registered, services, accidents, parts fitted.
- **Price.** The body's list price and each part's, each scaled by its condition (`price.conditionCurve`), all ×
  `price.factor` (0.85).
- **What was paid.** The price is shared between the body and the parts by their list prices. That share is what
  each is worth when it's sold, so flipping a used car loses money.
- **In the dealership.** Each listing shows a damage report (its worst parts, broken glass), its aftermarket parts
  and its history. The car is shown on the lift as it is, and can be test-driven as it is.
- **Changing it.** The admin page previews tomorrow's lot, or any day's, with settings that aren't saved yet.

## In the game (the garage screen)

- **Shop → Parts.**
  - Filters: category, maker, tier and price. "Fits my car" starts on.
  - Sorting includes "Best upgrade first" (the rating gain on this car).
  - Badges: sales (with their end), limited-time items, and locks with what unlocks them.
  - Buttons: **Compare** and **Buy** (to the inventory).
- **Compare** opens the part's socket.
  - It shows the stats before and after (power, torque, weight, rating), what makes up each, and a dyno of
    before (dashed) and with it. The part shows as a ghost on the car.
  - **Test drive with it** drives the car with the part fitted. Nothing is bought, saved or earned.
  - **Buy only**, or **Buy & install** in one step.
- **Shop → Kits.** Each kit's parts and saving. **Buy**, or **Buy & install** (every part that goes on).
- **Dealership → New cars.**
  - Specs, rating, price, sale and lock.
  - The showroom: Outside (turning; drag to turn it), Interior (the door opens), Engine bay, Boot. A paint
    preview.
  - Test drive, buy.
- **Dealership → Used lot.** See above. Both dealership views show the garage's space and the price of another
  space.
- **Your cars** (top left): each car has a sell button.
- **Inventory.**
  - For each spare part, which of the player's cars it fits.
  - Refund (inside the window), sell.
  - **Sell several**: tick spare parts, then sell them all with one confirmation.
  - **History**: every purchase, sale and refund (the last 200, in the save).

## Admin (the admin page)

Changes made in **Shop** each become a new version of the economy's settings:
- the change and the admin's reason are in the version history and the admin log;
- any version can be rolled back to from **Economy settings**;
- a change made from an out-of-date page is refused.

What **Shop** changes:
- **The catalogue:** each part and car's price, maker, hidden, unlock level and "sold until" (blank means its own).
- **Kits:** add, change, remove.
- **Sales:** schedule one (a start and end in UTC, a discount, what it covers), end one now, remove one.
- **Level locks**, and the used lot's settings, with **Preview the lot** (tomorrow, or any day).

**Shop dashboard** (the last 30 days):
- spent and paid out, and refunds;
- top sellers (parts, kits, new and used cars);
- spend by category;
- parts and cars nobody bought.

New parts and cars come from their data files (and the editor). The catalogue only prices and lists what's there.

## On the server

- **Actions** (`POST /api/v1/player/actions/:action`): `sellParts`, `refundPart`, `buyBundle`, `sellCar`,
  `buyUsedCar` and `buyGarageSlot`, alongside `buyPart`, `buyAndInstall` and `buyCar`.
  - Each request is checked against a strict schema, so a price, amount or discount in it is refused.
  - Each action is one transaction holding the player's lock, with one ledger row: `purchase`, `sale` or
    `refund`, a reason, and what it was about.
  - A car in an active quest session can't be sold.
- **Reads:** `GET /api/v1/player/used-lot` gives today's lot. Prices come from `GET /api/v1/player/config`.
- **Storage:** what a car or part copy carries besides its columns goes in `extra` (migration `0009`): when it was
  bought, whether it's been fitted, the body's price, and a used car's listing, mileage and history.
- **Settings the game has gained** (a new section, a new value) are added to the active version as a new version
  when the server starts. Nothing already there changes.
- **Admin routes** (`server/src/routes/adminShop.ts`):
  - `GET` and `POST /api/v1/admin/shop/catalogue`;
  - `POST /api/v1/admin/shop/used-lot/preview`;
  - `GET /api/v1/admin/shop/dashboard`.

## The economy check

`npm run economy-sim` plays the shop as the game has it:
- prices now, level locks, kits, and the day's used lot;
- with the garage full, it sells the weakest car.

Every target is met. The quest pay check now pools the bots' runs over three seeds (`simulation.payCheckSeeds`):
- On one seed, a type at a tier is a handful of runs, and its pay swung either way with the shop's changes.
- Pooled over seeds 7, 8 and 9, every type is within 0.6–1.6× of its tier's median, before and after the shop.

It also tries every money-making trick through the player service (`tools/economy/exploits.mjs`). None makes money:

| Trick | Tried | Best case |
|---|---|---|
| Buy new, sell straight back (every part and car) | 457 | −$24 |
| Buy in a sale, sell after it ends | 128 | −$12 |
| Refund (back what was paid, once) | 80 | $0 |
| Kits split: sold, or refunded part by part | 80 | $0 (refunded) |
| Used cars flipped (7 days' lots), as they are and repaired | 112 | −$3,949 |
| Repair only to sell (every part at 0–95%; car bodies; quick and full) | 3,656 | −$10 |

## Tests

| Command | What |
|---|---|
| `npm run test:unit` | `tests/unit/shop.test.mjs`: prices, sales, locks, sell values, the lot (the same on a day, new the next), kits, makers, refunds, space. |
| `npm run test:server` | `server/test/shop.test.ts`: every purchase and sale with its ledger row; tampered requests (a price, a locked item, someone else's or a racing car's things, a sale that's over, a limited item gone, a hidden one); the lot the same for everyone and new the next day; a refund once, only unused, only in its window; the garage's space with five purchases at once; the admin's changes (logged, rolled back, stale ones refused). |
| `node server/tools/shop-browser.ts` | All of it in Chromium against the server: the shop, compare, buy and install, refund, a kit, the showroom, the used lot, selling a car and several parts, the history, and the admin page (a sale scheduled, the game's prices following it; the dashboard). |
| `node server/tools/shop-load.ts` | 500 players browsing and buying (see below). |
| `npm run economy-sim` | The targets and the exploit checks. |

### Load (this computer: 4 cores, PostgreSQL on the same machine)

500 signed-in players arrive over 20 s and pause 5–20 s before each step:
- each looks at their garage, the prices and today's lot;
- each buys a part, buys and fits one, buys a kit, refunds a part and sells several;
- each buys a used car and sells it again (keeping a part), then reads their ledger.

That's 5,500 requests with no errors, and every balance equals its ledger afterwards.

| | p50 | p95 | worst |
|---|---|---|---|
| Their garage, the prices, today's lot, the ledger | 2–12 ms | 3–21 ms | 303 ms |
| Buy a part, a kit, a refund, sell several | 16–18 ms | 32–47 ms | 114 ms |
| Buy and fit | 31 ms | 57 ms | 88 ms |
| Buy a used car, sell a car | 39–51 ms | 70–92 ms | 125 ms |

The limits are the economy's: a p50 under 150 ms and a p95 under 1 s.

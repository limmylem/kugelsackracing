# The Roadmap

Players see what's being worked on, vote for what they want most, and share their own ideas. An idea stays hidden from
everyone but its author until an admin accepts it on the admin page.

## For players (the dock's **Roadmap** tile)

- **The board** (`ui/roadmap.js`) shows the features and bugs the team adds, and players' ideas once accepted. Each item
  has its kind (feature, bug, idea) and how far along it is:

  | Status | Shown as |
  |---|---|
  | `open` | Open for votes |
  | `planned` | Planned |
  | `working` | Being worked on |
  | `done` | Done (shown for 90 days after) |

  What's being worked on comes first, then planned, then open, with the most votes first in each.
- **Filters:** All, Being worked on, Planned, Ideas, Bugs, Done.
- **Votes:** one a player for each item, taken back by pressing again. Done items take no more votes.
- **Ideas:** a title (6 to 80 characters) and an optional description (up to 1,000).
  - The idea then waits for an admin (`pending`). Only its author sees it, under **Your ideas**.
  - An idea that isn't taken shows "Not this time" to its author, with the admin's note if there is one. Nobody else
    ever sees it, and it drops off the author's list after 30 days.
  - Accepted ideas show the author's display name: "Idea from Pia Pitlane".
- **Who can do what:**
  - Anyone can read the board, even signed out.
  - Voting and sending ideas need a full account. Guests are asked to make one.
- **Limits:** 3 ideas a day, and at most 5 waiting at once.
  - Ideas with words the profanity filter matches are refused outright, not starred out (`rudeText` in
    `server/src/names.ts`).
  - Everything players write is shown as text.

## For admins (the admin page's **Roadmap** tab)

`admin/roadmap.js` has three parts:

- **Players' ideas waiting for you**, each with who sent it:
  - **Accept** puts it on the board as open for votes.
  - **Accept as planned** puts it on the board as planned.
  - **Reject** asks for an optional note, which only the author sees.
  - **Edit** fixes a typo or a title first.
- **Add a feature or bug:** a kind, a title, a status and an optional line about it. It's on the board at once.
- **On the board:** everything players see. A filter shows rejected or every item instead.
  - A button moves each item one step along: open → planned → being worked on → done.
  - **Edit** changes the title, description, a note players see, the kind or the status.
  - **Delete** removes the item and its votes.

Every add, accept, reject, edit and delete goes in the admins' log (`roadmap-add`, `roadmap-accept`, `roadmap-reject`,
`roadmap-edit`, `roadmap-delete`), with the idea's author as the target.

## The server

`server/src/routes/roadmap.ts`, tables from migration `0018_roadmap.sql`:
- `roadmap_items`: `kind`, `title`, `body`, `status`, `note`, `author_id`, `reviewed_by`, `reviewed_at`
- `roadmap_votes`: one row a player for each item

| | |
|---|---|
| `GET /roadmap` | The board: `items` (what players see, with `votes` and `voted`), `mine` (the caller's waiting and rejected ideas), `signedIn`, `canPost`. |
| `POST /roadmap/ideas` | `{ title, body }`. A full account. Returns the idea, `pending`. |
| `POST` / `DELETE /roadmap/:id/vote` | Vote, or take it back. Returns `{ votes, voted }`. Voting twice counts once. |
| `GET /admin/roadmap` | Everything, waiting first, with each author. |
| `POST /admin/roadmap` | Add an item. |
| `PUT /admin/roadmap/:id` | Edit an item. Changing a `pending` idea's status accepts or rejects it. |
| `DELETE /admin/roadmap/:id` | Delete an item and its votes. |

## Tests

- `server/test/roadmap.test.ts`: the server end to end. `npm run test:server`
- `server/tools/roadmap-browser.ts`: a player's board and the admin tab in a browser. In CI's slow tests.
- `tests/unit/roadmap.test.mjs`: the admin tab's helpers, and that its statuses match the server's and the game's words.

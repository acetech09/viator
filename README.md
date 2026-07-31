# Viator

A local tool for managing **EVE Online** shopping lists: build lists, price them,
copy them straight into the in-game Multibuy window, and subtract items you already
own at a station or structure.

## Install (Windows)

Download **`Viator-Setup-x.y.z.exe`** from the
[latest release](https://github.com/acetech09/viator/releases/latest) and run it. It installs
for the current user only, so there is no admin prompt, and it starts Viator when it finishes.

Windows SmartScreen will warn you the first time. Choose **More info → Run anyway**.

Viator checks for updates on launch, downloads them in the background, and applies them the
next time you close the app. You'll see a "restart to apply" notice when one is ready.

On first launch it downloads the parts of the EVE Static Data Export it needs (item names,
groups, categories — around 23 MB). That takes a few seconds and only repeats when CCP
publishes a new build.

## Registering an EVE application (needed for inventory filters)

Lists and pricing work with no setup. To use **inventory filters** (subtracting owned
assets), you must authorize one or more characters, which requires your own EVE
developer application:

1. Go to <https://developers.eveonline.com/applications> and **Create New Application**.
2. **Connection Type:** *Authentication & API Access*.
3. **Permissions (scopes):** add
   - `esi-assets.read_assets.v1`
   - `esi-universe.read_structures.v1` (so player structures can be named)
4. **Callback URL:** `http://localhost:8642/sso/callback` (exactly this).
5. Create the app, then copy its **Client ID**.
6. In Viator, open **Settings**, paste the Client ID (and optionally a contact email —
   it's sent in the ESI User-Agent, which CCP appreciates), and **Save**.
7. Click **+ Add character** and complete the EVE SSO login. The character appears in
   Settings, and its stations/structures become available as inventory filters.

Assets refresh automatically when you open the app and via the **Refresh assets** button
in the title bar (throttled to respect ESI cache timers).

## How things work

- **Prices** default to CCP's official *estimated price* (`/markets/prices`). In Settings
  you can switch to a market hub's lowest **sell**, highest **buy**, or **split**, and
  choose the hub (Jita, Amarr, Dodixie, Rens, Hek).
- **Copy (Multibuy)** copies `Item Name Quantity` per line — paste it into EVE's Multibuy
  window. With filters active it copies the *remaining* quantities you still need to buy.
- **Inventory filters** are a non-destructive view: they subtract owned quantities (item
  hangar + containers + packaged ships; assembled ships and their contents are excluded).
  Your stored list is never modified. Fully-covered items are shown struck-through and
  excluded from the total.

## Data & privacy

Nothing leaves your machine except calls to CCP's APIs. The desktop app keeps everything in
one SQLite database at **`%APPDATA%\Viator\viator.db`**; running from source uses `data/viator.db`
in the project folder instead. Refresh tokens are stored there in plain text — acceptable for a
single-user local app, but keep the folder to yourself. Delete the database to reset Viator
completely.

## Running from source

Requires **Node.js 22+**.

```bash
npm install          # installs all workspaces
npm run dev          # server on :8642, Vite UI on http://localhost:5173
```

For a production-style single-process run, `npm run build` then `npm start`
(serves UI + API on <http://localhost:8642>). Note these use the repo's `data/` folder,
*not* the installed app's database, and only one of them can hold port 8642 at a time.

To work on the desktop shell itself, see [`desktop/CLAUDE.md`](desktop/CLAUDE.md):

```bash
npm run dev          # in one terminal
npm run dev:desktop  # Electron window pointed at the Vite dev server
npm run dist:desktop # build the installer into desktop/release/
```

### Moving an existing database into the desktop app

Close both the app and any `npm run dev` / `npm start` server first, so SQLite checkpoints cleanly.
Then copy `data\viator.db` (plus `viator.db-wal` and `viator.db-shm` if they exist) into
`%APPDATA%\Viator\`.

## Layout

```
shared/   pure DTOs, ISK formatting, paste parser (unit-tested)
server/   Fastify API, SQLite, ESI client, SSO/PKCE, SDE updater, asset & price pipelines
client/   React + Vite UI
desktop/  Electron shell + Windows packaging
```

Run `npm test` for the unit suites (formatting, paste parsing, fit parsing, asset classification).

## License

MIT — see [LICENSE](LICENSE).

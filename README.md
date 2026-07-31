# Viator

A single-user, locally-hosted web tool for managing **EVE Online** shopping lists:
build lists, price them against the market, copy them straight into the in-game
Multibuy window, and subtract items you already own at a station or structure.

## Requirements

- **Node.js 22+** (LTS). The app uses `better-sqlite3`, which ships prebuilt binaries
  for current LTS Node on Windows/macOS/Linux.
- An internet connection (the app talks to EVE's ESI API, SSO, the Static Data Export,
  and the image server).

## Install & run

```bash
npm install          # installs all workspaces
npm run dev          # dev: server on :8642, Vite UI on http://localhost:5173
```

Open **http://localhost:5173**. On first launch the app downloads the parts of the EVE
Static Data Export it needs (item names, groups, categories) — this takes a few seconds
and only repeats when CCP publishes a new SDE build.

For a production-style single-process run:

```bash
npm run build        # builds shared, server, and client
npm start            # serves the built UI + API on http://localhost:8642
```

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

Everything lives in `data/viator.db` (SQLite) in the project folder. Refresh tokens are
stored there in plain text — acceptable for a single-user localhost app; keep the folder
private. Delete `data/` to reset the app completely.

## Layout

```
shared/   pure DTOs, ISK formatting, paste parser (unit-tested)
server/   Fastify API, SQLite, ESI client, SSO/PKCE, SDE updater, asset & price pipelines
client/   React + Vite UI
```

Run `npm test` for the unit suites (formatting, paste parsing, asset classification).

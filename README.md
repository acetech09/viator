# Viator

A local tool for managing **EVE Online** shopping lists: build lists, price them,
copy them straight into the in-game Multibuy window, and subtract items you already
own at a station or structure.

## Install (Windows)

Download **`Viator-Setup-x.y.z.exe`** from the
[latest release](https://github.com/acetech09/viator/releases/latest) and run it.

Windows SmartScreen will warn you the first time. Choose **More info → Run anyway**.

Viator checks for updates on launch, downloads them in the background, and applies them the
next time you close the app. You'll see a "restart to apply" notice when one is ready.

On first launch it downloads the parts of the EVE Static Data Export it needs (item names,
groups, categories — around 23 MB). That takes a few seconds and only repeats when CCP
publishes a new build.

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
*not* the installed app's database, and only one of the two web modes can hold port 8642 at a
time. The installed desktop app takes whatever port the OS gives it, so it never collides
with either.

**Authorizing a character when running from source needs your own EVE application.** The
bundled one is registered against the desktop app's `eveauth-viator://sso/callback`, and CCP
allows only one callback URL per application — so register a second one with the callback
`http://localhost:8642/sso/callback` and enter its Client ID under **Settings → Advanced**.
Lists, pricing and Multibuy all work without this; only inventory filters need a character.

To work on the desktop shell itself, see [`desktop/CLAUDE.md`](desktop/CLAUDE.md):

```bash
npm run dev          # in one terminal
npm run dev:desktop  # Electron window pointed at the Vite dev server
npm run dist:desktop # build the installer into desktop/release/
```

To build the current source and run it in the real desktop shell (no installer),
double-click `dev-scripts\run-desktop.bat`. That path uses `%APPDATA%\Viator`, like the
installed app.

## License

MIT — see [LICENSE](LICENSE).

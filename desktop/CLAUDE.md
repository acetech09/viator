# desktop — Electron shell

Wraps the existing web app as a Windows desktop app: the Electron main process runs the
Fastify server **in-process** and opens a window on `http://localhost:8642`. The UI is the
unmodified React client, served over HTTP exactly as in `npm start`.

**Not an npm workspace.** It has its own `package.json` and lockfile, installed with
`npm ci --prefix desktop`. That isolation is deliberate — see the ABI note below.

## Files

| File | Role |
| --- | --- |
| `src/main.ts` | App lifecycle: single-instance lock, env injection, server boot, window, navigation guard, updater. Compiled to `dist/main.js` (ESM). |
| `src/preload.cts` | The only bridge between the web UI and Electron: `window.viatorDesktop`. Compiled to `dist/preload.cjs` — preload **must** be CJS. |
| `scripts/bundle-server.mjs` | esbuild → `dist/server.mjs`, a single-file ESM bundle of `server/dist/server.js` + `@viator/shared`. |
| `scripts/rebuild-native.mjs` | `postinstall` hook: downloads better-sqlite3's prebuilt binary for the installed Electron version. |
| `electron-builder.yml` | NSIS packaging + GitHub publish config. |
| `build/icon.png` | 1024×1024 app icon, derived from `media/icon psd.psd`. electron-builder converts it to `.ico`. |

## Gotchas

- **Config reaches the server through env vars, set before the bundle is imported.**
  `main.ts` sets `VIATOR_DATA_DIR` (→ `%APPDATA%\Viator`), `VIATOR_CLIENT_DIST`,
  `VIATOR_APP_VERSION` and `NODE_ENV`, then `await import()`s `dist/server.mjs`. The import
  **must stay dynamic**: `server/src/config.ts` reads those variables while its module
  evaluates, and a static import would be hoisted above the assignments.
- **The esbuild bundle consumes `server/dist`, not `server/src`.** The sources use ESM `.js`
  specifiers that only resolve once tsc has emitted them, so `npm run build` at the repo root
  is a prerequisite for `npm --prefix desktop run build`.
- **better-sqlite3 exists twice, at two different ABIs.** The root workspace copy is built for
  Node (used by `npm run dev`); `desktop/node_modules`' copy is built for Electron. Never run
  `electron-builder install-app-deps` or `electron rebuild` here — electron-builder walks up to
  the repo root and recompiles the server's copy against Electron, breaking `npm run dev`.
  `npmRebuild: false` in `electron-builder.yml` plus the `postinstall` hook keep them apart.
- **Electron is pinned to 42.x on purpose.** better-sqlite3 publishes Electron prebuilds only
  up to ABI 146 (= Electron 42) on npm; Electron 43 is ABI 148. Building from source is not an
  escape hatch here — node-gyp needs Visual Studio and cannot build under a path containing a
  space. Before bumping Electron, check the release assets on
  `github.com/WiseLibs/better-sqlite3` for a matching `electron-vNNN` build.
- **Port 8642 is fixed**, because it is part of the SSO callback URL registered with the EVE
  developer application. If it is taken, the app shows a dialog and quits rather than
  moving; it probes `/api/health` first to tell an already-running Viator from a foreign process.
- **The EVE SSO round-trip stays in-window** (it is ordinary top-level navigation). The
  `will-navigate` guard allows `localhost`, `127.0.0.1` and `*.eveonline.com` and sends anything
  else to the system browser.
- `client/dist` ships as `extraResources` (→ `resources/client`), **outside** the asar, so
  `@fastify/static` reads plain files. `**/*.node` is `asarUnpack`ed — better-sqlite3 cannot
  load its binary from inside an archive.

## Dev loop

`npm run dev` (repo root) then `npm run dev:desktop`. The `--dev-url=http://localhost:5173`
flag makes main.ts **skip the embedded server** entirely and point the window at Vite, so you
get HMR and the Electron-ABI sqlite is never loaded. Vite proxies `/api` and `/sso` to the
tsx-watch server on 8642, and dev `APP_ORIGIN` is 5173, so SSO round-trips too.

For a production-shaped check: `npm run build && npm run build:desktop && npm --prefix desktop start`.
`dev-scripts\run-desktop.bat` (repo root) is that same sequence as a double-clickable script,
with dependency install and Node-missing guards; `--no-build` launches the existing build.

## Releasing

`desktop/package.json`'s `version` is the single source of truth — it names the artifact,
fills `latest.yml`, and is what `app.getVersion()` reports. Bump it, commit, tag `v<version>`,
push the tag; `.github/workflows/release.yml` builds and publishes to GitHub Releases, where
electron-updater picks it up. The workflow fails fast if the tag and the version disagree.

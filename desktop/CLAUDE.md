# desktop — Electron shell

Wraps the existing web app as a Windows desktop app: the Electron main process runs the
Fastify server **in-process** and opens a window on the loopback port that server bound. The
UI is the unmodified React client, served over HTTP exactly as in `npm start`.

**Not an npm workspace.** It has its own `package.json` and lockfile, installed with
`npm ci --prefix desktop`. That isolation is deliberate — see the ABI note below.

## Files

| File | Role |
| --- | --- |
| `src/main.ts` | App lifecycle: single-instance lock, `eveauth-viator://` protocol registration + callback delivery, env injection, server boot, window, navigation guard, updater. Compiled to `dist/main.js` (ESM). |
| `src/preload.cts` | The only bridge between the web UI and Electron: `window.viatorDesktop` (`version`, `openExternal`, `onUpdateReady`). Compiled to `dist/preload.cjs` — preload **must** be CJS. |
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
- **The port is ephemeral.** `main.ts` sets `VIATOR_PORT=0`, so the OS picks; `startServer()`
  returns what it bound and that decides the window's URL. Nothing outside the process needs
  to know it, so the app can no longer refuse to launch because some other program (or a
  stray `npm run dev`, or a Hyper-V/WSL reserved range) holds one particular port. Don't
  reintroduce a fixed port here — the reason one used to be required is gone.
- **SSO login leaves the app entirely and returns through a URL scheme.** The renderer calls
  `viatorDesktop.openExternal(...)` with the authorize URL; the user logs in in their real
  browser; EVE redirects to the **bounce page** (`docs/auth.html` on GitHub Pages), which
  renders "signed in" and then navigates to `eveauth-viator://sso/callback?code=…&state=…`;
  Windows launches a second instance, which loses the single-instance lock, so the **running**
  app receives the URL in its `second-instance` argv (or in `process.argv` on a cold start).
  `deliverSsoCallback()` posts the params to the embedded server's `/api/sso/complete` and
  focuses the window; the Settings page is polling `/api/sso/status` and picks the result up.
  - **Why the bounce page, given the scheme already works?** A custom scheme is not a document.
    Redirecting straight to it makes the browser hand the URL to the OS while the tab stays on
    EVE's half-finished redirect, spinning forever — the auth succeeds but the browser never
    lands anywhere. The page is the only way to give it somewhere to go. Nothing in `main.ts`
    changes either way; only what EVE redirects *to* differs.
  - The scheme is registered by NSIS at install time (`protocols:` in `electron-builder.yml`)
    **and** by `app.setAsDefaultProtocolClient` at runtime — the latter is what makes an
    unpacked `electron .` run testable, and it needs the `execPath` + script form because
    `process.defaultApp` launches would otherwise register a bare Electron.
  - The scheme name must stay in sync in **four** places: `PROTOCOL` here, `protocols.schemes`
    in `electron-builder.yml`, `SSO_PROTOCOL` in `server/src/config.ts`, and the deep link
    hardcoded in `docs/auth.html` (which is deployed separately and can't be changed by an
    app release — see the root `CLAUDE.md`).
  - **The `eveauth-` prefix is mandatory.** CCP's portal only accepts an `https` callback or a
    custom scheme matching `eveauth[a-z0-9+.-]*[a-z0-9]`; a plain `viator://` is rejected when
    you register the application. This is why the scheme reads the way it does.
  - Because the callback carries no port, the app and the EVE registration are decoupled —
    that is what allows the ephemeral port above.
- **Nothing but the app itself loads in the window.** The `will-navigate` guard allows only
  `localhost`/`127.0.0.1` and sends everything else to the system browser. `*.eveonline.com`
  used to be allowed for the in-window login and is deliberately no longer.
- `client/dist` ships as `extraResources` (→ `resources/client`), **outside** the asar, so
  `@fastify/static` reads plain files. `**/*.node` is `asarUnpack`ed — better-sqlite3 cannot
  load its binary from inside an archive.

## Dev loop

`npm run dev` (repo root) then `npm run dev:desktop`. The `--dev-url=http://localhost:5173`
flag makes main.ts **skip the embedded server** entirely and point the window at Vite, so you
get HMR and the Electron-ABI sqlite is never loaded. Vite proxies `/api` and `/sso` to the
tsx-watch server on 8642 — which runs in **web** SSO mode, so a login started from the dev
window comes back over `http://localhost:8642/sso/callback`, not `eveauth-viator://`. To exercise the
protocol path you need a real embedded-server run (`dev-scripts\run-desktop.bat` or an install).

For a production-shaped check: `npm run build && npm run build:desktop && npm --prefix desktop start`.
`dev-scripts\run-desktop.bat` (repo root) is that same sequence as a double-clickable script,
with dependency install and Node-missing guards; `--no-build` launches the existing build.

## Releasing

`desktop/package.json`'s `version` is the single source of truth — it names the artifact,
fills `latest.yml`, and is what `app.getVersion()` reports. Bump it, commit, tag `v<version>`,
push the tag; `.github/workflows/release.yml` builds and publishes to GitHub Releases, where
electron-updater picks it up. The workflow fails fast if the tag and the version disagree.

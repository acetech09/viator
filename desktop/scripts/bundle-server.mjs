// Bundles the Fastify server (plus @viator/shared) into one ESM file the Electron
// main process can import. Runs against server/dist, not server/src: the sources use
// ESM ".js" specifiers that only resolve after tsc has emitted them, so `npm run build`
// at the repo root is a prerequisite.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const entry = path.join(repoRoot, 'server', 'dist', 'server.js');

if (!fs.existsSync(entry)) {
  console.error(`Missing ${entry}\nRun "npm run build" at the repo root first.`);
  process.exit(1);
}

await esbuild.build({
  entryPoints: [entry],
  outfile: path.join(desktopRoot, 'dist', 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // The only native module: loaded at runtime from desktop/node_modules, where it is
  // built against Electron's ABI.
  external: ['better-sqlite3'],
  // Some CJS dependencies reach for `require`, which ESM output doesn't define.
  banner: {
    js: "import { createRequire as __viatorCreateRequire } from 'node:module';\nconst require = __viatorCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});

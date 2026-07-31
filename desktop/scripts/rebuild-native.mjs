// Fetches better-sqlite3's prebuilt binary for the exact Electron version installed here.
//
// Runs as a postinstall hook instead of letting electron-builder rebuild native deps,
// because electron-builder walks up to the repo root and would rebuild the *server's*
// copy against Electron's ABI, breaking `npm run dev`. Downloading a prebuild also
// avoids node-gyp, which needs Visual Studio and cannot build under a path containing
// a space.
//
// If this ever fails with "no prebuilt binaries found", better-sqlite3 has not published
// a build for this Electron ABI yet: pin `electron` down to a major that it covers.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleDir = path.join(desktopRoot, 'node_modules', 'better-sqlite3');
const electronPkg = path.join(desktopRoot, 'node_modules', 'electron', 'package.json');

if (!fs.existsSync(moduleDir) || !fs.existsSync(electronPkg)) {
  console.log('rebuild-native: dependencies not installed yet, skipping.');
  process.exit(0);
}

const electronVersion = JSON.parse(fs.readFileSync(electronPkg, 'utf8')).version;
console.log(`rebuild-native: fetching better-sqlite3 prebuild for Electron ${electronVersion}`);

// Invoke prebuild-install's entry point with node directly. The .bin shims go through
// cmd.exe on Windows, which mangles the space in paths like "C:\Users\P R\...".
const cli = path.join(desktopRoot, 'node_modules', 'prebuild-install', 'bin.js');

const result = spawnSync(
  process.execPath,
  [cli, '--runtime', 'electron', '--target', electronVersion, '--arch', process.arch],
  { cwd: moduleDir, stdio: 'inherit' },
);

if (result.status !== 0) {
  console.error(
    `rebuild-native: no prebuilt better-sqlite3 for Electron ${electronVersion}.\n` +
      'Pin "electron" in desktop/package.json to a major that better-sqlite3 publishes ' +
      'binaries for (see the release assets on github.com/WiseLibs/better-sqlite3).',
  );
  process.exit(1);
}

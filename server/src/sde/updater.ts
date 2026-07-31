import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import type { SdeStatus } from '@viator/shared';
import { getDb } from '../db/db.js';
import { DATA_DIR, SDE_LATEST_URL, SDE_ZIP_URL } from '../config.js';
import { readCentralDirectory, fetchEntry, type ZipEntry } from './zipRange.js';

const NEEDED = ['types.jsonl', 'groups.jsonl', 'categories.jsonl'];

let status: SdeStatus = {
  ready: false,
  build_number: null,
  ingested_at: null,
  updating: false,
  message: null,
};

export function getSdeStatus(): SdeStatus {
  return { ...status };
}

function setMeta(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * True once the `volume` column (added in migration v5) has been backfilled. Existing
 * installs ingested before v5 have all-null volumes at the same build number, so `startSde`
 * uses this to force one re-ingest rather than waiting for the next SDE build.
 */
function volumePopulated(): boolean {
  const row = getDb().prepare('SELECT COUNT(*) n FROM sde_types WHERE volume IS NOT NULL').get() as { n: number };
  return row.n > 0;
}

/** Load current status from the DB (called at boot before any network work). */
function hydrateStatus(): void {
  const build = getMeta('sde_build_number');
  const ingestedAt = getMeta('sde_ingested_at');
  const typeCount = (getDb().prepare('SELECT COUNT(*) n FROM sde_types').get() as { n: number }).n;
  status.build_number = build ? Number(build) : null;
  status.ingested_at = ingestedAt ? Number(ingestedAt) : null;
  status.ready = typeCount > 0;
}

/** Entry point: check for a newer SDE build and ingest it if needed. Non-fatal on error. */
export async function startSde(): Promise<void> {
  hydrateStatus();
  try {
    const latest = await fetchLatestBuild();
    if (latest === null) {
      status.message = status.ready ? null : 'Could not reach the SDE server; static data unavailable.';
      return;
    }
    if (status.ready && status.build_number === latest && volumePopulated()) {
      status.message = null;
      return; // up to date
    }
    await ingestBuild(latest);
  } catch (err) {
    status.updating = false;
    if (!status.ready) status.message = `SDE download failed: ${(err as Error).message}`;
    // eslint-disable-next-line no-console
    console.error('SDE update error:', err);
  }
}

async function fetchLatestBuild(): Promise<number | null> {
  try {
    const res = await fetch(SDE_LATEST_URL);
    if (!res.ok) return null;
    const json = (await res.json()) as { buildNumber?: number };
    return typeof json.buildNumber === 'number' ? json.buildNumber : null;
  } catch {
    return null;
  }
}

async function ingestBuild(build: number): Promise<void> {
  status.updating = true;
  status.message = 'Downloading static data…';

  let files: Map<string, Buffer>;
  try {
    files = await fetchNeededViaRange();
  } catch (err) {
    status.message = 'Downloading full static-data archive…';
    files = await fetchNeededViaFullDownload();
  }

  status.message = 'Importing static data…';
  await ingestFiles(files);

  const now = Date.now();
  setMeta('sde_build_number', String(build));
  setMeta('sde_ingested_at', String(now));
  status.build_number = build;
  status.ingested_at = now;
  status.ready = true;
  status.updating = false;
  status.message = null;
  shipTypeIds = null; // invalidate cache
}

async function fetchNeededViaRange(): Promise<Map<string, Buffer>> {
  const { finalUrl, entries } = await readCentralDirectory(SDE_ZIP_URL);
  const out = new Map<string, Buffer>();
  for (const name of NEEDED) {
    const entry = entries.get(name);
    if (!entry) throw new Error(`entry ${name} not found in archive`);
    out.set(name, await fetchEntry(finalUrl, entry as ZipEntry));
  }
  return out;
}

async function fetchNeededViaFullDownload(): Promise<Map<string, Buffer>> {
  // Stream the full zip to disk, then extract needed entries with yauzl-free parsing.
  const zipPath = path.join(DATA_DIR, 'sde-download.zip');
  const res = await fetch(SDE_ZIP_URL, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`full download failed: HTTP ${res.status}`);
  const fileStream = fs.createWriteStream(zipPath);
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(res.body as any)
      .pipe(fileStream)
      .on('finish', () => resolve())
      .on('error', reject);
  });
  try {
    return extractFromLocalZip(zipPath);
  } finally {
    fs.rmSync(zipPath, { force: true });
  }
}

/** Parse a local zip file's central directory and inflate the needed entries. */
function extractFromLocalZip(zipPath: string): Map<string, Buffer> {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65_536 + 22);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('EOCD not found in downloaded zip');
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);

    const out = new Map<string, Buffer>();
    let p = 0;
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const lho = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      if (NEEDED.includes(name)) {
        const lh = Buffer.alloc(30);
        fs.readSync(fd, lh, 0, 30, lho);
        const lNameLen = lh.readUInt16LE(26);
        const lExtraLen = lh.readUInt16LE(28);
        const dataStart = lho + 30 + lNameLen + lExtraLen;
        const comp = Buffer.alloc(compSize);
        fs.readSync(fd, comp, 0, compSize, dataStart);
        out.set(name, method === 8 ? zlib.inflateRawSync(comp) : comp);
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    for (const name of NEEDED) if (!out.has(name)) throw new Error(`entry ${name} missing from zip`);
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

async function ingestFiles(files: Map<string, Buffer>): Promise<void> {
  const db = getDb();

  const ingest = db.transaction(() => {
    db.exec('DELETE FROM sde_types; DELETE FROM sde_groups; DELETE FROM sde_categories;');

    const catStmt = db.prepare('INSERT INTO sde_categories(category_id, name, published) VALUES(?, ?, ?)');
    for (const rec of iterRecords(files.get('categories.jsonl')!)) {
      catStmt.run(rec._key, nameEn(rec), rec.published ? 1 : 0);
    }

    const grpStmt = db.prepare('INSERT INTO sde_groups(group_id, name, category_id, published) VALUES(?, ?, ?, ?)');
    for (const rec of iterRecords(files.get('groups.jsonl')!)) {
      grpStmt.run(rec._key, nameEn(rec), rec.categoryID ?? 0, rec.published ? 1 : 0);
    }

    const typeStmt = db.prepare(
      'INSERT INTO sde_types(type_id, name, group_id, market_group_id, published, volume) VALUES(?, ?, ?, ?, ?, ?)',
    );
    for (const rec of iterRecords(files.get('types.jsonl')!)) {
      const name = nameEn(rec);
      if (name === null) continue; // skip nameless system rows
      const volume = typeof rec.volume === 'number' ? rec.volume : null;
      typeStmt.run(rec._key, name, rec.groupID ?? 0, rec.marketGroupID ?? null, rec.published ? 1 : 0, volume);
    }
  });
  ingest();
}

function* iterRecords(buf: Buffer): Generator<any> {
  // Split on newlines; JSONL is one object per line. Buffers here are already in memory.
  const text = buf.toString('utf8');
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      const line = text.slice(start, i).trim();
      start = i + 1;
      if (line) yield JSON.parse(line);
    }
  }
  const last = text.slice(start).trim();
  if (last) yield JSON.parse(last);
}

function nameEn(rec: any): string | null {
  const n = rec?.name;
  if (typeof n === 'string') return n;
  if (n && typeof n.en === 'string') return n.en;
  return null;
}

// --- Ship type set (SDE category 6) for the asset pipeline ---
let shipTypeIds: Set<number> | null = null;

export function getShipTypeIds(): Set<number> {
  if (shipTypeIds) return shipTypeIds;
  const rows = getDb()
    .prepare(
      `SELECT t.type_id FROM sde_types t
       JOIN sde_groups g ON g.group_id = t.group_id
       WHERE g.category_id = 6`,
    )
    .all() as Array<{ type_id: number }>;
  shipTypeIds = new Set(rows.map((r) => r.type_id));
  return shipTypeIds;
}

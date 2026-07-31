import zlib from 'node:zlib';

// Minimal ZIP central-directory reader that pulls individual entries out of a remote
// zip using HTTP range requests, so we download ~23 MB (types+groups+categories)
// instead of the full ~98 MB SDE archive. Assumes a non-zip64 archive (the SDE is well
// under 4 GB); callers fall back to a full download if anything here throws.

const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;

export interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  compSize: number;
  localHeaderOffset: number;
}

async function fetchRange(url: string, start: number, end: number): Promise<Buffer> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`range request failed: HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function resolve(url: string): Promise<{ finalUrl: string; size: number }> {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!res.ok) throw new Error(`HEAD failed: HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length'));
  if (!Number.isFinite(len) || len <= 0) throw new Error('missing content-length');
  if (res.headers.get('accept-ranges') !== 'bytes') throw new Error('server does not accept ranges');
  return { finalUrl: res.url || url, size: len };
}

/** Read the central directory and return a map of entry name -> ZipEntry. */
export async function readCentralDirectory(url: string): Promise<{ finalUrl: string; entries: Map<string, ZipEntry> }> {
  const { finalUrl, size } = await resolve(url);

  // EOCD is within the last 64 KB (no zip comment expected, but be generous).
  const tailLen = Math.min(size, 65_536 + 22);
  const tail = await fetchRange(finalUrl, size - tailLen, size - 1);

  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD not found');

  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new Error('zip64 not supported');

  // The central directory may already be inside our tail buffer; otherwise fetch it.
  let cd: Buffer;
  const cdStartInTail = tail.length - (size - cdOffset);
  if (cdStartInTail >= 0) {
    cd = tail.subarray(cdStartInTail, cdStartInTail + cdSize);
  } else {
    cd = await fetchRange(finalUrl, cdOffset, cdOffset + cdSize - 1);
  }

  const entries = new Map<string, ZipEntry>();
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === CDFH_SIG) {
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localHeaderOffset = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.set(name, { name, method, compSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (entries.size === 0) throw new Error('no central-directory entries parsed');
  return { finalUrl, entries };
}

/** Fetch a single entry's bytes and return the decompressed buffer. */
export async function fetchEntry(finalUrl: string, entry: ZipEntry): Promise<Buffer> {
  // Read the local file header (30 fixed bytes) to learn the variable name/extra lengths.
  const lh = await fetchRange(finalUrl, entry.localHeaderOffset, entry.localHeaderOffset + 29);
  const nameLen = lh.readUInt16LE(26);
  const extraLen = lh.readUInt16LE(28);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const data = await fetchRange(finalUrl, dataStart, dataStart + entry.compSize - 1);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`unsupported compression method ${entry.method}`);
}

import { getDb } from '../db/db.js';
import { getSettings } from '../settings.js';
import { refreshAccessToken } from './sso.js';

interface CharRow {
  character_id: number;
  refresh_token: string;
  access_token: string | null;
  access_token_expires: number | null;
  needs_reauth: number;
}

// Avoid concurrent refreshes of the same character.
const inFlight = new Map<number, Promise<string>>();

/** Return a valid access token for a character, refreshing proactively when near expiry. */
export async function getAccessToken(characterId: number): Promise<string> {
  const db = getDb();
  const row = db
    .prepare('SELECT character_id, refresh_token, access_token, access_token_expires, needs_reauth FROM characters WHERE character_id = ?')
    .get(characterId) as CharRow | undefined;
  if (!row) throw new Error(`unknown character ${characterId}`);
  if (row.needs_reauth) throw new Error(`character ${characterId} needs re-authorization`);

  const now = Date.now();
  if (row.access_token && row.access_token_expires && row.access_token_expires - now > 60_000) {
    return row.access_token;
  }

  const existing = inFlight.get(characterId);
  if (existing) return existing;

  const p = doRefresh(characterId, row.refresh_token).finally(() => inFlight.delete(characterId));
  inFlight.set(characterId, p);
  return p;
}

async function doRefresh(characterId: number, refreshToken: string): Promise<string> {
  const db = getDb();
  const clientId = getSettings().client_id;
  if (!clientId) throw new Error('no client_id configured');
  try {
    const tokens = await refreshAccessToken(clientId, refreshToken);
    const expires = Date.now() + tokens.expires_in * 1000;
    db.prepare(
      'UPDATE characters SET access_token = ?, access_token_expires = ?, refresh_token = ?, needs_reauth = 0 WHERE character_id = ?',
    ).run(tokens.access_token, expires, tokens.refresh_token, characterId);
    return tokens.access_token;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'invalid_grant') {
      db.prepare('UPDATE characters SET needs_reauth = 1 WHERE character_id = ?').run(characterId);
    }
    throw err;
  }
}

import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/db.js';
import { getSettings } from '../settings.js';
import { APP_ORIGIN } from '../config.js';
import type { CharacterSummary } from '@viator/shared';
import { buildAuthorizeUrl, createPkce, exchangeCode, randomState, verifyToken } from '../esi/sso.js';

// Short-lived store of in-progress auth attempts (state -> verifier). Localhost, single user.
const pending = new Map<string, { verifier: string; createdAt: number }>();
const STATE_TTL = 10 * 60 * 1000;

function gcPending() {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > STATE_TTL) pending.delete(k);
}

export async function ssoRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  app.get('/api/characters', async () => {
    return db
      .prepare('SELECT character_id, name, needs_reauth, added_at FROM characters ORDER BY added_at')
      .all()
      .map((r: any) => ({
        character_id: r.character_id,
        name: r.name,
        needs_reauth: !!r.needs_reauth,
        added_at: r.added_at,
      })) as CharacterSummary[];
  });

  app.delete('/api/characters/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const info = db.prepare('DELETE FROM characters WHERE character_id = ?').run(id);
    if (info.changes === 0) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  // Start the PKCE flow.
  app.get('/sso/login', async (req, reply) => {
    const { client_id } = getSettings();
    if (!client_id) return reply.code(400).send('Set a Client ID in Settings first.');
    gcPending();
    const state = randomState();
    const pkce = createPkce();
    pending.set(state, { verifier: pkce.verifier, createdAt: Date.now() });
    return reply.redirect(buildAuthorizeUrl(client_id, state, pkce.challenge));
  });

  // Handle the redirect back from EVE SSO.
  app.get('/sso/callback', async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) return reply.code(400).send('Missing code/state.');
    const entry = state ? pending.get(state) : undefined;
    if (!entry) return reply.code(400).send('Invalid or expired login attempt. Please try again.');
    pending.delete(state);

    const { client_id } = getSettings();
    try {
      const tokens = await exchangeCode(client_id, code, entry.verifier);
      const verified = await verifyToken(tokens.access_token, client_id);
      const now = Date.now();
      db.prepare(
        `INSERT INTO characters(character_id, name, refresh_token, access_token, access_token_expires, scopes, added_at, needs_reauth)
         VALUES(?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(character_id) DO UPDATE SET
           name = excluded.name,
           refresh_token = excluded.refresh_token,
           access_token = excluded.access_token,
           access_token_expires = excluded.access_token_expires,
           scopes = excluded.scopes,
           needs_reauth = 0`,
      ).run(
        verified.characterId,
        verified.name,
        tokens.refresh_token,
        tokens.access_token,
        now + tokens.expires_in * 1000,
        verified.scopes.join(' '),
        now,
      );
      return reply.redirect(`${APP_ORIGIN}/settings`);
    } catch (err) {
      app.log.error({ err }, 'SSO callback failed');
      return reply.code(500).send(`Authorization failed: ${(err as Error).message}`);
    }
  });
}

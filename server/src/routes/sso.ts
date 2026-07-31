import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/db.js';
import { getSettings } from '../settings.js';
import { APP_ORIGIN, SSO_MODE } from '../config.js';
import type { CharacterSummary, SsoStart, SsoStatus } from '@viator/shared';
import { buildAuthorizeUrl, createPkce, exchangeCode, randomState, verifyToken } from '../esi/sso.js';

/**
 * In-progress auth attempts, keyed by the OAuth `state`. Localhost, single user, so an
 * in-memory map is enough — but it does mean an attempt does not survive an app restart,
 * which the status endpoint reports as an expired attempt.
 *
 * The result lives here too: the browser half of the flow finishes somewhere the originating
 * page can't see (a tab in the user's default browser, or Electron's protocol handler), so
 * that page polls `/api/sso/status` for the outcome instead of being redirected to it.
 */
interface Attempt {
  verifier: string;
  createdAt: number;
  result: null | { ok: true; character: CharacterSummary } | { ok: false; message: string };
}

const pending = new Map<string, Attempt>();
/** Generous, because the user now leaves the app entirely to log in and may get distracted. */
const STATE_TTL = 30 * 60 * 1000;

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

  /**
   * Begin a PKCE flow. Returns the authorize URL rather than redirecting to it — the client
   * opens it in the user's real browser (password manager, existing EVE session) instead of
   * navigating the app window into a login page.
   */
  app.post('/api/sso/start', async (_req, reply) => {
    const { client_id } = getSettings();
    if (!client_id) return reply.code(400).send({ error: 'no_application' });
    gcPending();
    const state = randomState();
    const pkce = createPkce();
    pending.set(state, { verifier: pkce.verifier, createdAt: Date.now(), result: null });
    return { state, url: buildAuthorizeUrl(client_id, state, pkce.challenge) } satisfies SsoStart;
  });

  /** Poll target for the page that called `/api/sso/start`. */
  app.get('/api/sso/status', async (req) => {
    const { state } = req.query as { state?: string };
    const entry = state ? pending.get(state) : undefined;
    if (!entry) return { status: 'error', message: 'This login attempt expired. Please try again.' } satisfies SsoStatus;
    if (!entry.result) return { status: 'pending' } satisfies SsoStatus;
    return (
      entry.result.ok
        ? { status: 'done', character: entry.result.character }
        : { status: 'error', message: entry.result.message }
    ) satisfies SsoStatus;
  });

  /**
   * Desktop callback sink. Windows hands `eveauth-viator://sso/callback?code=…&state=…` to the
   * Electron shell, which posts the parameters here (the server runs in that same process,
   * over loopback). Web mode uses `GET /sso/callback` below instead.
   */
  app.post('/api/sso/complete', async (req, reply) => {
    const { code, state } = (req.body ?? {}) as { code?: string; state?: string };
    if (!code || !state) return reply.code(400).send({ error: 'missing_code_or_state' });
    return finishAuth(code, state);
  });

  /**
   * Web callback: EVE redirects the user's browser here. The originating page is polling
   * `/api/sso/status`, so this only has to record the outcome and tell the user they can go
   * back to the app — it deliberately does not redirect, since the browser tab that lands
   * here is usually not the tab Viator is open in.
   */
  app.get('/sso/callback', async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    reply.type('text/html; charset=utf-8');
    if (!code || !state) return reply.code(400).send(resultPage({ status: 'error', message: 'Missing code/state.' }));
    return reply.send(resultPage(await finishAuth(code, state)));
  });

  /**
   * Exchange the code and store the character, recording the outcome under `state` for the
   * waiting page. Both callback paths funnel through here.
   */
  async function finishAuth(code: string, state: string): Promise<SsoStatus> {
    const entry = pending.get(state);
    if (!entry) return { status: 'error', message: 'This login attempt expired. Please try again.' };
    // An authorization code is single-use, so a re-delivered callback replays the stored
    // outcome instead of asking EVE to exchange the same code twice.
    if (entry.result) {
      return entry.result.ok
        ? { status: 'done', character: entry.result.character }
        : { status: 'error', message: entry.result.message };
    }

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
      const character: CharacterSummary = {
        character_id: verified.characterId,
        name: verified.name,
        needs_reauth: false,
        added_at: now,
      };
      entry.result = { ok: true, character };
      return { status: 'done', character };
    } catch (err) {
      app.log.error({ err }, 'SSO callback failed');
      const message = friendlyAuthError(err as Error & { code?: string });
      entry.result = { ok: false, message };
      return { status: 'error', message };
    }
  }
}

/**
 * The message shown in the app. EVE answers a bad token request with an HTML error page, so
 * the raw failure is unfit for a toast — the full error is logged instead. `invalid_client`
 * is worth naming, because the likely cause is a Client ID registered against a different
 * callback URL than this build uses.
 */
function friendlyAuthError(err: Error & { code?: string }): string {
  switch (err.code) {
    case 'invalid_client':
      return 'EVE rejected the Client ID. Check that your application is registered with the callback URL shown under Settings → Advanced.';
    case 'invalid_grant':
      return 'EVE rejected the authorization code — it may already have been used. Please try again.';
    default:
      return 'Authorization failed. Please try again.';
  }
}

/**
 * The page the user's browser is left on after logging in. Self-contained (no app assets —
 * this tab may be in a different browser than the one that has Viator open) and deliberately
 * plain: the real feedback is the app window updating itself.
 */
function resultPage(result: SsoStatus): string {
  const ok = result.status === 'done';
  const heading = ok ? `${escapeHtml(result.character.name)} is authorized` : 'Authorization failed';
  const detail = ok
    ? 'You can close this tab and go back to Viator — the character is already there.'
    : escapeHtml(result.status === 'error' ? result.message : '');
  // Desktop mode never serves this page, so a link back to the app is always the web origin.
  const back = SSO_MODE === 'web' ? `<p><a href="${APP_ORIGIN}/settings">Open Viator settings</a></p>` : '';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Viator — ${ok ? 'Signed in' : 'Sign-in failed'}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #0e1116; color: #d7dde5; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 32rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .75rem; color: ${ok ? '#7fd1a0' : '#e58b8b'}; }
  p { margin: .5rem 0; color: #98a3b3; }
  a { color: #6ea8fe; }
</style></head>
<body><main><h1>${heading}</h1><p>${detail}</p>${back}</main></body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

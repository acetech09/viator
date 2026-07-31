import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { SSO_AUTHORIZE, SSO_REDIRECT, SSO_SCOPES, SSO_TOKEN } from '../config.js';

const JWKS = createRemoteJWKSet(new URL('https://login.eveonline.com/oauth/jwks'));
const ISSUERS = ['https://login.eveonline.com', 'login.eveonline.com'];

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function createPkce(): Pkce {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64url(crypto.randomBytes(16));
}

export function buildAuthorizeUrl(clientId: string, state: string, challenge: string): string {
  const url = new URL(SSO_AUTHORIZE);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', SSO_REDIRECT);
  url.searchParams.set('scope', SSO_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export async function exchangeCode(clientId: string, code: string, verifier: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    code_verifier: verifier,
  });
  return tokenRequest(body);
}

export async function refreshAccessToken(clientId: string, refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  return tokenRequest(body);
}

async function tokenRequest(body: URLSearchParams): Promise<TokenSet> {
  const res = await fetch(SSO_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Host: 'login.eveonline.com',
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`SSO token request failed (${res.status}): ${text.slice(0, 200)}`) as Error & {
      status?: number;
      code?: string;
    };
    err.status = res.status;
    try {
      err.code = JSON.parse(text).error;
    } catch {
      /* ignore */
    }
    throw err;
  }
  return JSON.parse(text) as TokenSet;
}

export interface VerifiedChar {
  characterId: number;
  name: string;
  scopes: string[];
}

/** Validate an access-token JWT and pull out the character id + name. */
export async function verifyToken(accessToken: string, clientId: string): Promise<VerifiedChar> {
  const { payload } = await jwtVerify(accessToken, JWKS, {
    issuer: ISSUERS,
    audience: clientId,
  });
  const sub = String(payload.sub ?? ''); // "CHARACTER:EVE:<id>"
  const m = /^CHARACTER:EVE:(\d+)$/.exec(sub);
  if (!m) throw new Error(`unexpected sub claim: ${sub}`);
  const characterId = Number(m[1]);
  const name = String((payload as Record<string, unknown>).name ?? '');
  const rawScopes = (payload as Record<string, unknown>).scp;
  const scopes = Array.isArray(rawScopes) ? rawScopes.map(String) : rawScopes ? [String(rawScopes)] : [];
  return { characterId, name, scopes };
}

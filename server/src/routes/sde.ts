import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/db.js';
import { getSdeStatus } from '../sde/updater.js';

/**
 * Categories nobody is shopping for when they type a ship/module name: Blueprint (9),
 * Apparel (30), SKINs (91) and Personalization (2118, SKINR sequencers/patterns). Together
 * that's ~8.8k of the ~19k searchable types, and SKINs alone outnumber every real module.
 * They still appear in search, just sorted below every ordinary match (see the client's
 * `useTypesIndex`). Deliberately NOT demoted: Accessories (5) — skill injectors/extractors
 * and Aurum tokens are things people genuinely buy.
 */
const DEMOTED_CATEGORIES = new Set([9, 30, 91, 2118]);

/**
 * Name fallback for cosmetics that live outside those categories — chiefly the SKIN crates
 * and bundles filed under Special Edition Assets (63), a category that also holds ordinary
 * tradeables, so it can't be demoted wholesale.
 */
const DEMOTED_NAME_RE = /\bSKINs?\b/i;

/** Bumped when the payload shape changes, so cached clients don't 304 onto the old shape. */
const INDEX_SHAPE = 2;

export async function sdeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sde/status', async () => getSdeStatus());

  // Compact [ [typeId, name, demoted?], ... ] index of market-published types for client-side
  // fuzzy search; `demoted` is 1 for cosmetics/blueprints, absent otherwise.
  // ETagged by SDE build so the client caches it until the next SDE update.
  app.get('/api/sde/types-index', async (req, reply) => {
    const status = getSdeStatus();
    if (!status.ready) return reply.code(503).send({ error: 'sde_not_ready' });

    const etag = `"sde-${status.build_number}-s${INDEX_SHAPE}"`;
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();

    const rows = getDb()
      .prepare(
        `SELECT t.type_id, t.name, g.category_id
         FROM sde_types t
         LEFT JOIN sde_groups g ON g.group_id = t.group_id
         WHERE t.published = 1 AND t.market_group_id IS NOT NULL
         ORDER BY t.name COLLATE NOCASE`,
      )
      .all() as Array<{ type_id: number; name: string; category_id: number | null }>;

    reply.header('ETag', etag);
    reply.header('Cache-Control', 'no-cache');
    return rows.map((r) => {
      const demoted =
        (r.category_id !== null && DEMOTED_CATEGORIES.has(r.category_id)) || DEMOTED_NAME_RE.test(r.name);
      return demoted ? [r.type_id, r.name, 1] : [r.type_id, r.name];
    });
  });
}

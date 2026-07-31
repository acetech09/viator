import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/db.js';
import { getSdeStatus } from '../sde/updater.js';

export async function sdeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sde/status', async () => getSdeStatus());

  // Compact [ [typeId, name], ... ] index of market-published types for client-side fuzzy
  // search. ETagged by SDE build so the client caches it until the next SDE update.
  app.get('/api/sde/types-index', async (req, reply) => {
    const status = getSdeStatus();
    if (!status.ready) return reply.code(503).send({ error: 'sde_not_ready' });

    const etag = `"sde-${status.build_number}"`;
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();

    const rows = getDb()
      .prepare(
        `SELECT type_id, name FROM sde_types
         WHERE published = 1 AND market_group_id IS NOT NULL
         ORDER BY name COLLATE NOCASE`,
      )
      .all() as Array<{ type_id: number; name: string }>;

    reply.header('ETag', etag);
    reply.header('Cache-Control', 'no-cache');
    return rows.map((r) => [r.type_id, r.name]);
  });
}

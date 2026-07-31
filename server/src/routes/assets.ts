import type { FastifyInstance } from 'fastify';
import type { DefaultLocation, LocationSummary } from '@viator/shared';
import { getDb } from '../db/db.js';
import { allCharacterIds, getRefreshStatuses, refreshCharacterAssets } from '../assets/pipeline.js';

export async function assetsRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  // Refresh all characters (respects per-character cooldown unless force=1).
  app.post('/api/assets/refresh', async (req) => {
    const force = (req.query as { force?: string }).force === '1';
    const ids = allCharacterIds();
    // Sequential keeps us gentle on the ESI error budget; the client shows a spinner.
    for (const id of ids) await refreshCharacterAssets(id, force);
    return getRefreshStatuses();
  });

  app.get('/api/assets/status', async () => getRefreshStatuses());

  // Locations where a character has (included) assets, richest first.
  app.get('/api/characters/:id/locations', async (req) => {
    const characterId = Number((req.params as { id: string }).id);
    const rows = db
      .prepare(
        `SELECT a.root_location_id AS location_id,
                COUNT(DISTINCT a.type_id) AS unique_types,
                ln.name AS name, ln.kind AS kind
         FROM assets a
         LEFT JOIN location_names ln ON ln.location_id = a.root_location_id
         WHERE a.character_id = ? AND a.included = 1
         GROUP BY a.root_location_id
         ORDER BY unique_types DESC`,
      )
      .all(characterId) as Array<{ location_id: number; unique_types: number; name: string | null; kind: string | null }>;
    return rows.map((r) => ({
      location_id: r.location_id,
      name: r.name ?? `${r.kind === 'structure' ? 'Structure' : 'Location'} ${r.location_id}`,
      kind: (r.kind as 'station' | 'structure') ?? 'station',
      unique_types: r.unique_types,
    })) satisfies LocationSummary[];
  });

  // --- Default filter locations (per zone: 'purchase' | 'destination') ---
  app.get('/api/default-locations', async () => {
    return db
      .prepare(
        `SELECT dl.character_id, c.name AS character_name, dl.location_id, dl.zone, ln.name AS location_name
         FROM default_locations dl
         JOIN characters c ON c.character_id = dl.character_id
         LEFT JOIN location_names ln ON ln.location_id = dl.location_id
         ORDER BY c.name`,
      )
      .all()
      .map((r: any) => ({
        character_id: r.character_id,
        character_name: r.character_name,
        location_id: r.location_id,
        location_name: r.location_name ?? `Location ${r.location_id}`,
        zone: r.zone === 'destination' ? 'destination' : 'purchase',
      })) satisfies DefaultLocation[];
  });

  app.post('/api/default-locations', async (req, reply) => {
    const { character_id, location_id, zone } = (req.body ?? {}) as {
      character_id?: number;
      location_id?: number;
      zone?: string;
    };
    if (!character_id || !location_id) return reply.code(400).send({ error: 'missing_fields' });
    const z = zone === 'destination' ? 'destination' : 'purchase';
    db.prepare('INSERT OR IGNORE INTO default_locations(character_id, location_id, zone) VALUES(?, ?, ?)').run(
      character_id,
      location_id,
      z,
    );
    return { ok: true };
  });

  app.delete('/api/default-locations/:characterId/:locationId/:zone', async (req, reply) => {
    const characterId = Number((req.params as { characterId: string }).characterId);
    const locationId = Number((req.params as { locationId: string }).locationId);
    const zone = (req.params as { zone: string }).zone === 'destination' ? 'destination' : 'purchase';
    const info = db
      .prepare('DELETE FROM default_locations WHERE character_id = ? AND location_id = ? AND zone = ?')
      .run(characterId, locationId, zone);
    if (info.changes === 0) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });
}

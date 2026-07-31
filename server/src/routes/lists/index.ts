import type { FastifyInstance } from 'fastify';
import { listCrudRoutes } from './crud.js';
import { groupRoutes } from './groups.js';
import { stockRoutes } from './stock.js';

/**
 * All `/api/lists` routes, split by domain:
 *   - crud.ts   — lists CRUD/duplicate, item add/edit/remove, bulk import, priced view
 *   - groups.ts — add-groups + ship fits (incl. groupless↔grouped promotion/demotion)
 *   - stock.ts  — existing-stock sources: filters, bucket selections, asset pastes
 * Shared db helpers + the groupless/grouped invariants live in helpers.ts.
 */
export async function listsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(listCrudRoutes);
  await app.register(groupRoutes);
  await app.register(stockRoutes);
}

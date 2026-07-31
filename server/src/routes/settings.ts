import type { FastifyInstance } from 'fastify';
import { getSettings, updateSettings } from '../settings.js';
import type { Settings } from '@viator/shared';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => getSettings());

  app.put('/api/settings', async (req) => {
    const patch = req.body as Partial<Settings>;
    return updateSettings(patch ?? {});
  });
}

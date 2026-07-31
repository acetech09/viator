import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { getDb, closeDb } from './db/db.js';
import { CLIENT_DIST, HOST, PORT, ensureDataDir, isDev } from './config.js';
import { settingsRoutes } from './routes/settings.js';
import { listsRoutes } from './routes/lists/index.js';
import { sdeRoutes } from './routes/sde.js';
import { ssoRoutes } from './routes/sso.js';
import { assetsRoutes } from './routes/assets.js';
import { startSde } from './sde/updater.js';
import { backfillAssetBuckets } from './assets/pipeline.js';

export interface RunningServer {
  app: FastifyInstance;
  /**
   * The port actually bound. Equal to `PORT` unless that was 0 (the desktop shell asks for
   * an ephemeral port), in which case it is whatever the OS handed out — the shell needs it
   * to know which URL to load.
   */
  port: number;
  /** Stops accepting requests and closes the database (checkpointing WAL). */
  close(): Promise<void>;
}

/**
 * Boots the whole backend and resolves once it is listening.
 *
 * Callers own the lifecycle: `listen` errors reject rather than exiting the process, so the
 * desktop shell can show a dialog.
 */
export async function startServer(): Promise<RunningServer> {
  ensureDataDir();
  getDb(); // opens + migrates

  const app = Fastify({ logger: { level: isDev ? 'info' : 'warn' } });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(settingsRoutes);
  await app.register(sdeRoutes);
  await app.register(listsRoutes);
  await app.register(ssoRoutes);
  await app.register(assetsRoutes);

  // Serve the built client in production (single process, single port).
  if (!isDev && fs.existsSync(CLIENT_DIST)) {
    const fastifyStatic = (await import('@fastify/static')).default;
    await app.register(fastifyStatic, { root: CLIENT_DIST, wildcard: false });
    // SPA fallback: any non-API GET returns index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/sso')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found' });
    });
  }

  // One-time reclassify of stored assets into v6 buckets (no-op once done / on a fresh DB).
  try {
    backfillAssetBuckets();
  } catch (err) {
    app.log.error({ err }, 'asset bucket backfill failed');
  }

  // Kick off SDE version check / ingest in the background; the client polls status.
  startSde().catch((err) => app.log.error({ err }, 'SDE bootstrap failed'));

  await app.listen({ port: PORT, host: HOST });
  // With PORT=0 the requested port tells us nothing; ask the socket what it got.
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  app.log.info(`viator server listening on http://${HOST}:${port}`);

  return {
    app,
    port,
    close: async () => {
      await app.close();
      closeDb();
    },
  };
}

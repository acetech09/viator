// CLI entry point: `npm start` / `tsx watch src/index.ts`.
// The desktop shell calls startServer() directly instead of running this file.
import { startServer } from './server.js';

async function main() {
  const { close } = await startServer();

  const shutdown = () => {
    close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

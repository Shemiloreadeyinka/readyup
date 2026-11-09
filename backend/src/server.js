import fs from 'node:fs/promises';
import createApp from './app.js';
import config from './config/index.js';
import logger from './utils/logger.js';

/** Removes anything left in the temp directory by a previous run. */
async function cleanTempDirectory() {
  try {
    const entries = await fs.readdir(config.paths.tmpDir);
    await Promise.all(
      entries.map((entry) =>
        fs.rm(`${config.paths.tmpDir}/${entry}`, { recursive: true, force: true }),
      ),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('Could not clean the temp directory:', error.message);
  }
}

async function main() {
  await fs.mkdir(config.paths.dataDir, { recursive: true });
  await fs.mkdir(config.paths.tmpDir, { recursive: true });
  await cleanTempDirectory();

  const app = createApp();

  // Bind to loopback only: this backend is never meant to be reachable from
  // the network.
  const server = app.listen(config.port, '127.0.0.1', () => {
    logger.info(`CV Tailor backend listening on http://127.0.0.1:${config.port}`);
    logger.info(`Default AI provider: ${config.defaultProvider}`);
    logger.info(`Data directory: ${config.paths.dataDir}`);
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down.`);
    server.close(() => {
      cleanTempDirectory().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason));
}

main().catch((error) => {
  logger.error('Failed to start:', error);
  process.exit(1);
});

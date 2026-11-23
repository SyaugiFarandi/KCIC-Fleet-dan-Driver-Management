import { buildApp } from './app.js';
import { assertProductionConfig, config } from './config.js';
import { prisma } from './db.js';
import { logger } from './lib/logger.js';
import { startGpsSimulator } from './lib/gpsSimulator.js';

assertProductionConfig();

const app = buildApp();
const server = app.listen(config.port, () => {
  logger.info('server_started', {
    port: config.port,
    environment: config.env,
    gpsSimulator: config.gpsSimulatorEnabled && !config.isTest ? 'active' : 'disabled',
  });
  if (config.gpsSimulatorEnabled && !config.isTest) {
    startGpsSimulator({ intervalMs: config.gpsSimulatorIntervalMs });
  } else {
    logger.info('gps_simulator_disabled', { reason: 'DEMO GPS telemetry will not advance' });
  }
});

async function shutdown(signal, exitCode = 0) {
  logger.info('server_shutdown', { signal, exitCode });
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(exitCode);
  });
  setTimeout(() => process.exit(exitCode || 1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { error: reason instanceof Error ? reason.message : String(reason) });
});
process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException', 1);
});

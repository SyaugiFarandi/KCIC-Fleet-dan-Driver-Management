import { buildApp } from './app.js';
import { assertProductionConfig, config } from './config.js';
import { prisma } from './db.js';
import { startGpsSimulator } from './lib/gpsSimulator.js';

assertProductionConfig();

const app = buildApp();
const server = app.listen(config.port, () => {
  console.log(`KCIC Fleet API listening on http://localhost:${config.port} (${config.env})`);
  if (config.gpsSimulatorEnabled && !config.isTest) {
    startGpsSimulator({ intervalMs: config.gpsSimulatorIntervalMs });
  } else {
    console.log('[gps-sim] disabled (DEMO GPS telemetry will not advance)');
  }
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

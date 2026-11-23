import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { DEMO_GPS_SOURCE, OFFLINE_AFTER_MS } from './gps.js';

/**
 * GPS provider adapter boundary. The demo simulator stays the default source;
 * DEVICE_WEBHOOK is a prepared ingest path for a real provider and only reports
 * LIVE once a registered device actually sends telemetry through it.
 */
export const DEVICE_PROVIDER_ID = 'DEVICE_WEBHOOK';
export const LIVE_GPS_SOURCE = 'DEVICE';
export const LIVE_GPS_DISCLAIMER =
  'Status LIVE hanya berlaku untuk telemetri perangkat GPS terdaftar yang dikirim melalui endpoint ingest terkonfigurasi. Data simulator demo tidak pernah dihitung sebagai LIVE.';

const staleEnvMs = Number(process.env.GPS_STALE_AFTER_MS || 60000);
export const STALE_AFTER_MS = Math.min(
  OFFLINE_AFTER_MS,
  Math.max(30000, Number.isFinite(staleEnvMs) ? staleEnvMs : 60000)
);

export const TELEMETRY_MODES = ['SIMULATED', 'LIVE', 'STALE', 'OFFLINE'];

export function gpsIngestConfigured() {
  return Boolean(config.gpsIngestToken);
}

export function verifyGpsIngestToken(provided) {
  if (!gpsIngestConfigured()) return false;
  const supplied = Buffer.from(String(provided || ''));
  const expected = Buffer.from(config.gpsIngestToken);
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

export function gpsProviderInfo() {
  const ingestEnabled = gpsIngestConfigured();
  return {
    modes: TELEMETRY_MODES,
    provider: ingestEnabled ? DEVICE_PROVIDER_ID : DEMO_GPS_SOURCE,
    ingestEnabled,
    simulatorEnabled: config.gpsSimulatorEnabled,
    staleAfterSeconds: Math.round(STALE_AFTER_MS / 1000),
    offlineAfterSeconds: Math.round(OFFLINE_AFTER_MS / 1000),
    liveDisclaimer: LIVE_GPS_DISCLAIMER,
  };
}

/**
 * Classifies the latest position so the UI never presents simulated data as a
 * live device fix. Fresh simulator coordinates are SIMULATED; a fresh position
 * from a non-simulator source needs a registered ACTIVE device to be LIVE.
 */
export function telemetryStatus(location, device, now = Date.now()) {
  if (!location) return 'OFFLINE';
  const age = now - new Date(location.recordedAt).getTime();
  if (!Number.isFinite(age) || age > OFFLINE_AFTER_MS) return 'OFFLINE';
  if (age > STALE_AFTER_MS) return 'STALE';
  if (location.source === DEMO_GPS_SOURCE) return 'SIMULATED';
  if (!device || device.status !== 'ACTIVE') return 'OFFLINE';
  return 'LIVE';
}

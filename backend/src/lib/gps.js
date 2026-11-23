/**
 * Shared helpers for the DEMO GPS module. All coordinates are simulated and
 * must never be presented as real device telemetry.
 */
export const DEMO_GPS_SOURCE = 'DEMO_SIMULATOR';
export const DEMO_GPS_DISCLAIMER =
  'Koordinat berasal dari simulator lokal (DEMO GPS), bukan perangkat GPS aktual.';

export const OFFLINE_AFTER_MS = 2 * 60 * 1000;
export const MOVING_SPEED_KPH = 3;
export const DEVIATION_THRESHOLD_M = 1500;

export const GPS_PLACES = {
  'Stasiun Halim': { lat: -6.2422, lng: 106.8866 },
  'Kantor Pusat KCIC': { lat: -6.2246, lng: 106.8063 },
  'Stasiun Karawang': { lat: -6.3626, lng: 107.2914 },
  'Stasiun Padalarang': { lat: -6.8436, lng: 107.4822 },
  'Stasiun Tegalluar': { lat: -6.9438, lng: 107.6225 },
  'Depo Tegalluar': { lat: -6.951, lng: 107.629 },
  'Bandara Soekarno-Hatta': { lat: -6.1256, lng: 106.6559 },
};

const FALLBACK = { lat: -6.25, lng: 106.9 };

const VENDOR_PARKING = {
  vnd_01: { lat: -6.225, lng: 106.9 },
  vnd_02: { lat: -6.2383, lng: 106.9756 },
  vnd_03: { lat: -6.9175, lng: 107.6191 },
};

const KCIC_PARKING = [
  GPS_PLACES['Depo Tegalluar'],
  GPS_PLACES['Stasiun Halim'],
  GPS_PLACES['Kantor Pusat KCIC'],
  GPS_PLACES['Stasiun Tegalluar'],
  GPS_PLACES['Stasiun Karawang'],
];

export const GEOFENCE_SEED = [
  { id: 'geo_demo_halim', name: 'Stasiun Halim', category: 'STATION', centerLat: -6.2422, centerLng: 106.8866, radiusM: 500 },
  { id: 'geo_demo_karawang', name: 'Stasiun Karawang', category: 'STATION', centerLat: -6.3626, centerLng: 107.2914, radiusM: 500 },
  { id: 'geo_demo_padalarang', name: 'Stasiun Padalarang', category: 'STATION', centerLat: -6.8436, centerLng: 107.4822, radiusM: 500 },
  { id: 'geo_demo_tegalluar', name: 'Stasiun Tegalluar', category: 'STATION', centerLat: -6.9438, centerLng: 107.6225, radiusM: 550 },
  { id: 'geo_demo_depo', name: 'Depo Tegalluar', category: 'DEPOT', centerLat: -6.951, centerLng: 107.629, radiusM: 700 },
  { id: 'geo_demo_hq', name: 'Kantor Pusat KCIC', category: 'OFFICE', centerLat: -6.2246, centerLng: 106.8063, radiusM: 400 },
  { id: 'geo_demo_soetta', name: 'Bandara Soekarno-Hatta', category: 'AIRPORT', centerLat: -6.1256, centerLng: 106.6559, radiusM: 900 },
];

export function hashString(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function jitter(value, amplitude) {
  return (hashString(value) / 10000) % 1 * amplitude;
}

export function distanceMeters(aLat, aLng, bLat, bLng) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Deterministic point on a simulated corridor between two place names. */
export function routePoint(origin, destination, t) {
  const a = GPS_PLACES[origin] || FALLBACK;
  const b = GPS_PLACES[destination] || FALLBACK;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const curve = ((hashString(`${origin}|${destination}`) % 1000) / 1000 - 0.5) * 0.018;
  const bend = Math.sin(Math.PI * clamped) * curve;
  const lat = a.lat + (b.lat - a.lat) * clamped + bend;
  const lng = a.lng + (b.lng - a.lng) * clamped + bend * 0.55;
  const heading = ((Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180) / Math.PI + 360) % 360;
  return { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)), heading: Number(heading.toFixed(1)) };
}

export function parkedPoint(vehicleId, ownership, vendorId) {
  let base;
  if (ownership === 'VENDOR' && VENDOR_PARKING[vendorId]) base = VENDOR_PARKING[vendorId];
  else base = KCIC_PARKING[hashString(vehicleId) % KCIC_PARKING.length];
  const lat = base.lat + (jitter(`${vehicleId}-lat`, 60) - 30) / 10000;
  const lng = base.lng + (jitter(`${vehicleId}-lng`, 60) - 30) / 10000;
  return { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)), heading: 0 };
}

export function motionStatus(location, now = Date.now(), offlineAfterMs = OFFLINE_AFTER_MS) {
  if (!location) return 'OFFLINE';
  const age = now - new Date(location.recordedAt).getTime();
  if (!Number.isFinite(age) || age > offlineAfterMs) return 'OFFLINE';
  return Number(location.speedKph) >= MOVING_SPEED_KPH ? 'MOVING' : 'STOPPED';
}

export const GPS_EVENT_LABELS = {
  GEOFENCE_ENTER: 'Masuk geofence',
  GEOFENCE_EXIT: 'Keluar geofence',
  OVERSPEED: 'Melebihi kecepatan',
  HARSH_BRAKING: 'Pengereman mendadak',
  IDLE: 'Idle terlalu lama',
  DEVICE_OFFLINE: 'Perangkat offline',
  SIGNAL_RESTORED: 'Sinyal pulih',
  IGNITION_ON: 'Mesin menyala',
  IGNITION_OFF: 'Mesin mati',
  ROUTE_DEVIATION: 'Deviasi rute',
};

/**
 * ETA is estimated from the DEMO simulator progress and the route's
 * estimatedMinutes. It is an approximation for demo purposes only.
 */
export function etaInfo(trip, nowMs = Date.now()) {
  if (!trip || !['PICKED_UP', 'IN_PROGRESS'].includes(trip.status)) return null;
  const startRaw = trip.startedAt || trip.acceptedAt || trip.assignedAt;
  if (!startRaw) return null;
  const minutes = trip.booking?.route?.estimatedMinutes || 45;
  const etaAt = new Date(new Date(startRaw).getTime() + minutes * 60 * 1000);
  const diff = etaAt.getTime() - nowMs;
  return {
    etaAt: etaAt.toISOString(),
    remainingMinutes: Math.max(0, Math.round(diff / 60000)),
    status: diff < 0 ? 'OVERDUE' : diff <= 10 * 60000 ? 'DUE_SOON' : 'ON_TIME',
  };
}

/** Deterministic DEMO deviation: some vehicles drift off the corridor mid-trip. */
export function simulatedDeviationOffset(vehicleId, progress) {
  if (hashString(vehicleId) % 6 !== 0) return null;
  if (progress <= 0.22 || progress >= 0.72) return null;
  const factor = Math.sin(((progress - 0.22) / 0.5) * Math.PI);
  return { lat: 0.026 * factor, lng: 0.011 * factor };
}

export const MOVING_LABELS = {
  MOVING: 'Bergerak',
  STOPPED: 'Berhenti',
  OFFLINE: 'Offline',
};

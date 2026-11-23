import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import './env.js';
import { PrismaClient } from '@prisma/client';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testUrl = process.env.DATABASE_URL;
const dbName = new URL(testUrl).pathname.replace(/^\//, '');
const adminUrl = new URL(testUrl);
adminUrl.pathname = '/postgres';
adminUrl.search = '';

async function ensureDatabase() {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (existing.rowCount === 0) {
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`[test] created database ${dbName}`);
  }
  await client.end();
}

async function main() {
  await ensureDatabase();
  console.log('[test] resetting schema via prisma migrate reset');
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate --schema prisma/schema.prisma', {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
  });

  const prisma = new PrismaClient();
  const passwordHash = await bcrypt.hash('Demo123!', 4);

  const users = [
    ['test_admin', 'Test Admin', 'admin@demo.local', 'SYSTEM_ADMIN', 'Fleet Operations'],
    ['test_fleet', 'Test Fleet Manager', 'fleet@demo.local', 'FLEET_MANAGER', 'Fleet Operations'],
    ['test_ops', 'Test Ops Manager', 'ops@demo.local', 'OPERATIONAL_MANAGER', 'Operations'],
    ['test_dispatcher', 'Test Dispatcher', 'dispatch@demo.local', 'DISPATCHER', 'Operations'],
    ['test_transport', 'Test Transport Coordinator', 'transport@demo.local', 'TRANSPORT_COORDINATOR', 'Planning'],
    ['test_maint', 'Test Maintenance Officer', 'maintenance@demo.local', 'MAINTENANCE_OFFICER', 'Workshop'],
    ['test_fleetofficer', 'Test Fleet Officer', 'fleetofficer@demo.local', 'FLEET_OFFICER', 'Fleet Operations'],
    ['test_drivercoord', 'Test Driver Coordinator', 'drivercoord@demo.local', 'DRIVER_COORDINATOR', 'Driver Management'],
    ['test_vendor', 'Test Vendor Manager', 'vendor@demo.local', 'VENDOR_MANAGER', 'Procurement'],
    ['test_driver', 'Test Driver', 'driver@demo.local', 'DRIVER', 'Driver Pool'],
    ['test_employee', 'Test Employee', 'employee@demo.local', 'CREW_EMPLOYEE', 'Crew Operations'],
    ['test_employee2', 'Test Employee 2', 'employee2@demo.local', 'CREW_EMPLOYEE', 'Human Capital'],
  ];

  for (const [id, name, email, role, department] of users) {
    await prisma.user.create({
      data: { id, name, email, role, department, passwordHash, phone: '0810-0000-000' },
    });
  }

  await prisma.vendor.createMany({
    data: [
      { id: 'test_vendor_1', name: 'TEST Vendor Satu', contactName: 'PIC Satu', phone: '021-0001' },
      { id: 'test_vendor_2', name: 'TEST Vendor Dua', contactName: 'PIC Dua', phone: '021-0002' },
    ],
  });

  await prisma.route.createMany({
    data: [
      { id: 'test_route_1', code: 'TEST-R1', origin: 'Stasiun Halim', destination: 'Kantor Pusat', estimatedMinutes: 30, distanceKm: 12 },
      { id: 'test_route_2', code: 'TEST-R2', origin: 'Kantor Pusat', destination: 'Stasiun Halim', estimatedMinutes: 30, distanceKm: 12 },
    ],
  });

  await prisma.vehicle.createMany({
    data: [
      { id: 'veh_t1', plateNumber: 'TEST-0001', brand: 'Toyota', model: 'Innova', category: 'MPV', capacity: 6, ownership: 'KCIC', status: 'AVAILABLE', stnkExpiry: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), insuranceExpiry: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
      { id: 'veh_t2', plateNumber: 'TEST-0002', brand: 'Toyota', model: 'Hiace', category: 'Minibus', capacity: 12, ownership: 'VENDOR', vendorId: 'test_vendor_1', status: 'AVAILABLE' },
      { id: 'veh_t3', plateNumber: 'TEST-0003', brand: 'Mitsubishi', model: 'Xpander', category: 'MPV', capacity: 6, ownership: 'KCIC', status: 'AVAILABLE' },
      { id: 'veh_t4', plateNumber: 'TEST-0004', brand: 'Suzuki', model: 'Ertiga', category: 'MPV', capacity: 3, ownership: 'KCIC', status: 'AVAILABLE' },
    ],
  });

  await prisma.driver.createMany({
    data: [
      { id: 'drv_t1', name: 'Driver Test Satu', phone: '0812-0001', licenseNumber: 'SIM-T1', licenseExpiry: new Date('2030-01-01'), type: 'INTERNAL', userId: 'test_driver' },
      { id: 'drv_t2', name: 'Driver Test Dua', phone: '0812-0002', licenseNumber: 'SIM-T2', licenseExpiry: new Date('2030-01-01'), type: 'INTERNAL' },
      { id: 'drv_t3', name: 'Driver Test Tiga', phone: '0812-0003', licenseNumber: 'SIM-T3', licenseExpiry: new Date('2030-01-01'), type: 'VENDOR', vendorId: 'test_vendor_1' },
      { id: 'drv_t4', name: 'Driver Test Empat', phone: '0812-0004', licenseNumber: 'SIM-T4', licenseExpiry: new Date('2020-01-01'), type: 'INTERNAL' },
    ],
  });

  const now = new Date();
  await prisma.geofence.create({
    data: {
      id: 'geo_test_halim',
      name: 'TEST Stasiun Halim',
      category: 'STATION',
      centerLat: -6.2422,
      centerLng: 106.8866,
      radiusM: 500,
    },
  });

  await prisma.gpsDevice.createMany({
    data: [
      { id: 'gpsdev_t1', imei: 'TESTIMEI000001', vehicleId: 'veh_t1', status: 'ACTIVE', lastPingAt: now },
      { id: 'gpsdev_t2', imei: 'TESTIMEI000002', vehicleId: 'veh_t2', status: 'ACTIVE', lastPingAt: now },
      { id: 'gpsdev_t3', imei: 'TESTIMEI000003', vehicleId: 'veh_t3', status: 'ACTIVE' },
    ],
  });

  await prisma.gpsEvent.createMany({
    data: [
      {
        id: 'gps_evt_t1',
        vehicleId: 'veh_t1',
        deviceId: 'gpsdev_t1',
        geofenceId: 'geo_test_halim',
        type: 'OVERSPEED',
        message: 'TEST-0001 terdeteksi 92 km/jam (batas 80 km/jam)',
        lat: -6.25,
        lng: 106.9,
        speedKph: 92,
        occurredAt: new Date(Date.now() - 60_000),
      },
      {
        id: 'gps_evt_t2',
        vehicleId: 'veh_t2',
        deviceId: 'gpsdev_t2',
        type: 'IDLE',
        message: 'TEST-0002 idle lebih dari 30 menit',
        occurredAt: new Date(Date.now() - 120_000),
      },
    ],
  });

  console.log('[test] fixtures ready (12 users, 2 vendors, 2 routes, 4 vehicles, 4 drivers, 1 geofence, 3 GPS devices, 2 GPS events)');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[test] prepare failed', err);
  process.exit(1);
});

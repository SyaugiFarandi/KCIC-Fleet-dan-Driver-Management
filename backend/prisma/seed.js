import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEMO_GPS_SOURCE, GEOFENCE_SEED, parkedPoint, routePoint } from '../src/lib/gps.js';
import { TRIP_CHECKLIST_ITEMS } from '../src/lib/checklist.js';

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD || 'Demo123!';
const now = Date.now();
const hours = (n) => new Date(now + n * 60 * 60 * 1000);
const days = (n) => hours(n * 24);

function makeChecklist(actorId, at = new Date()) {
  return {
    items: TRIP_CHECKLIST_ITEMS.map((item) => ({ key: item.key, label: item.label, checked: true })),
    complete: true,
    note: null,
    updatedAt: at.toISOString(),
    updatedById: actorId,
  };
}

const users = [
  { id: 'usr_admin', name: 'Alex Pramudya', email: 'admin@demo.local', role: 'SYSTEM_ADMIN', department: 'Fleet Operations', phone: '0810-0000-101' },
  { id: 'usr_fleet', name: 'Maya Kusuma', email: 'fleet@demo.local', role: 'FLEET_MANAGER', department: 'Fleet Operations', phone: '0810-0000-102' },
  { id: 'usr_ops', name: 'Dimas Saputra', email: 'ops@demo.local', role: 'OPERATIONAL_MANAGER', department: 'Operations', phone: '0810-0000-103' },
  { id: 'usr_dispatch', name: 'Rani Wulandari', email: 'dispatch@demo.local', role: 'DISPATCHER', department: 'Operations Control', phone: '0810-0000-104' },
  { id: 'usr_transport', name: 'Yoga Hermawan', email: 'transport@demo.local', role: 'TRANSPORT_COORDINATOR', department: 'Transport Planning', phone: '0810-0000-105' },
  { id: 'usr_fleetofficer', name: 'Sinta Maharani', email: 'fleetofficer@demo.local', role: 'FLEET_OFFICER', department: 'Fleet Operations', phone: '0810-0000-106' },
  { id: 'usr_drivercoord', name: 'Fajar Nugroho', email: 'drivercoord@demo.local', role: 'DRIVER_COORDINATOR', department: 'Driver Management', phone: '0810-0000-107' },
  { id: 'usr_maint', name: 'Budi Hartono', email: 'maintenance@demo.local', role: 'MAINTENANCE_OFFICER', department: 'Workshop', phone: '0810-0000-108' },
  { id: 'usr_vendor', name: 'Lestari Dewi', email: 'vendor@demo.local', role: 'VENDOR_MANAGER', department: 'Procurement', phone: '0810-0000-109' },
  { id: 'usr_driver', name: 'Rizky Pratama', email: 'driver@demo.local', role: 'DRIVER', department: 'Driver Pool', phone: '0810-0000-110' },
  { id: 'usr_employee', name: 'Nadia Putri', email: 'employee@demo.local', role: 'CREW_EMPLOYEE', department: 'Crew Operations', phone: '0810-0000-111' },
  { id: 'usr_employee2', name: 'Ayu Lestari', email: 'employee2@demo.local', role: 'CREW_EMPLOYEE', department: 'Human Capital', phone: '0810-0000-112' },
  { id: 'usr_employee3', name: 'Bagas Prakoso', email: 'employee3@demo.local', role: 'CREW_EMPLOYEE', department: 'IT Services', phone: '0810-0000-113' },
];

const vendors = [
  { id: 'vnd_01', name: 'DEMO Sinar Jaya Transport', contactName: 'Rahmat Hidayat', phone: '021-5550101', email: 'ops@sinarjaya.demo.local', address: 'Jakarta Timur', active: true },
  { id: 'vnd_02', name: 'DEMO Nusantara Raya Mobility', contactName: 'Dewi Anggraini', phone: '021-5550102', email: 'fleet@nusantararaya.demo.local', address: 'Bekasi', active: true },
  { id: 'vnd_03', name: 'DEMO Prima Armada Logistik', contactName: 'Hendra Wijaya', phone: '022-5550103', email: 'ops@primaarmada.demo.local', address: 'Bandung', active: true },
];

const vehicles = [
  ['vh_01', 'B 1001 WSA', 'Toyota', 'Innova Zenix', 'MPV', 6, 'KCIC', null, 'ASSIGNED'],
  ['vh_02', 'B 1002 WSA', 'Toyota', 'Hiace Premio', 'Minibus', 12, 'KCIC', null, 'ASSIGNED'],
  ['vh_03', 'B 1003 WSA', 'Mitsubishi', 'Xpander', 'MPV', 6, 'KCIC', null, 'ASSIGNED'],
  ['vh_04', 'B 1004 WSA', 'Toyota', 'Avanza', 'MPV', 6, 'VENDOR', 'vnd_01', 'ASSIGNED'],
  ['vh_05', 'B 1005 WSA', 'Hyundai', 'Staria', 'MPV', 7, 'KCIC', null, 'ASSIGNED'],
  ['vh_06', 'B 1006 WSA', 'Isuzu', 'Elf NLR', 'Minibus', 15, 'KCIC', null, 'ASSIGNED'],
  ['vh_07', 'B 1007 WSA', 'Toyota', 'Innova Zenix', 'MPV', 6, 'KCIC', null, 'ASSIGNED'],
  ['vh_08', 'B 1008 WSA', 'Toyota', 'Fortuner', 'SUV', 7, 'VENDOR', 'vnd_02', 'ASSIGNED'],
  ['vh_09', 'B 1009 WSA', 'Toyota', 'Hiace Commuter', 'Minibus', 14, 'KCIC', null, 'AVAILABLE'],
  ['vh_10', 'B 1010 WSA', 'Toyota', 'Innova Reborn', 'MPV', 6, 'KCIC', null, 'AVAILABLE'],
  ['vh_11', 'B 1011 WSA', 'Mitsubishi', 'Xpander Cross', 'MPV', 6, 'KCIC', null, 'AVAILABLE'],
  ['vh_12', 'B 1012 WSA', 'Toyota', 'Avanza', 'MPV', 6, 'VENDOR', 'vnd_02', 'AVAILABLE'],
  ['vh_13', 'B 1013 WSA', 'Hyundai', 'Staria', 'MPV', 7, 'VENDOR', 'vnd_03', 'AVAILABLE'],
  ['vh_14', 'B 1014 WSA', 'Toyota', 'Innova Zenix', 'MPV', 6, 'KCIC', null, 'AVAILABLE'],
  ['vh_15', 'B 1015 WSA', 'Toyota', 'Hiace Premio', 'Minibus', 12, 'KCIC', null, 'INACTIVE'],
  ['vh_16', 'B 1016 WSA', 'Mitsubishi', 'Xpander', 'MPV', 6, 'KCIC', null, 'INACTIVE'],
  ['vh_17', 'B 1017 WSA', 'Toyota', 'Innova Zenix', 'MPV', 6, 'KCIC', null, 'MAINTENANCE'],
  ['vh_18', 'B 1018 WSA', 'Wuling', 'Cortez', 'MPV', 7, 'KCIC', null, 'MAINTENANCE'],
];

const drivers = [
  ['dr_01', 'Rizky Pratama', '0812-0000-201', 'SIM-A-201', '2029-06-30', 'INTERNAL', null, 'usr_driver'],
  ['dr_02', 'Agus Setiawan', '0812-0000-202', 'SIM-A-202', '2028-11-30', 'INTERNAL', null, null],
  ['dr_03', 'Hendra Gunawan', '0812-0000-203', 'SIM-A-203', '2028-03-31', 'INTERNAL', null, null],
  ['dr_04', 'Slamet Riyadi', '0812-0000-204', 'SIM-B1-204', '2027-12-31', 'INTERNAL', null, null],
  ['dr_05', 'Joko Susilo', '0812-0000-205', 'SIM-A-205', '2028-08-31', 'VENDOR', 'vnd_01', null],
  ['dr_06', 'Andi Firmansyah', '0812-0000-206', 'SIM-A-206', '2029-01-31', 'VENDOR', 'vnd_01', null],
  ['dr_07', 'Bayu Santoso', '0812-0000-207', 'SIM-A-207', '2028-05-31', 'INTERNAL', null, null],
  ['dr_08', 'Dedi Kurniawan', '0812-0000-208', 'SIM-B1-208', '2028-09-30', 'VENDOR', 'vnd_02', null],
  ['dr_09', 'Eko Prasetyo', '0812-0000-209', 'SIM-A-209', '2027-10-31', 'INTERNAL', null, null],
  ['dr_10', 'Gilang Ramadhan', '0812-0000-210', 'SIM-A-210', '2028-07-31', 'INTERNAL', null, null],
  ['dr_11', 'Irfan Maulana', '0812-0000-211', 'SIM-A-211', '2029-02-28', 'VENDOR', 'vnd_03', null],
  ['dr_12', 'Kurnia Sandi', '0812-0000-212', 'SIM-A-212', '2027-11-30', 'INTERNAL', null, null],
  ['dr_13', 'Lukman Hakim', '0812-0000-213', 'SIM-A-213', '2026-12-05', 'INTERNAL', null, null],
  ['dr_14', 'Mario Sitepu', '0812-0000-214', 'SIM-A-214', '2026-01-15', 'VENDOR', 'vnd_02', null],
];

const routes = [
  ['rte_01', 'RTE-01', 'Stasiun Halim', 'Kantor Pusat KCIC', 35, 14.5],
  ['rte_02', 'RTE-02', 'Stasiun Halim', 'Stasiun Karawang', 55, 42.0],
  ['rte_03', 'RTE-03', 'Stasiun Karawang', 'Stasiun Halim', 55, 42.0],
  ['rte_04', 'RTE-04', 'Stasiun Padalarang', 'Stasiun Halim', 90, 118.0],
  ['rte_05', 'RTE-05', 'Stasiun Halim', 'Stasiun Tegalluar', 45, 32.0],
  ['rte_06', 'RTE-06', 'Stasiun Tegalluar', 'Stasiun Halim', 45, 32.0],
  ['rte_07', 'RTE-07', 'Kantor Pusat KCIC', 'Stasiun Karawang', 60, 46.0],
  ['rte_08', 'RTE-08', 'Depo Tegalluar', 'Stasiun Halim', 50, 36.0],
  ['rte_09', 'RTE-09', 'Stasiun Padalarang', 'Stasiun Karawang', 120, 155.0],
  ['rte_10', 'RTE-10', 'Stasiun Tegalluar', 'Bandara Soekarno-Hatta', 150, 175.0],
  ['rte_11', 'RTE-11', 'Stasiun Halim', 'Bandara Soekarno-Hatta', 60, 38.0],
  ['rte_12', 'RTE-12', 'Stasiun Karawang', 'Stasiun Padalarang', 120, 155.0],
];

const routeById = Object.fromEntries(routes.map(([id, code, origin, destination, estimatedMinutes, distanceKm]) => [id, { code, origin, destination, estimatedMinutes, distanceKm }]));

const routeRestrictions = {
  rte_01: { maxHeightM: 2.3, maxWeightTon: 3.5, notes: 'Parkir basement kantor pusat, tinggi maksimum 2,3 m (demo)' },
  rte_11: { maxHeightM: 2.5, notes: 'Akses bandara hanya untuk kendaraan dengan stiker resmi (demo)' },
  rte_10: { maxWeightTon: 5, notes: 'Rute tol jarak jauh, utamakan kendaraan dengan BBM memadai (demo)' },
};

const routePoints = [
  ['rtp_01_1', 'rte_01', 'Lobby A Stasiun Halim', 'PICKUP', -6.2436, 106.8852, 1],
  ['rtp_01_2', 'rte_01', 'Tol Jakarta-Cikampek KM 2', 'WAYPOINT', -6.2417, 106.8691, 2],
  ['rtp_01_3', 'rte_01', 'Kantor Pusat KCIC', 'DROP_OFF', -6.2231, 106.8065, 3],
  ['rtp_02_1', 'rte_02', 'Lobby A Stasiun Halim', 'PICKUP', -6.2436, 106.8852, 1],
  ['rtp_02_2', 'rte_02', 'Rest Area KM 19', 'WAYPOINT', -6.2884, 107.0824, 2],
  ['rtp_02_3', 'rte_02', 'Stasiun Karawang', 'DROP_OFF', -6.3529, 107.2985, 3],
  ['rtp_10_1', 'rte_10', 'Stasiun Tegalluar', 'PICKUP', -6.9477, 107.6268, 1],
  ['rtp_10_2', 'rte_10', 'Rest Area KM 97', 'WAYPOINT', -6.5611, 107.4020, 2],
  ['rtp_10_3', 'rte_10', 'Terminal 3 Soekarno-Hatta', 'DROP_OFF', -6.1256, 106.6559, 3],
  ['rtp_11_1', 'rte_11', 'Lobby A Stasiun Halim', 'PICKUP', -6.2436, 106.8852, 1],
  ['rtp_11_2', 'rte_11', 'Tol Sedyatmo KM 29', 'WAYPOINT', -6.1621, 106.7001, 2],
  ['rtp_11_3', 'rte_11', 'Terminal 3 Soekarno-Hatta', 'DROP_OFF', -6.1256, 106.6559, 3],
];

const inspectionTemplates = [
  {
    id: 'ins_tpl_pre',
    name: 'DEMO Pre-Trip Standar',
    description: 'Pemeriksaan sebelum perjalanan untuk armada MPV/Minibus (data demo).',
    category: 'PRE_TRIP',
    items: [
      { key: 'documents', label: 'STNK dan dokumen kendaraan tersedia', critical: true },
      { key: 'tires', label: 'Tekanan dan kondisi ban', critical: true },
      { key: 'lights', label: 'Lampu utama, rem, dan sein', critical: true },
      { key: 'fluids', label: 'Oli, air radiator, dan wiper washer', critical: false },
      { key: 'brakes', label: 'Respon rem dan rem tangan', critical: true },
      { key: 'safety', label: 'Segitiga, dongkrak, dan APAR', critical: false },
      { key: 'cleanliness', label: 'Kebersihan kabin dan bagasi', critical: false },
    ],
  },
  {
    id: 'ins_tpl_release',
    name: 'DEMO Release Inspeksi Kendaraan',
    description: 'Pemeriksaan kelayakan kendaraan setelah perbaikan sebelum kembali beroperasi (data demo).',
    category: 'RELEASE',
    items: [
      { key: 'work_verified', label: 'Pekerjaan perbaikan diverifikasi oleh mekanik', critical: true },
      { key: 'functional_test', label: 'Uji fungsi komponen yang diperbaiki', critical: true },
      { key: 'brakes', label: 'Uji rem dan sistem kemudi', critical: true },
      { key: 'fluids', label: 'Level oli dan cairan normal, tidak ada kebocoran', critical: false },
      { key: 'road_test', label: 'Uji jalan singkat (minimum 2 km)', critical: false },
    ],
  },
];

const inspectionSpecs = [
  ['ins_demo_01', 'vh_17', 'dr_04', null, 'ins_tpl_pre', 'PRE_TRIP', 'FAILED', 26840, -5, ['tires', 'brakes']],
  ['ins_demo_02', 'vh_09', 'dr_08', 'trip_demo_21', 'ins_tpl_pre', 'PRE_TRIP', 'PASSED', 38420, -49, []],
  ['ins_demo_03', 'vh_10', 'dr_09', 'trip_demo_22', 'ins_tpl_pre', 'POST_TRIP', 'PASSED', 41210, -95, []],
  ['ins_demo_04', 'vh_18', 'dr_10', null, 'ins_tpl_release', 'RELEASE', 'DEFECTS', 33155, -30, ['functional_test']],
  ['ins_demo_05', 'vh_11', 'dr_10', null, 'ins_tpl_pre', 'PRE_TRIP', 'DRAFT', 29800, -1, ['fluids']],
];

const defectSpecs = [
  ['dft_demo_01', 'vh_17', 'ins_demo_01', 'mnt_01', 'Kebocoran minyak rem roda depan', 'Terdapat rembesan pada selang rem kiri depan, kendaraan tidak layak jalan.', 'CRITICAL', 'IN_REPAIR', 'usr_maint'],
  ['dft_demo_02', 'vh_18', 'ins_demo_04', 'mnt_02', 'Kompresor AC tidak berfungsi', 'Uji fungsi AC gagal, suhu kabin tidak turun. Menunggu penggantian kompresor.', 'HIGH', 'IN_REPAIR', 'usr_maint'],
  ['dft_demo_03', 'vh_11', null, null, 'Level cairan wiper rendah', 'Ditemukan saat inspeksi pra-trip, perlu pengisian ulang.', 'LOW', 'OPEN', 'usr_fleetofficer'],
  ['dft_demo_04', 'vh_09', null, 'mnt_04', 'Keausan kampas rem belakang', 'Ketebalan kampas 3 mm, dijadwalkan penggantian pada servis berkala.', 'MEDIUM', 'OPEN', 'usr_fleetofficer'],
  ['dft_demo_05', 'vh_13', null, 'mnt_06', 'Speedometer tidak akurat', 'Selisih pembacaan ±7%, sudah dikalibrasi ulang.', 'MEDIUM', 'RESOLVED', 'usr_fleetofficer'],
];

const fuelPrices = [
  ['BIOSOLAR', 6800, 'Harga referensi demo — bukan harga resmi'],
  ['DEXLITE', 15200, 'Harga referensi demo — bukan harga resmi'],
  ['PERTAMAX', 13500, 'Harga referensi demo — bukan harga resmi'],
];

const fuelTransactions = [
  ['fuel_demo_01', 'vh_01', 'dr_01', 'trip_demo_13', 'DEXLITE', -0.6, 38.5, 15200, 585200, 24910, 'FUEL_CARD', 'SPBU DEMO 31.101', 'NONE'],
  ['fuel_demo_02', 'vh_02', 'dr_02', 'trip_demo_14', 'BIOSOLAR', -0.7, 62.0, 6800, 421600, 67220, 'VENDOR_CARD', 'SPBU DEMO 31.102', 'NONE'],
  ['fuel_demo_03', 'vh_09', 'dr_08', 'trip_demo_21', 'DEXLITE', -47, 42.0, 15200, 638400, 37900, 'FUEL_CARD', 'SPBU DEMO 31.201', 'NONE'],
  ['fuel_demo_04', 'vh_10', 'dr_09', 'trip_demo_22', 'BIOSOLAR', -95, 55.0, 6800, 374000, 40680, 'FUEL_CARD', 'SPBU DEMO 31.202', 'NONE'],
  ['fuel_demo_05', 'vh_11', 'dr_10', 'trip_demo_23', 'DEXLITE', -119, 40.5, 15200, 615600, 29250, 'TRANSFER', 'SPBU DEMO 31.203', 'NONE'],
  ['fuel_demo_06', 'vh_12', 'dr_11', 'trip_demo_24', 'BIOSOLAR', -167, 58.0, 6800, 394400, 58110, 'VENDOR_CARD', 'SPBU DEMO 31.204', 'NONE'],
  ['fuel_demo_07', 'vh_13', 'dr_12', 'trip_demo_25', 'DEXLITE', -215, 44.0, 15200, 668800, 31740, 'FUEL_CARD', 'SPBU DEMO 31.205', 'NONE'],
  ['fuel_demo_08', 'vh_03', 'dr_03', 'trip_demo_15', 'BIOSOLAR', -2, 96.0, 6800, 652800, 31240, 'CASH', 'SPBU DEMO 31.301', 'FLAGGED'],
  ['fuel_demo_09', 'vh_04', 'dr_04', 'trip_demo_16', 'DEXLITE', -26, 35.0, 18500, 647500, 27990, 'CASH', 'SPBU DEMO 31.302', 'FLAGGED'],
  ['fuel_demo_10', 'vh_05', 'dr_05', 'trip_demo_17', 'DEXLITE', -70, 39.0, 15200, 592800, 46300, 'FUEL_CARD', 'SPBU DEMO 31.303', 'APPROVED'],
];

// Historical odometer samples (DEMO) so usage-based maintenance prediction has
// at least two points per vehicle; values are derived, not real operational data.
const fuelHistory = fuelTransactions.flatMap(
  ([, vehicleId, , , fuelType, , , pricePerLiter, , odometerKm, , station]) => [
    [`fuel_hist_${vehicleId}_a`, vehicleId, null, null, fuelType, -110 * 24, 35, pricePerLiter, 35 * pricePerLiter, Math.max(0, odometerKm - 5000), 'FUEL_CARD', station, 'NONE'],
    [`fuel_hist_${vehicleId}_b`, vehicleId, null, null, fuelType, -55 * 24, 35, pricePerLiter, 35 * pricePerLiter, Math.max(0, odometerKm - 2500), 'FUEL_CARD', station, 'NONE'],
  ]
);
const allFuelTransactions = [...fuelTransactions, ...fuelHistory];

const vendorContracts = [
  ['ctr_demo_01', 'vnd_01', 'DEMO-CTR-2026-01', 'Penyediaan 2 unit MPV beserta driver untuk operasional harian', -180, 25, 42000000, 'ACTIVE'],
  ['ctr_demo_02', 'vnd_02', 'DEMO-CTR-2026-02', 'Penyediaan 2 unit SUV/MPV dan driver pendukung', -90, 400, 38500000, 'ACTIVE'],
  ['ctr_demo_03', 'vnd_03', 'DEMO-CTR-2025-03', 'Penyediaan 1 unit MPV dan driver untuk rute Bandung', -400, -20, 31000000, 'EXPIRED'],
];

const slaDefinitions = [
  ['ctr_demo_01', 'ON_TIME_DEPARTURE', 95, '%'],
  ['ctr_demo_01', 'TRIP_COMPLETION', 98, '%'],
  ['ctr_demo_01', 'AVAILABILITY', 90, '%'],
  ['ctr_demo_01', 'RESPONSE_TIME', 30, 'menit'],
  ['ctr_demo_02', 'ON_TIME_DEPARTURE', 93, '%'],
  ['ctr_demo_02', 'TRIP_COMPLETION', 97, '%'],
  ['ctr_demo_02', 'AVAILABILITY', 88, '%'],
  ['ctr_demo_03', 'ON_TIME_DEPARTURE', 90, '%'],
  ['ctr_demo_03', 'TRIP_COMPLETION', 95, '%'],
];

const purposes = [
  'Rapat koordinasi operasional',
  'Penjemputan tamu manajemen',
  'Kunjungan kerja unit IT',
  'Rotasi kru dan serah terima shift',
  'Audit internal bulanan',
  'Pengambilan dokumen arsip',
  'Dinas operasional stasiun',
  'Pelatihan keselamatan kerja',
  'Koordinasi proyek sarana',
  'Survey lokasi depo',
];

const bookingSpecs = [
  // id, code, requester, routeId, pax, departure, return, status, extra
  ['bkg_demo_01', 'DEMO-BKG-0001', 'usr_employee', 'rte_01', 3, hours(26), null, 'PENDING'],
  ['bkg_demo_02', 'DEMO-BKG-0002', 'usr_employee2', 'rte_10', 4, hours(50), null, 'PENDING'],
  ['bkg_demo_03', 'DEMO-BKG-0003', 'usr_employee3', 'rte_07', 2, hours(74), null, 'PENDING'],
  ['bkg_demo_04', 'DEMO-BKG-0004', 'usr_employee', 'rte_04', 6, hours(98), null, 'PENDING'],
  ['bkg_demo_05', 'DEMO-BKG-0005', 'usr_employee2', 'rte_05', 1, hours(122), null, 'PENDING'],
  ['bkg_demo_06', 'DEMO-BKG-0006', 'usr_employee3', 'rte_08', 2, hours(146), null, 'PENDING'],
  ['bkg_demo_07', 'DEMO-BKG-0007', 'usr_employee', 'rte_02', 4, hours(22), hours(25), 'APPROVED'],
  ['bkg_demo_08', 'DEMO-BKG-0008', 'usr_employee2', 'rte_03', 3, hours(30), hours(33), 'APPROVED'],
  ['bkg_demo_09', 'DEMO-BKG-0009', 'usr_employee3', 'rte_09', 5, hours(46), hours(50), 'APPROVED'],
  ['bkg_demo_10', 'DEMO-BKG-0010', 'usr_employee', 'rte_06', 2, hours(70), hours(73), 'APPROVED'],
  ['bkg_demo_11', 'DEMO-BKG-0011', 'usr_employee2', 'rte_05', 4, hours(94), hours(97), 'APPROVED'],
  ['bkg_demo_12', 'DEMO-BKG-0012', 'usr_employee3', 'rte_12', 3, hours(118), hours(122), 'APPROVED'],
  ['bkg_demo_13', 'DEMO-BKG-0013', 'usr_employee', 'rte_05', 4, hours(-0.5), hours(1.5), 'ASSIGNED'],
  ['bkg_demo_14', 'DEMO-BKG-0014', 'usr_employee2', 'rte_03', 3, hours(-0.75), hours(1.25), 'ASSIGNED'],
  ['bkg_demo_15', 'DEMO-BKG-0015', 'usr_employee3', 'rte_04', 5, hours(-0.5), hours(1.5), 'ASSIGNED'],
  ['bkg_demo_16', 'DEMO-BKG-0016', 'usr_employee', 'rte_07', 3, hours(-0.25), hours(1.75), 'ASSIGNED'],
  ['bkg_demo_17', 'DEMO-BKG-0017', 'usr_employee2', 'rte_04', 4, hours(0.75), hours(2.75), 'ASSIGNED'],
  ['bkg_demo_18', 'DEMO-BKG-0018', 'usr_employee3', 'rte_07', 2, hours(1), hours(3), 'ASSIGNED'],
  ['bkg_demo_19', 'DEMO-BKG-0019', 'usr_employee', 'rte_08', 6, hours(3), hours(5), 'ASSIGNED'],
  ['bkg_demo_20', 'DEMO-BKG-0020', 'usr_employee2', 'rte_02', 4, hours(5), hours(7), 'ASSIGNED'],
  ['bkg_demo_21', 'DEMO-BKG-0021', 'usr_employee', 'rte_01', 2, hours(-48), hours(-45), 'COMPLETED'],
  ['bkg_demo_22', 'DEMO-BKG-0022', 'usr_employee2', 'rte_06', 4, hours(-96), hours(-93), 'COMPLETED'],
  ['bkg_demo_23', 'DEMO-BKG-0023', 'usr_employee3', 'rte_09', 5, hours(-120), hours(-117), 'COMPLETED'],
  ['bkg_demo_24', 'DEMO-BKG-0024', 'usr_employee', 'rte_10', 3, hours(-168), hours(-165), 'COMPLETED'],
  ['bkg_demo_25', 'DEMO-BKG-0025', 'usr_employee2', 'rte_11', 2, hours(-216), hours(-213), 'COMPLETED'],
  ['bkg_demo_26', 'DEMO-BKG-0026', 'usr_employee3', 'rte_03', 2, hours(72), null, 'REJECTED'],
  ['bkg_demo_27', 'DEMO-BKG-0027', 'usr_employee', 'rte_05', 8, hours(120), null, 'REJECTED'],
  ['bkg_demo_28', 'DEMO-BKG-0028', 'usr_employee2', 'rte_10', 1, hours(168), null, 'REJECTED'],
  ['bkg_demo_29', 'DEMO-BKG-0029', 'usr_employee3', 'rte_02', 3, hours(48), null, 'CANCELLED'],
  ['bkg_demo_30', 'DEMO-BKG-0030', 'usr_employee', 'rte_11', 2, hours(96), null, 'CANCELLED'],
  ['bkg_demo_31', 'DEMO-BKG-0031', 'usr_employee2', 'rte_06', 4, hours(144), null, 'CANCELLED'],
];

const activeTrips = [
  ['trip_demo_13', 'bkg_demo_13', 'vh_01', 'dr_01', 'IN_PROGRESS', -0.5, 1.5],
  ['trip_demo_14', 'bkg_demo_14', 'vh_02', 'dr_02', 'IN_PROGRESS', -0.75, 1.25],
  ['trip_demo_15', 'bkg_demo_15', 'vh_03', 'dr_03', 'PICKED_UP', -0.5, 1.5],
  ['trip_demo_16', 'bkg_demo_16', 'vh_04', 'dr_04', 'PICKED_UP', -0.25, 1.75],
  ['trip_demo_17', 'bkg_demo_17', 'vh_05', 'dr_05', 'DRIVER_ACCEPTED', 0.75, 2.75],
  ['trip_demo_18', 'bkg_demo_18', 'vh_06', 'dr_06', 'DRIVER_ACCEPTED', 1, 3],
  ['trip_demo_19', 'bkg_demo_19', 'vh_07', 'dr_01', 'SCHEDULED', 3, 5],
  ['trip_demo_20', 'bkg_demo_20', 'vh_08', 'dr_07', 'SCHEDULED', 5, 7],
];

const completedTrips = [
  ['trip_demo_21', 'bkg_demo_21', 'vh_09', 'dr_08', -48, -45],
  ['trip_demo_22', 'bkg_demo_22', 'vh_10', 'dr_09', -96, -93],
  ['trip_demo_23', 'bkg_demo_23', 'vh_11', 'dr_10', -120, -117],
  ['trip_demo_24', 'bkg_demo_24', 'vh_12', 'dr_11', -168, -165],
  ['trip_demo_25', 'bkg_demo_25', 'vh_13', 'dr_12', -216, -213],
];

const maintenanceItems = [
  ['mnt_01', 'vh_17', 'Servis berkala 20.000 km', 'Ganti oli, filter udara, dan pemeriksaan rem.', hours(-26), 'IN_PROGRESS', 1850000, -26, null],
  ['mnt_02', 'vh_18', 'Perbaikan AC kabin', 'Kompresor AC tidak dingin, perlu penggantian.', hours(-3), 'IN_PROGRESS', 2400000, -3, null],
  ['mnt_03', 'vh_14', 'Pemeriksaan ban & spooring', 'Rotasi ban dan spooring sebelum jadwal operasional.', hours(48), 'PLANNED', 750000, null, null],
  ['mnt_04', 'vh_09', 'Servis berkala 40.000 km', 'Pemeriksaan menyeluruh setelah perjalanan luar kota.', hours(120), 'PLANNED', 1650000, null, null],
  ['mnt_05', 'vh_11', 'Ganti kampas rem depan', 'Kampas rem sudah tipis, penggantian selesai.', hours(-240), 'COMPLETED', 920000, -242, -240],
  ['mnt_06', 'vh_13', 'Kalibrasi speedometer', 'Dibatalkan karena unit dipindahkan ke vendor lain.', hours(-72), 'CANCELLED', 0, null, null],
];

const tripEventChains = {
  SCHEDULED: ['SCHEDULED'],
  DRIVER_ACCEPTED: ['SCHEDULED', 'DRIVER_ACCEPTED'],
  PICKED_UP: ['SCHEDULED', 'DRIVER_ACCEPTED', 'PICKED_UP'],
  IN_PROGRESS: ['SCHEDULED', 'DRIVER_ACCEPTED', 'PICKED_UP', 'IN_PROGRESS'],
  COMPLETED: ['SCHEDULED', 'DRIVER_ACCEPTED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED'],
};

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash },
    });
  }

  for (const v of vendors) {
    await prisma.vendor.upsert({ where: { id: v.id }, update: {}, create: v });
  }

  for (const [index, [id, plateNumber, brand, model, category, capacity, ownership, vendorId, status]] of vehicles.entries()) {
    const stnkExpiry = days(index % 3 === 0 ? 9 + index : 25 + index * 40);
    const insuranceExpiry = index % 7 === 0 ? days(-4) : index % 7 === 1 ? days(12 + index) : days(120 + index * 20);
    const odometerKm = 25000 + index * 2400;
    const serviceDaysAgo = index === 2 ? 200 : index === 4 ? 170 : 20 + index * 6;
    const lastServiceAt = days(-serviceDaysAgo);
    await prisma.vehicle.upsert({
      where: { id },
      update: { stnkExpiry, insuranceExpiry, odometerKm, lastServiceAt },
      create: {
        id,
        plateNumber,
        brand,
        model,
        category,
        capacity,
        ownership,
        vendorId,
        status,
        year: 2023,
        color: 'Demo',
        odometerKm,
        lastServiceAt,
        serviceIntervalKm: 10000,
        serviceIntervalDays: 180,
        stnkExpiry,
        insuranceExpiry,
        notes: 'Data kendaraan demo',
      },
    });
  }

  for (const [id, name, phone, licenseNumber, licenseExpiry, type, vendorId, userId] of drivers) {
    await prisma.driver.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name,
        phone,
        licenseNumber,
        licenseCategory: 'SIM A',
        licenseExpiry: new Date(`${licenseExpiry}T00:00:00.000Z`),
        type,
        vendorId,
        userId,
        active: true,
        available: true,
      },
    });
  }

  for (const [id, code, origin, destination, estimatedMinutes, distanceKm] of routes) {
    await prisma.route.upsert({
      where: { id },
      update: {
        ...(routeRestrictions[id] ? { restrictions: routeRestrictions[id] } : {}),
      },
      create: {
        id,
        code,
        origin,
        destination,
        estimatedMinutes,
        distanceKm,
        restrictions: routeRestrictions[id] || null,
        active: true,
      },
    });
  }

  for (const [id, routeId, name, kind, lat, lng, sequence] of routePoints) {
    await prisma.routePoint.upsert({
      where: { id },
      update: {},
      create: { id, routeId, name, kind, lat, lng, sequence, notes: 'Titik rute demo' },
    });
  }

  for (const [id, code, requesterId, routeId, passengerCount, departureAt, returnAt, status] of bookingSpecs) {
    const route = routeById[routeId];
    const requester = users.find((u) => u.id === requesterId);
    const decided = ['APPROVED', 'ASSIGNED', 'COMPLETED', 'REJECTED'].includes(status);
    await prisma.booking.upsert({
      where: { id },
      update: {},
      create: {
        id,
        code,
        requesterId,
        department: requester.department,
        purpose: purposes[Number(id.slice(-2)) % purposes.length],
        passengerCount,
        origin: route.origin,
        destination: route.destination,
        routeId,
        departureAt,
        returnAt,
        status,
        decidedById: decided ? 'usr_fleet' : null,
        decidedAt: decided ? new Date(departureAt.getTime() - 24 * 60 * 60 * 1000) : null,
        rejectionReason: status === 'REJECTED' ? 'Jadwal kendaraan penuh pada slot yang diminta' : null,
        cancelledReason: status === 'CANCELLED' ? 'Dibatalkan oleh pemohon karena perubahan agenda' : null,
        createdAt: new Date(departureAt.getTime() - 72 * 60 * 60 * 1000),
      },
    });
  }

  const dispatchUser = 'usr_dispatch';
  for (const [tripId, bookingId, vehicleId, driverId, status, departOffset, returnOffset] of activeTrips) {
    const assignedAt = hours(departOffset - 12);
    const chain = tripEventChains[status];
    const timestamps = {
      SCHEDULED: [assignedAt],
      DRIVER_ACCEPTED: [assignedAt, hours(departOffset - 0.5)],
      PICKED_UP: [assignedAt, hours(departOffset - 0.5), hours(departOffset + 0.1)],
      IN_PROGRESS: [assignedAt, hours(departOffset - 0.5), hours(departOffset + 0.1), hours(departOffset + 0.25)],
    }[status];

    const checklist = ['PICKED_UP', 'IN_PROGRESS'].includes(status)
      ? makeChecklist(driverId === 'dr_01' ? 'usr_driver' : dispatchUser, hours(departOffset + 0.1))
      : null;

    await prisma.trip.upsert({
      where: { id: tripId },
      update: checklist ? { checklist } : {},
      create: {
        id: tripId,
        bookingId,
        vehicleId,
        driverId,
        status,
        assignedById: dispatchUser,
        assignedAt,
        acceptedAt: ['DRIVER_ACCEPTED', 'PICKED_UP', 'IN_PROGRESS'].includes(status) ? hours(departOffset - 0.5) : null,
        startedAt: status === 'IN_PROGRESS' ? hours(departOffset + 0.25) : null,
        checklist,
        notes: 'Penugasan demo',
      },
    });

    for (let i = 0; i < chain.length; i += 1) {
      await prisma.tripEvent.upsert({
        where: { id: `${tripId}_evt_${i + 1}` },
        update: {},
        create: {
          id: `${tripId}_evt_${i + 1}`,
          tripId,
          status: chain[i],
          note: i === 0 ? 'Penugasan kendaraan dan driver dibuat' : `Status diperbarui ke ${chain[i]}`,
          actorId: i === 0 ? dispatchUser : driverId === 'dr_01' ? 'usr_driver' : dispatchUser,
          createdAt: timestamps[i],
        },
      });
    }
  }

  for (const [tripId, bookingId, vehicleId, driverId, departOffset, returnOffset] of completedTrips) {
    const assignedAt = hours(departOffset - 20);
    const chain = tripEventChains.COMPLETED;
    const timestamps = [
      assignedAt,
      hours(departOffset - 0.5),
      hours(departOffset + 0.25),
      hours(departOffset + 0.5),
      hours(returnOffset),
    ];
    const checklist = makeChecklist('usr_dispatch', timestamps[2]);
    await prisma.trip.upsert({
      where: { id: tripId },
      update: { checklist },
      create: {
        id: tripId,
        bookingId,
        vehicleId,
        driverId,
        status: 'COMPLETED',
        assignedById: dispatchUser,
        assignedAt,
        acceptedAt: timestamps[1],
        startedAt: timestamps[3],
        completedAt: timestamps[4],
        checklist,
        notes: 'Perjalanan demo selesai',
      },
    });
    for (let i = 0; i < chain.length; i += 1) {
      await prisma.tripEvent.upsert({
        where: { id: `${tripId}_evt_${i + 1}` },
        update: {},
        create: {
          id: `${tripId}_evt_${i + 1}`,
          tripId,
          status: chain[i],
          note: i === 0 ? 'Penugasan kendaraan dan driver dibuat' : `Status diperbarui ke ${chain[i]}`,
          actorId: i === 0 ? dispatchUser : 'usr_driver',
          createdAt: timestamps[i],
        },
      });
    }
  }

  const maintenanceMeta = {
    mnt_01: { kind: 'PREVENTIVE', priority: 'HIGH' },
    mnt_02: { kind: 'CORRECTIVE', priority: 'HIGH', requestedById: 'usr_driver' },
    mnt_03: { kind: 'PREVENTIVE', priority: 'NORMAL' },
    mnt_04: { kind: 'PREVENTIVE', priority: 'NORMAL' },
    mnt_05: { kind: 'CORRECTIVE', priority: 'NORMAL' },
    mnt_06: { kind: 'CORRECTIVE', priority: 'LOW' },
  };
  for (const [id, vehicleId, title, description, scheduledAt, status, cost, startedOffset, completedOffset] of maintenanceItems) {
    await prisma.maintenance.upsert({
      where: { id },
      update: {},
      create: {
        id,
        vehicleId,
        title,
        description,
        scheduledAt,
        status,
        cost,
        startedAt: startedOffset !== null ? hours(startedOffset) : null,
        completedAt: completedOffset !== null ? hours(completedOffset) : null,
        createdById: 'usr_maint',
        createdAt: hours(-260),
        ...maintenanceMeta[id],
      },
    });
  }

  // --- DEMO digital inspection, defects, fuel and vendor SLA data ---
  for (const template of inspectionTemplates) {
    await prisma.inspectionTemplate.upsert({
      where: { id: template.id },
      update: {},
      create: template,
    });
  }

  const templateById = Object.fromEntries(inspectionTemplates.map((template) => [template.id, template]));
  for (const [id, vehicleId, driverId, tripId, templateId, type, status, odometerKm, offset, failedKeys] of inspectionSpecs) {
    const template = templateById[templateId];
    const isDraft = status === 'DRAFT';
    const startedById = driverId === 'dr_01' ? 'usr_driver' : 'usr_maint';
    await prisma.inspection.upsert({
      where: { id },
      update: {},
      create: {
        id,
        vehicleId,
        driverId,
        tripId,
        templateId,
        type,
        status,
        odometerKm,
        notes: 'Inspeksi demo',
        startedById,
        completedById: isDraft ? null : startedById,
        completedAt: isDraft ? null : hours(offset + 0.5),
        createdAt: hours(offset),
        updatedAt: hours(offset + 0.5),
      },
    });
    for (const item of template.items) {
      const failed = failedKeys.includes(item.key);
      await prisma.inspectionItem.upsert({
        where: { inspectionId_key: { inspectionId: id, key: item.key } },
        update: {},
        create: {
          inspectionId: id,
          key: item.key,
          label: item.label,
          critical: item.critical,
          checked: !failed,
          note: failed ? 'Tidak lolos pemeriksaan demo — lihat defect terkait' : '',
        },
      });
    }
  }

  for (const [id, vehicleId, inspectionId, maintenanceId, title, description, severity, status, reportedById] of defectSpecs) {
    await prisma.defect.upsert({
      where: { id },
      update: {},
      create: {
        id,
        vehicleId,
        inspectionId,
        maintenanceId,
        title,
        description,
        severity,
        status,
        reportedById,
        reportedAt: hours(-40),
        resolvedAt: status === 'RESOLVED' ? hours(-1) : null,
        resolutionNote: status === 'RESOLVED' ? 'Kalibrasi ulang selesai, hasil uji sesuai toleransi demo.' : null,
      },
    });
  }

  for (const [fuelType, pricePerLiter, notes] of fuelPrices) {
    await prisma.fuelPrice.upsert({
      where: { fuelType },
      update: {},
      create: { fuelType, pricePerLiter, effectiveFrom: days(-30), notes },
    });
  }

  for (const [id, vehicleId, driverId, tripId, fuelType, offset, liters, pricePerLiter, totalCost, odometerKm, paymentMethod, station, anomalyStatus] of allFuelTransactions) {
    await prisma.fuelTransaction.upsert({
      where: { id },
      update: {},
      create: {
        id,
        vehicleId,
        driverId,
        tripId,
        fuelType,
        transactionAt: hours(offset),
        liters,
        pricePerLiter,
        totalCost,
        odometerKm,
        paymentMethod,
        station,
        anomalyStatus,
        anomalyNote:
          anomalyStatus === 'FLAGGED'
            ? fuelType === 'DEXLITE'
              ? 'Harga per liter di atas referensi demo lebih dari 15%'
              : 'Volume pengisian melebihi kapasitas tangki kendaraan'
            : null,
        reviewedById: anomalyStatus === 'APPROVED' ? 'usr_fleet' : null,
        reviewedAt: anomalyStatus === 'APPROVED' ? hours(offset + 2) : null,
        createdById: 'usr_fleetofficer',
        createdAt: hours(offset),
      },
    });
  }

  for (const [id, vendorId, contractNumber, serviceScope, startOffset, endOffset, monthlyValue, status] of vendorContracts) {
    await prisma.vendorContract.upsert({
      where: { id },
      update: {},
      create: {
        id,
        vendorId,
        contractNumber,
        serviceScope,
        startDate: days(startOffset),
        endDate: days(endOffset),
        monthlyValue,
        status,
        notes: 'Kontrak demo — nilai dan target SLA bukan data kontrak resmi KCIC',
      },
    });
  }

  for (const [contractId, metric, target, unit] of slaDefinitions) {
    await prisma.slaDefinition.upsert({
      where: { contractId_metric: { contractId, metric } },
      update: {},
      create: { contractId, metric, target, unit, notes: 'Target SLA demo sesuai lampiran kontrak fiktif' },
    });
  }
  await prisma.booking.upsert({
    where: { id: 'bkg_demo_emg_01' },
    update: {},
    create: {
      id: 'bkg_demo_emg_01',
      code: 'DEMO-BKG-EMG-01',
      requesterId: 'usr_ops',
      department: 'Operations',
      purpose: 'Mobilisasi tim tanggap darurat ke lokasi insiden operasional',
      passengerCount: 4,
      origin: 'Kantor Pusat KCIC',
      destination: 'Stasiun Halim',
      routeId: 'rte_01',
      departureAt: hours(3),
      returnAt: hours(4.5),
      priority: 'EMERGENCY',
      emergencyReason: 'Skenario darurat demo: gangguan operasional membutuhkan mobilisasi cepat',
      status: 'APPROVED',
      decidedById: 'usr_ops',
      decidedAt: hours(-0.2),
      createdAt: hours(-0.5),
    },
  });
  await prisma.booking.upsert({
    where: { id: 'bkg_demo_emg_02' },
    update: {},
    create: {
      id: 'bkg_demo_emg_02',
      code: 'DEMO-BKG-EMG-02',
      requesterId: 'usr_employee',
      department: 'Crew Operations',
      purpose: 'Evakuasi kru yang terkendala di stasiun',
      passengerCount: 6,
      origin: 'Stasiun Padalarang',
      destination: 'Stasiun Halim',
      routeId: 'rte_04',
      departureAt: hours(1.5),
      returnAt: hours(3),
      priority: 'EMERGENCY',
      emergencyReason: 'Skenario darurat demo: kru membutuhkan transportasi segera karena gangguan layanan',
      status: 'PENDING',
      createdAt: hours(-0.4),
    },
  });

  // --- DEMO GPS telemetry (simulator only, never presented as real GPS) ---
  for (const fence of GEOFENCE_SEED) {
    await prisma.geofence.upsert({
      where: { id: fence.id },
      update: {},
      create: { ...fence, notes: 'Area demo untuk simulasi geofence' },
    });
  }

  const vehicleMeta = Object.fromEntries(
    vehicles.map(([id, plateNumber, brand, model, category, capacity, ownership, vendorId, status]) => [
      id,
      { plateNumber, ownership, vendorId, status },
    ])
  );
  const deviceIdByVehicle = {};

  for (let i = 0; i < vehicles.length; i += 1) {
    const [vehicleId] = vehicles[i];
    const meta = vehicleMeta[vehicleId];
    const deviceId = `gpsdev_${vehicleId}`;
    const inactive = meta.status === 'INACTIVE';
    deviceIdByVehicle[vehicleId] = deviceId;
    await prisma.gpsDevice.upsert({
      where: { id: deviceId },
      update: {},
      create: {
        id: deviceId,
        imei: `866000000000${String(i + 1).padStart(3, '0')}`,
        vehicleId,
        provider: DEMO_GPS_SOURCE,
        status: inactive ? 'INACTIVE' : 'ACTIVE',
        simNumber: `0817-DEMO-${100 + i}`,
        installedAt: days(-180),
        lastPingAt: inactive ? days(-2) : new Date(now - 20 * 1000),
      },
    });
  }

  const bookingRouteById = Object.fromEntries(bookingSpecs.map((booking) => [booking[0], booking[3]]));
  const activeTripVehicleIds = new Set(activeTrips.map((trip) => trip[2]));

  for (const [tripId, bookingId, vehicleId, , status, departOffset] of activeTrips) {
    const route = routeById[bookingRouteById[bookingId]];
    const moving = status === 'PICKED_UP' || status === 'IN_PROGRESS';
    const progress = moving
      ? Math.min(0.95, Math.max(0.06, ((-departOffset * 60) / route.estimatedMinutes)))
      : 0;
    for (let i = 0; i < 6; i += 1) {
      const t = Math.max(0, progress - (5 - i) * 0.03);
      const point = routePoint(route.origin, route.destination, t);
      await prisma.vehicleLocation.upsert({
        where: { id: `loc_act_${tripId}_${i}` },
        update: {},
        create: {
          id: `loc_act_${tripId}_${i}`,
          vehicleId,
          deviceId: deviceIdByVehicle[vehicleId],
          tripId,
          lat: point.lat,
          lng: point.lng,
          speedKph: moving ? 42 + (i % 4) * 3 : 0,
          heading: point.heading,
          ignition: true,
          accuracyM: 8,
          source: DEMO_GPS_SOURCE,
          recordedAt: new Date(now - (5 - i) * 3 * 60 * 1000),
        },
      });
    }
  }

  for (const [vehicleId, meta] of Object.entries(vehicleMeta)) {
    if (activeTripVehicleIds.has(vehicleId)) continue;
    const point = parkedPoint(vehicleId, meta.ownership, meta.vendorId);
    const outOfService = meta.status === 'INACTIVE' || meta.status === 'MAINTENANCE';
    await prisma.vehicleLocation.upsert({
      where: { id: `loc_park_${vehicleId}` },
      update: {},
      create: {
        id: `loc_park_${vehicleId}`,
        vehicleId,
        deviceId: deviceIdByVehicle[vehicleId],
        lat: point.lat,
        lng: point.lng,
        speedKph: 0,
        heading: 0,
        ignition: false,
        accuracyM: 9,
        source: DEMO_GPS_SOURCE,
        recordedAt: outOfService ? days(-2) : new Date(now - 30 * 1000),
      },
    });
  }

  // Historic coordinates for completed trips so replay works out of the box.
  for (const [tripId, bookingId, vehicleId, , departOffset, returnOffset] of completedTrips) {
    const route = routeById[bookingRouteById[bookingId]];
    const startMs = hours(departOffset).getTime();
    const endMs = hours(returnOffset).getTime();
    const steps = 24;
    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1);
      const point = routePoint(route.origin, route.destination, t);
      await prisma.vehicleLocation.upsert({
        where: { id: `loc_hist_${tripId}_${i}` },
        update: {},
        create: {
          id: `loc_hist_${tripId}_${i}`,
          vehicleId,
          deviceId: deviceIdByVehicle[vehicleId],
          tripId,
          lat: point.lat,
          lng: point.lng,
          speedKph: 45 + (i % 5) * 2,
          heading: point.heading,
          ignition: true,
          accuracyM: 7,
          source: DEMO_GPS_SOURCE,
          recordedAt: new Date(startMs + ((endMs - startMs) * i) / (steps - 1)),
        },
      });
    }
  }

  const gpsEventSeed = [
    ['gps_evt_demo_01', 'vh_01', 'trip_demo_13', 'geo_demo_halim', 'GEOFENCE_ENTER', 'B 1001 WSA masuk area Stasiun Halim', -0.6, 0],
    ['gps_evt_demo_02', 'vh_01', 'trip_demo_13', 'geo_demo_halim', 'GEOFENCE_EXIT', 'B 1001 WSA keluar area Stasiun Halim', -0.45, 24],
    ['gps_evt_demo_03', 'vh_02', 'trip_demo_14', null, 'OVERSPEED', 'B 1002 WSA terdeteksi 92 km/jam (batas 80 km/jam)', -0.3, 92],
    ['gps_evt_demo_04', 'vh_15', null, null, 'DEVICE_OFFLINE', 'Perangkat B 1015 WSA tidak mengirim sinyal', -2, 0],
    ['gps_evt_demo_05', 'vh_09', 'trip_demo_21', 'geo_demo_tegalluar', 'IDLE', 'B 1009 WSA idle lebih dari 30 menit di Depo Tegalluar', -1.2, 0],
    ['gps_evt_demo_06', 'vh_03', 'trip_demo_15', null, 'HARSH_BRAKING', 'B 1003 WSA terdeteksi pengereman mendadak', -0.2, 18],
    ['gps_evt_demo_07', 'vh_16', null, null, 'SIGNAL_RESTORED', 'Sinyal perangkat B 1016 WSA kembali (simulasi)', -1.5, 0],
    ['gps_evt_demo_08', 'vh_02', 'trip_demo_14', null, 'ROUTE_DEVIATION', 'B 1002 WSA menyimpang 2.4 km dari rute Stasiun Halim → Stasiun Karawang', -0.4, 46],
  ];
  for (const [id, vehicleId, tripId, geofenceId, type, message, offset, speedKph] of gpsEventSeed) {
    await prisma.gpsEvent.upsert({
      where: { id },
      update: {},
      create: {
        id,
        vehicleId,
        deviceId: deviceIdByVehicle[vehicleId],
        tripId,
        geofenceId,
        type,
        message,
        speedKph,
        source: DEMO_GPS_SOURCE,
        occurredAt: hours(offset),
      },
    });
  }

  const dbActiveTrips = await prisma.trip.findMany({
    where: { status: { in: ['SCHEDULED', 'DRIVER_ACCEPTED', 'PICKED_UP', 'IN_PROGRESS'] } },
    select: { driverId: true },
  });
  await prisma.driver.updateMany({ data: { available: true } });
  const busyDriverIds = [...new Set(dbActiveTrips.map((t) => t.driverId))];
  if (busyDriverIds.length) {
    await prisma.driver.updateMany({ where: { id: { in: busyDriverIds } }, data: { available: false } });
  }

  const seedAudits = [
    ['aud_demo_01', 'usr_fleet', 'BOOKING_APPROVE', 'Booking', 'bkg_demo_07', 'DEMO-BKG-0007 disetujui', -6],
    ['aud_demo_02', 'usr_dispatch', 'TRIP_ASSIGN', 'Trip', 'trip_demo_17', 'DEMO-BKG-0017: B 1005 WSA / Joko Susilo', -5],
    ['aud_demo_03', 'usr_maint', 'MAINTENANCE_START', 'Maintenance', 'mnt_02', 'B 1018 WSA: Perbaikan AC kabin', -3],
    ['aud_demo_04', 'usr_fleetofficer', 'VEHICLE_UPDATE', 'Vehicle', 'vh_14', 'B 1014 WSA', -2],
    ['aud_demo_05', 'usr_admin', 'USER_CREATE', 'User', 'usr_employee3', 'employee3@demo.local (CREW_EMPLOYEE)', -1.5],
    ['aud_demo_06', 'usr_driver', 'TRIP_STATUS', 'Trip', 'trip_demo_13', 'DEMO-BKG-0013 → IN_PROGRESS', -0.25],
  ];
  for (const [id, userId, action, entity, entityId, detail, offset] of seedAudits) {
    await prisma.auditLog.upsert({
      where: { id },
      update: {},
      create: { id, userId, action, entity, entityId, detail, createdAt: hours(offset) },
    });
  }

  const counts = {
    users: await prisma.user.count(),
    vendors: await prisma.vendor.count(),
    vehicles: await prisma.vehicle.count(),
    drivers: await prisma.driver.count(),
    routes: await prisma.route.count(),
    bookings: await prisma.booking.count(),
    trips: await prisma.trip.count(),
    maintenance: await prisma.maintenance.count(),
    auditLogs: await prisma.auditLog.count(),
    gpsDevices: await prisma.gpsDevice.count(),
    geofences: await prisma.geofence.count(),
    vehicleLocations: await prisma.vehicleLocation.count(),
    gpsEvents: await prisma.gpsEvent.count(),
    inspectionTemplates: await prisma.inspectionTemplate.count(),
    inspections: await prisma.inspection.count(),
    defects: await prisma.defect.count(),
    fuelTransactions: await prisma.fuelTransaction.count(),
    fuelPrices: await prisma.fuelPrice.count(),
    vendorContracts: await prisma.vendorContract.count(),
    slaDefinitions: await prisma.slaDefinition.count(),
    routePoints: await prisma.routePoint.count(),
  };
  console.log('[seed] Demo data ready:', counts);
  console.log(`[seed] Login accounts use password: ${PASSWORD}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[seed] failed', err);
  await prisma.$disconnect();
  process.exit(1);
});

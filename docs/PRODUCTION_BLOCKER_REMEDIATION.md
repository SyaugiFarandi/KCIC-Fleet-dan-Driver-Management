# PRODUCTION BLOCKER REMEDIATION — KCIC Fleet & Driver Management

Tanggal: 23 November 2026
Basis kode: commit lokal `0da127a` + remediasi incremental (belum di-commit, belum di-push)
Lingkungan verifikasi: Windows, Node.js 24, PostgreSQL 16 lokal (`:5544`), API uji `:4010`/`:4020`, web uji `:5181`

Dokumen ini merangkum remediasi seluruh blocker produksi hasil audit (`PRODUCTION_READINESS_AUDIT.md`,
`SECURITY_AUDIT.md`). Setiap blocker diberi status akhir berdasarkan bukti yang benar-benar dijalankan
di lingkungan ini — bukan asumsi atau klaim integrasi eksternal.

---

## 1. Ringkasan status

| # | Blocker | Prioritas | Status |
|---|---------|-----------|--------|
| 1 | JWT secret lemah/placeholder & startup guard | P0 | **RESOLVED** |
| 2 | Race condition penugasan kendaraan/driver | P0 | **RESOLVED** |
| 3 | HTTPS deployment & cookie `Secure` | P0 | **RESOLVED** (konfigurasi); sertifikat nyata = tanggung jawab deployment |
| 4 | Backup & restore teruji | P0 | **RESOLVED** (skrip + drill); penjadwalan/PITR = operasional |
| 5 | Seed demo berjalan saat boot produksi | P1 | **RESOLVED** |
| 6 | Advisory dependensi | P1 | **RESOLVED** — `npm audit` 0 vulnerabilities (backend & frontend) |
| 7 | Observability (log, request ID, metrik, alert) | P1 | **RESOLVED** |
| 8 | GPS hanya simulator tanpa batas adapter | P2 | **RESOLVED** — adapter + ingest perangkat; perangkat nyata belum diuji |
| 9 | Notifikasi hanya in-app tanpa adapter eksternal | P2 | **RESOLVED** — adapter + riwayat pengiriman; pengiriman eksternal nonaktif tanpa kredensial |

**Status keseluruhan: READY FOR STAGING** (data sintetis, akses terbatas, label DEMO aktif).
**BELUM READY FOR PRODUCTION** sampai item operasional pada §5 dipenuhi.

Batasan yang dipatuhi: tidak membuat project baru, tidak menghapus data existing, tidak menghapus test,
tidak melakukan Git push, tidak mengubah commit baseline, dan tidak mengklaim integrasi eksternal aktif.

---

## 2. Detail remediasi per blocker

### Blocker 1 — JWT secret & startup guard (P0) — RESOLVED

- `backend/src/config.js` memvalidasi `JWT_SECRET` saat `NODE_ENV=production`: wajib ada, minimal 32
  karakter, bukan placeholder (`replace-this-demo`, `change-me`, dll.), dan minimal 10 karakter unik.
  `CORS_ORIGIN=*` ditolak; `COOKIE_SECURE=false` ditolak kecuali `ALLOW_INSECURE_HTTP=true`.
- Secret tidak pernah dicetak ke log; logger meredaksi kunci `password|token|secret|authorization|cookie|jwt|api_key`.
- Bukti: `backend/test/config.test.js` — 11/11 lulus (secret kosong, pendek, placeholder, wildcard CORS,
  cookie non-Secure, token metrik/ingest pendek, kombinasi valid diterima).

### Blocker 2 — Concurrency penugasan (P0) — RESOLVED

- `backend/src/lib/assignments.js:17` memakai `pg_advisory_xact_lock` per kunci kendaraan/driver di dalam
  transaksi; `backend/src/routes/trips.js:219,281` memakai `SELECT ... FOR UPDATE` untuk booking dan trip.
- Perubahan status trip memakai compare-and-set (`updateMany` dengan status lama) sehingga dua request
  bersamaan tidak menggandakan event (409 bila status sudah berubah).
- Bukti: `backend/test/concurrency.test.js` — 3/3 lulus: dua booking tidak bisa berbagi kendaraan yang sama,
  tidak bisa berbagi driver yang sama, dan dua request untuk booking yang sama hanya membuat satu trip.

### Blocker 3 — HTTPS & cookie Secure (P0) — RESOLVED (konfigurasi)

- `deploy/nginx.https.conf`: redirect HTTP→HTTPS, TLS 1.2/1.3, HSTS `max-age=31536000; includeSubDomains`,
  header keamanan, dan proxy SSE tanpa buffering untuk `/api/(notifications|gps)/stream`.
- `docker-compose.prod.yml`: `NODE_ENV=production`, `COOKIE_SECURE=true`, `ALLOW_INSECURE_HTTP=false`,
  `JWT_SECRET` dan `CORS_ORIGIN` wajib di-interpolasi (compose gagal bila kosong), port 443 + mount
  `./deploy/certs` read-only.
- Cookie `fleet_session` bersifat `httpOnly`, `SameSite=Lax`; `Secure` mengikuti konfigurasi dan dipaksa
  `true` oleh overlay produksi.
- Bukti: `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` valid dengan env dummy;
  smoke mode production (port 4020) menunjukkan login 200, token tidak ada di body, cookie HttpOnly/SameSite
  benar. `Secure=false` hanya pada smoke demo HTTP dengan `ALLOW_INSECURE_HTTP=true` (opt-in eksplisit).
- Sisa tanggung jawab deployment: pasang sertifikat nyata di `deploy/certs` dan uji dari jaringan nyata.

### Blocker 4 — Backup & restore (P0) — RESOLVED (skrip + drill)

- `scripts/backup.sh`: `pg_dump -Fc` + checksum SHA-256 + metadata; menolak jalan bila container/DB tidak ada.
- `scripts/restore.sh`: menolak menimpa DB live (`fleet_demo`) atau DB yang sudah ada, memverifikasi checksum,
  restore ke DB staging baru, lalu mencetak hitungan verifikasi.
- Drill nyata 2026-11-23: dump 312 KB, restore 4 detik, hitungan objek identik dengan sumber
  (tables 25, migrations 5, users 13, bookings 37, trips 13, vehicles 18, audit 93); penolakan ke DB live
  dan DB existing diuji (exit 2); DB staging dihapus, DB live tidak tersentuh.
- Detail prosedur: `docs/BACKUP_RESTORE_RUNBOOK.md`.
- Gap operasional (bukan kode): belum ada penjadwalan otomatis, retensi, enkripsi backup, atau WAL/PITR.

### Blocker 5 — Seed demo terpisah dari boot produksi (P1) — RESOLVED

- `backend/prisma/seed.js` menolak berjalan saat `NODE_ENV=production` kecuali `ALLOW_DEMO_SEED=true`.
- `docker-compose.prod.yml` mengganti command API menjadi `prisma generate && prisma migrate deploy && node src/server.js`
  dan menyediakan service `seed` one-off di profile `seed` yang tidak ikut boot default.
- Compose demo tetap menjalankan seed dengan data sintetis (label DEMO).
- Bukti: `backend/test/seed-guard.test.js` lulus; validasi compose produksi sukses.

### Blocker 6 — Advisory dependensi (P1) — RESOLVED

- Backend: `zod@^4.6.7` (sebelumnya 3.25.76, HIGH GHSA-mrhx-c7xc-m3w5); `nodemailer@^10.6.1` setelah
  advisory pada versi lama. `npm audit --omit=dev` → **0 vulnerabilities**.
- Frontend: `react-router-dom@^7.18.6`, `vite@^7.3.8` (naik dari 6.x). `npm audit --omit=dev` →
  **0 vulnerabilities**. Tidak ada downgrade atau pemaksaan mayor tanpa kebutuhan.
- Regression dicek lewat suite backend penuh dan build Vite produksi (lihat §3).

### Blocker 7 — Observability (P1) — RESOLVED

- Log JSON terstruktur ke stdout/stderr dengan `ts`, `level`, `service`, `env`, `message`, `requestId`,
  `method`, `path`, `status`, `durationMs`, `userId`; redaksi otomatis untuk field sensitif.
- `X-Request-Id` diterima (format tervalidasi) atau digenerate, dicerminkan di response, dan dipakai di log.
- `GET /api/health`: status DB + latensi, status simulator GPS, uptime; 503 saat DB gagal.
- `GET /api/metrics`: Prometheus, token-gated (`X-Metrics-Token` ≥16 karakter; 404 bila tidak diset),
  mencakup request counter, error class, latency summary, tick simulator, uptime, RSS.
- Panduan metrik dan alert: `docs/OBSERVABILITY_GUIDE.md`.
- Bukti: `backend/test/observability.test.js` + `observability-hidden.test.js` lulus; smoke produksi
  mengembalikan 401 tanpa token dan 200 dengan token (`fleet_http_requests_total`,
  `fleet_gps_simulator_ticks_total`).

### Blocker 8 — GPS simulator & adapter provider (P2) — RESOLVED

- Simulator demo dipertahankan dan tetap berlabel `DEMO_SIMULATOR` (top-level response + disclaimer).
- `backend/src/lib/gpsProviders.js` memisahkan klasifikasi telemetri: `SIMULATED`, `LIVE`, `STALE`, `OFFLINE`.
  `LIVE` hanya bila data segar berasal dari ingest perangkat dan device berstatus `ACTIVE`; data simulator
  tidak pernah dihitung `LIVE`. Ambang stale default 60 detik, offline 2 menit.
- `backend/src/routes/gpsIngest.js`: `POST /api/gps/ingest` dengan token (`x-gps-token`, timing-safe),
  validasi zod, penolakan timestamp masa depan >5 menit / backfill >7 hari, 404 IMEI tak dikenal,
  409 device nonaktif. Endpoint **tersembunyi (404)** bila `GPS_INGEST_TOKEN` tidak diset.
- UI GPS menampilkan mode telemetri, status ingest, ambang stale/offline, dan pill per kendaraan.
- Bukti: `backend/test/gps-ingest.test.js` (4), `gps-ingest-hidden.test.js` (1), plus suite GPS lama.
- Catatan jujur: belum ada perangkat/provider GPS nyata yang diuji; integrasi LIVE bersifat adapter siap pakai.

### Blocker 9 — Kanal notifikasi eksternal (P2) — RESOLVED

- Notifikasi in-app tetap selalu aktif dan tidak bergantung konfigurasi eksternal.
- `backend/src/lib/notificationChannels.js`: adapter Email (nodemailer) dan Telegram (Bot API) dengan
  enable-flag + validasi kredensial; retry maksimal 3 percobaan (backoff dari `NOTIFICATION_RETRY_BASE_MS`);
  target dimask (`a***@demo.local`, `***7890`); setiap percobaan tercatat di `NotificationDelivery`
  (`PENDING`/`SENT`/`FAILED`/`SKIPPED`) dan tidak pernah menyimpan atau mencatat secret.
- Startup produksi gagal cepat bila channel diaktifkan tanpa kredensial yang valid
  (`EMAIL_NOTIFICATIONS_ENABLED` butuh `SMTP_HOST`+`EMAIL_FROM`; `TELEGRAM_NOTIFICATIONS_ENABLED` butuh
  `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID`).
- Endpoint admin (`audit:read`): `GET /api/notifications/channels` dan `GET /api/notifications/deliveries`
  (paginasi, filter channel/status, status tanpa secret). UI Notifications menampilkan kartu channel dan
  riwayat pengiriman terakhir hanya untuk role berwenang.
- Bukti: `notification-channels.test.js` (6), `notification-channels-disabled.test.js` (1), config guards.
- Catatan jujur: tidak ada pengiriman keluar nyata karena tidak ada kredensial SMTP/Telegram valid di
  lingkungan ini; seluruh pengujian memakai transport stub. Channel tetap nonaktif secara default.

---

## 3. Bukti verifikasi

### 3.1 Test backend

Perintah: `cd backend && npm test` (Node test runner, `--test-concurrency=1`, DB `fleet_test`).

```
tests 102
pass 102
fail 0
```

Cakupan baru pada remediasi: config guards (11), seed guard, concurrency (3), GPS ingest (6),
notification channels (9), observability (4), di samping auth/RBAC/workflow/features lama.

### 3.2 Build frontend

`cd frontend && npm run build` — build Vite produksi sukses (tanpa error).

### 3.3 Validasi Docker Compose

- `docker compose config` (demo) valid.
- `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` valid dengan `JWT_SECRET` +
  `CORS_ORIGIN` dummy; overlay menolak (interpolasi gagal) bila keduanya kosong.

### 3.4 Smoke test mode production (port 4020, cookie auth)

| Cek | Hasil |
|-----|-------|
| `GET /api/health` | 200, `environment=production`, `database=up`, GPS `DEMO_SIMULATOR` |
| `POST /api/auth/login` | 200, token **tidak** ada di body, cookie `HttpOnly`, `SameSite=Lax` |
| `GET /api/gps/positions` (cookie) | 200, source `DEMO_SIMULATOR`, 14 item, mode SIMULATED/LIVE/STALE/OFFLINE |
| `GET /api/notifications/channels` | 200, EMAIL/TELEGRAM `enabled=false`, `configured=false` |
| `GET /api/notifications/deliveries` | 200, 0 item |
| `GET /api/notifications/channels` (driver) | 403 |
| `POST /api/gps/ingest` tanpa konfigurasi | 404 |
| `GET /api/metrics` tanpa/dengan token | 401 / 200 (`fleet_http_requests_total`, `fleet_gps_simulator_ticks_total`) |

Catatan: pada production login tidak mengembalikan token di body (cookie-only). Smoke dengan Bearer token
harus memakai `ALLOW_INSECURE_HTTP`/mode non-production; verifikasi produksi memakai cookie.

### 3.5 Dependency audit

`npm audit --omit=dev` backend dan frontend → **0 vulnerabilities** (23 Nov 2026).

### 3.6 Verifikasi UI

GPS Monitoring dan Notifications diperiksa di browser (dev server `:5181`, API `:4010`): banner telemetri,
pill status, badge detail, kartu channel, dan tabel riwayat tampil; console bersih. Screenshot tidak
tersedia pada sesi ini karena viewport browser headless tersembunyi; verifikasi dilakukan lewat DOM
(`evaluate_script`).

---

## 4. Perubahan file utama

| Area | File |
|------|------|
| Konfigurasi & guard | `backend/src/config.js`, `backend/src/lib/session.js`, `backend/src/routes/auth.js` |
| Concurrency | `backend/src/lib/assignments.js`, `backend/src/routes/trips.js`, `backend/test/concurrency.test.js` |
| HTTPS | `deploy/nginx.https.conf`, `docker-compose.prod.yml`, `.env.example` |
| Backup | `scripts/backup.sh`, `scripts/restore.sh`, `docs/BACKUP_RESTORE_RUNBOOK.md` |
| Seed | `backend/prisma/seed.js`, `docker-compose.prod.yml`, `backend/test/seed-guard.test.js` |
| Observability | `backend/src/lib/logger.js`, `backend/src/middleware/requestId.js`, `backend/src/routes/health.js`, `backend/src/lib/metrics.js`, `docs/OBSERVABILITY_GUIDE.md` |
| GPS | `backend/src/lib/gpsProviders.js`, `backend/src/routes/gpsIngest.js`, `backend/src/routes/gps.js`, `frontend/src/pages/GpsMonitoring.jsx`, `frontend/src/gps.css` |
| Notifikasi | `backend/src/lib/notificationChannels.js`, `backend/src/lib/notifications.js`, `backend/src/routes/notifications.js`, `backend/prisma/schema.prisma`, migrasi `20261123095809_notification_channels`, `frontend/src/pages/Notifications.jsx`, `frontend/src/extras.css` |

Tidak ada route bisnis yang dihapus dan tidak ada data existing yang dihapus. Migrasi baru hanya menambah
tabel `NotificationDelivery`.

---

## 5. Gap yang tersisa untuk PRODUCTION (di luar remediasi kode)

1. **TLS nyata**: pasang sertifikat valid, arahkan DNS, uji HSTS dan cookie `Secure` dari jaringan nyata.
2. **Operasional backup**: penjadwalan otomatis, retensi offsite, enkripsi, dan WAL/PITR untuk RPO < 24 jam.
3. **Database terkelola**: tutup port DB, role aplikasi least privilege, password kuat dari secret manager.
4. **Integrasi eksternal nyata**: perangkat/provider GPS dan kredensial SMTP/Telegram valid; sampai itu ada,
   label DEMO dan channel nonaktif dipertahankan.
5. **Skala & ketahanan**: arsitektur masih single-instance (SSE, rate limiter in-memory, simulator stateful);
   rate limit global, uji beban, dan pentest eksternal belum dilakukan.
6. **Presisi finansial**: kolom uang/jarak masih `Float` (M1); pertimbangkan `Decimal` sebelum data finansial nyata.
7. **Revocation sesi**: JWT 12 jam tanpa daftar pencabutan; pertimbangkan sesi lebih pendek/rotasi.

---

## 6. Kesimpulan

Seluruh blocker yang dapat diselesaikan di dalam repo telah diselesaikan dan diverifikasi dengan test,
build, validasi compose, dan smoke mode production. Tidak ada klaim integrasi eksternal aktif: GPS tetap
simulator dengan adapter ingest yang siap, dan notifikasi eksternal tetap nonaktif tanpa kredensial valid.

**Status akhir: READY FOR STAGING** — layak untuk demo internal/staging dengan data sintetis dan akses
terbatas. **NOT READY FOR PRODUCTION** sampai gap operasional §5 terpenuhi dan diverifikasi di
infrastruktur target.

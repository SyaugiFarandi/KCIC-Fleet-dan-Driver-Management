# PRODUCTION READINESS AUDIT — KCIC Fleet & Driver Management

Tanggal audit awal: 23 November 2026
Basis kode: commit lokal `0da127a` + hardening dan remediasi incremental (belum di-commit, belum di-push)
Lingkungan uji: Windows, Node.js 24, PostgreSQL 16 lokal (`:5544`), API `:4010`/`:4020`, web `:5180`/`:5181`
Batasan: tidak ada Git push, commit `0da127a` tidak diubah, tidak ada data existing yang dihapus.

> **Pembaruan remediasi (23 November 2026):** seluruh blocker P0/P1/P2 yang dapat diselesaikan di repo
> telah diperbaiki dan diverifikasi — lihat `docs/PRODUCTION_BLOCKER_REMEDIATION.md` untuk bukti per
> blocker. Dokumen ini mempertahankan temuan audit awal dan menandai status akhirnya.

---

## 1. Ringkasan eksekutif

Aplikasi adalah demo operasional armada yang lengkap secara fungsional: booking → approval → dispatch →
eksekusi trip → inspeksi/BBM/maintenance, dengan RBAC di backend, audit trail, GPS simulator, PWA driver,
dan **102 test integrasi yang lulus**. Setelah remediasi, aplikasi juga memiliki guard konfigurasi
produksi, penanganan concurrency penugasan, konfigurasi HTTPS, backup/restore teruji, seed terpisah dari
boot produksi, observability, serta adapter GPS dan notifikasi eksternal yang dibatasi konfigurasi.

Temuan awal audit (TLS, backup, seed, JWT placeholder, race penugasan, advisory dependensi, observability)
telah ditutup pada level kode dan konfigurasi. Yang tersisa adalah **pekerjaan operasional di infrastruktur
target**: pemasangan sertifikat nyata, penjadwalan backup/PITR, database terkelola dengan least privilege,
kredensial integrasi eksternal nyata, uji beban/pentest, dan penskalaan multi-instance.

**Status akhir: READY FOR STAGING** (data sintetis, akses terbatas, label DEMO).
**NOT READY FOR PRODUCTION** sampai item operasional pada §8 dipenuhi dan diverifikasi di infrastruktur nyata.

---

## 2. Metode audit

1. Membaca ulang backend (`app.js`, `config.js`, `server.js`, middleware, seluruh route utama, `lib/*`,
   `schema.prisma`), frontend (auth/api/router, halaman kritis, CSS), Docker, nginx, dan dokumentasi.
2. Menelusuri alur auth/RBAC, isolasi data, transaksi penugasan/status trip, GPS, dan migrasi/seed.
3. Menjalankan test suite penuh dan build produksi frontend.
4. Menjalankan smoke test mode produksi (login, cookie, guard konfigurasi) pada port terpisah.
5. Menjalankan `npm audit --omit=dev` untuk backend dan frontend.
6. QA visual halaman login pada 1440×900, 390×844, dan dark mode (Chrome headless via CDP).
7. Drill backup/restore nyata ke database staging terpisah, tanpa menyentuh DB live.

Tidak dilakukan: rebuild penuh Docker Compose (hanya `docker compose config`), uji beban, uji penetrasi,
uji restore ke volume produksi, dan pengujian perangkat GPS nyata.

---

## 3. Temuan dan status akhir

### CRITICAL

Tidak ada temuan CRITICAL yang dapat dieksploitasi langsung dari luar pada konfigurasi demo.

### HIGH

| ID | Area | Temuan awal | Remidiasi | Status |
|----|------|-------------|-----------|--------|
| H1 | Backup/DR | Tidak ada backup otomatis, retensi, PITR, atau prosedur restore teruji. | `scripts/backup.sh` (+checksum/metadata) dan `scripts/restore.sh` (guard DB live/existing, restore ke DB staging) + `docs/BACKUP_RESTORE_RUNBOOK.md`; drill restore 4 detik, hitungan objek identik. | **RESOLVED** (penjadwalan/PITR = operasional) |
| H2 | Transport | Compose menyajikan HTTP polos; cookie dapat disadap. | `docker-compose.prod.yml` (HTTPS, `COOKIE_SECURE=true`, `ALLOW_INSECURE_HTTP=false`) + `deploy/nginx.https.conf` (TLS 1.2/1.3, HSTS, redirect). | **RESOLVED** (konfigurasi); sertifikat nyata = deployment |
| H3 | Deployment | Seed demo dijalankan setiap boot container API. | Seed menolak production tanpa `ALLOW_DEMO_SEED=true`; overlay produksi memakai `migrate deploy` + `server.js`; service `seed` one-off di profile terpisah. | **RESOLVED** |
| H4 | Secrets | `JWT_SECRET` placeholder lolos dengan warning. | Guard production: wajib ada, ≥32 karakter, bukan placeholder, cukup acak; `METRICS_TOKEN`/`GPS_INGEST_TOKEN` minimal 16 karakter. | **RESOLVED** |
| H5 | Concurrency | Dua booking dapat memakai kendaraan/driver sama secara bersamaan. | `pg_advisory_xact_lock` per kendaraan/driver di `assignments.js`, `FOR UPDATE` pada booking/trip, compare-and-set status; 3 test konkuren. | **RESOLVED** |
| H6 | Dependency | `zod@3.25.76` advisory HIGH. | Upgrade ke `zod@^4.6.7`; seluruh test lulus; `npm audit` 0 vulnerabilities. | **RESOLVED** |
| H7 | Observability | Tanpa APM, metrik, alert, request ID, atau log terstruktur. | Log JSON + redaksi secret, `X-Request-Id`, health (DB + simulator), `/api/metrics` token-gated, panduan alert `docs/OBSERVABILITY_GUIDE.md`. | **RESOLVED** |

### MEDIUM

| ID | Area | Temuan | Status akhir |
|----|------|--------|--------------|
| M1 | Data | Nilai uang/jarak/BBM memakai `Float`. | OPEN — perlu `Decimal` sebelum data finansial nyata |
| M2 | Auth | Rate limiter login in-memory, per-instance, tanpa lockout akun. | OPEN — pindahkan ke Redis untuk multi-instance |
| M3 | Integrasi | GPS murni simulator tanpa endpoint ingest/otentikasi perangkat. | **RESOLVED** — adapter `gpsProviders.js`, `POST /api/gps/ingest` token-gated, status SIMULATED/LIVE/STALE/OFFLINE; perangkat nyata belum diuji |
| M4 | Notifikasi | Bus in-process; tidak ada delivery email/Telegram. | **RESOLVED** — adapter Email/Telegram dengan retry, masking, riwayat `NotificationDelivery`; nonaktif tanpa kredensial |
| M5 | Database | Port DB diekspos + password demo statis; role owner. | OPEN — tutup port, secret manager, role least privilege untuk produksi |
| M6 | Header/CSP | CSP `style-src 'unsafe-inline'`, Google Fonts eksternal; HSTS belum ada. | PARTIAL — HSTS ditambahkan di `nginx.https.conf`; `unsafe-inline`/font eksternal masih kebutuhan aplikasi |
| M7 | Sesi | JWT 12 jam tanpa refresh/revocation list. | ACCEPTED — user dimuat ulang tiap request; pertimbangkan sesi lebih pendek |
| M8 | Dependency | Advisory frontend (`react-router`, `vite/esbuild`). | **RESOLVED** — `react-router-dom@^7.18.6`, `vite@^7.3.8`; `npm audit` 0 vulnerabilities |
| M9 | Deploy | Arsitektur single-instance (SSE, limiter, simulator stateful). | OPEN — batasan arsitektur; perlu Redis/queue untuk scaling |
| M10 | Kredensial demo | Password seluruh akun demo `Demo123!` dan tercantum di UI. | ACCEPTED dengan label DEMO |
| M11 | API | Tidak ada rate limit global per IP/endpoint selain login; tidak ada WAF. | OPEN — pertimbangkan rate limit global/reverse-proxy |
| M12 | Enumerasi | Email tak dikenal tidak menjalankan bcrypt (timing enumerasi). | OPEN — risiko rendah, pesan error generik |

### LOW

| ID | Temuan | Status akhir |
|----|--------|--------------|
| L1 | `/api/health` menampilkan nama environment. | ACCEPTED |
| L2 | `CORS_ORIGIN='*'` diizinkan di development. | FIXED — ditolak di production oleh guard |
| L3 | Tidak ada request ID di log/audit. | **FIXED** — `X-Request-Id` di response dan log |
| L4 | Cache user di `localStorage` (tanpa token) bisa basi. | ACCEPTED — role efektif tetap dari backend |
| L5 | `Permissions-Policy` API vs nginx tidak konsisten. | ACCEPTED — fitur tidak memakai geolokasi browser |

### PASS (terverifikasi)

| Area | Bukti |
|------|-------|
| RBAC ditegakkan di backend | `backend/src/lib/permissions.js` + `requirePermission`; test RBAC lulus. |
| Isolasi data | Driver hanya trip sendiri, employee hanya booking sendiri; `test/rbac.test.js`. |
| Validasi input | zod schema per route (kini zod 4); Prisma parameterized; raw SQL hanya health check. |
| Auth | Cookie `httpOnly`, `SameSite=Lax`, JWT diverifikasi, user aktif dimuat ulang, bcrypt, pesan generik, kegagalan login diaudit. |
| CSRF | SameSite=Lax + allowlist CORS + JSON-only + tidak ada state change via GET. |
| Security header | `nosniff`, `DENY`, Referrer-Policy, Permissions-Policy, COOP/CORP di API; CSP + HSTS + header di nginx HTTPS. |
| Container | API berjalan sebagai `USER node`; nginx `server_tokens off`. |
| Audit trail | Perubahan master data dan workflow menulis `AuditLog`. |
| Integritas | `Trip.bookingId @unique`; index komposit `VehicleLocation(vehicleId, recordedAt)` dan `GpsEvent(vehicleId, occurredAt)`; lock penugasan. |
| Migrasi & seed | Migrasi Prisma + `prisma migrate deploy`; seed idempotent dan dijaga dari production. |
| Kesehatan & shutdown | `/api/health` mengecek DB + simulator; SIGTERM/SIGINT menutup server; handler `unhandledRejection`/`uncaughtException`. |
| Backup | Skrip backup/restore + drill restore terverifikasi ke DB staging. |
| GPS ingest | Token timing-safe, validasi timestamp, penolakan IMEI/device tidak valid, endpoint tersembunyi tanpa token. |
| Notifikasi eksternal | Gated config, retry maksimal 3, masking target, riwayat hanya untuk `audit:read`, tanpa secret di response/log. |
| Test & build | 102/102 test lulus; build Vite produksi lulus; `npm audit` 0 vulnerabilities. |

---

## 4. Perbaikan yang diterapkan

Semua perubahan menyentuh hardening/konfigurasi/adapter dan tidak mengubah alur bisnis inti.

| Area | File |
|------|------|
| Konfigurasi & guard | `backend/src/config.js`, `backend/src/lib/session.js`, `backend/src/routes/auth.js` |
| Concurrency | `backend/src/lib/assignments.js`, `backend/src/routes/trips.js` |
| HTTPS | `docker-compose.prod.yml`, `deploy/nginx.https.conf`, `.env.example` |
| Backup | `scripts/backup.sh`, `scripts/restore.sh`, `docs/BACKUP_RESTORE_RUNBOOK.md` |
| Seed | `backend/prisma/seed.js`, `docker-compose.prod.yml` |
| Observability | `backend/src/lib/logger.js`, `backend/src/middleware/requestId.js`, `backend/src/routes/health.js`, `backend/src/lib/metrics.js`, `docs/OBSERVABILITY_GUIDE.md` |
| GPS | `backend/src/lib/gpsProviders.js`, `backend/src/routes/gpsIngest.js`, `backend/src/routes/gps.js`, `frontend/src/pages/GpsMonitoring.jsx`, `frontend/src/gps.css` |
| Notifikasi | `backend/src/lib/notificationChannels.js`, `backend/src/lib/notifications.js`, `backend/src/routes/notifications.js`, `backend/prisma/schema.prisma`, migrasi `20261123095809_notification_channels`, `frontend/src/pages/Notifications.jsx`, `frontend/src/extras.css` |

Catatan: perubahan bersifat lokal dan belum di-commit. Commit `0da127a` tidak diubah dan tidak ada push.
Rincian bukti per blocker: `docs/PRODUCTION_BLOCKER_REMEDIATION.md`.

---

## 5. Bukti pengujian

### 5.1 Test suite backend

```
ℹ tests 102
ℹ pass 102
ℹ fail 0
```

Mencakup auth, RBAC, isolasi data, alur booking→trip, konflik jadwal, concurrency penugasan, inspeksi/checklist,
BBM, SLA, GPS simulator + ingest, notifikasi in-app + channel eksternal, observability, ekspor, config guards,
dan seed guard.

### 5.2 Build frontend

```
✓ built
```

### 5.3 Smoke test mode production (port 4020)

- `GET /api/health` → 200, `environment=production`, `database=up`, GPS `DEMO_SIMULATOR`.
- `POST /api/auth/login` → 200, cookie `fleet_session` `HttpOnly`, `SameSite=Lax`; body hanya `user`
  (token tidak diekspos di production).
- `GET /api/gps/positions` (cookie) → 200, `source=DEMO_SIMULATOR`, mode SIMULATED/LIVE/STALE/OFFLINE.
- `GET /api/notifications/channels` → 200, EMAIL/TELEGRAM nonaktif dan belum terkonfigurasi.
- `GET /api/notifications/deliveries` → 200, kosong (belum ada pengiriman eksternal).
- Driver → `/api/notifications/channels` 403; `POST /api/gps/ingest` tanpa konfigurasi 404.
- `/api/metrics` → 401 tanpa token, 200 dengan token.
- Guard konfigurasi: tanpa `JWT_SECRET`, `CORS_ORIGIN=*`, `COOKIE_SECURE=false` tanpa opt-in, token pendek,
  dan channel aktif tanpa kredensial semuanya ditolak saat startup production.
- `docker compose config` demo dan overlay produksi valid (overlay memerlukan `JWT_SECRET` + `CORS_ORIGIN`).

### 5.4 QA login (Chrome headless/CDP)

- 1440×900: tanpa overflow (`scrollWidth = 1440`), form, tile kapabilitas, dan 5 akun demo tampil penuh.
- 390×844: tanpa overflow horizontal (`scrollWidth = 390`), akun demo bertumpuk satu kolom.
- Dark mode: kartu, input, chip, dan daftar akun memakai token gelap; tidak ada teks gelap di atas latar gelap.
- Klik akun demo mengisi `admin@demo.local` + `Demo123!`; toggle kata sandi berada di dalam field.

### 5.5 Dependency audit

- Backend dan frontend: `npm audit --omit=dev` → **0 vulnerabilities** (zod 4.6.7, react-router 7.18.6,
  vite 7.3.8, nodemailer 10.6.1).

---

## 6. Integrasi: apa yang nyata dan apa yang demo

| Klaim | Realitas |
|-------|----------|
| GPS monitoring | **Demo simulator lokal**. Adapter ingest perangkat tersedia (`POST /api/gps/ingest`, token-gated) dan status telemetri membedakan SIMULATED/LIVE/STALE/OFFLINE, tetapi belum ada perangkat/provider nyata yang diuji. Label `DEMO_SIMULATOR` dan disclaimer tetap tampil. |
| Notifikasi | In-app selalu aktif. Adapter Email dan Telegram tersedia dengan retry, masking, dan riwayat pengiriman, tetapi **nonaktif** dan tidak mengirim keluar tanpa kredensial valid. Pengujian memakai transport stub. |
| Peta | Tile OpenStreetMap eksternal; posisi kendaraan tetap data simulator. |
| Auth | Nyata (bcrypt + JWT + cookie httpOnly), tetapi kredensial demo dipublikasikan di halaman login (label DEMO). |
| Data | Sintetis, dibuat seed idempotent. Bukan data operasional KCIC. |

---

## 7. Rekomendasi prioritas (sebelum produksi)

1. **TLS nyata (H2)**: pasang sertifikat valid, arahkan DNS, verifikasi HSTS dan cookie `Secure` dari jaringan nyata.
2. **Operasional backup (H1)**: jadwalkan `scripts/backup.sh`, retensi offsite/terenkripsi, dan WAL/PITR untuk RPO < 24 jam; uji restore berkala.
3. **Database (M1/M5)**: DB terkelola tanpa port publik, role least privilege, secret manager; pertimbangkan `Decimal` untuk nilai finansial.
4. **Integrasi nyata (M3/M4)**: uji perangkat GPS nyata pada endpoint ingest dan kredensial SMTP/Telegram valid; sampai itu, pertahankan label DEMO dan channel nonaktif.
5. **Skala (M2/M9/M11)**: Redis untuk rate limit/bus notifikasi, rate limit global, dan desain multi-instance untuk SSE/simulator.
6. **Uji lanjutan**: uji beban, uji penetrasi eksternal, dan rehearsal restore di infrastruktur target.
7. **Sesi (M7)**: pertimbangkan JWT lebih pendek/rotasi atau revocation list.

---

## 8. Status akhir dan kondisi

**READY FOR STAGING** dengan kondisi:

- akses terbatas pada jaringan internal/localhost, data sintetis, dan label DEMO tetap terlihat;
- `JWT_SECRET` diganti dari placeholder (guard produksi menolak placeholder);
- backup harian dijalankan walau manual dan pernah diuji restore;
- peserta demo memahami bahwa GPS dan pengiriman notifikasi eksternal tidak aktif secara nyata.

**NOT READY FOR PRODUCTION** sampai item operasional berikut terpenuhi dan diverifikasi di infrastruktur target:

- TLS nyata + `COOKIE_SECURE=true` + HSTS terverifikasi;
- backup terjadwal/PITR + retensi + drill restore berkala;
- database tidak terekspos, role least privilege, secret manager;
- kredensial integrasi GPS/email/Telegram nyata (atau tetap nonaktif dengan label DEMO);
- uji beban/pentest dan rencana scaling multi-instance.

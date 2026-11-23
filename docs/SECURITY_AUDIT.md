# SECURITY AUDIT — KCIC Fleet & Driver Management

Tanggal audit awal: 23 November 2026
Basis: commit `0da127a` + hardening dan remediasi incremental (belum di-commit, belum di-push)
Cakupan: autentikasi, otorisasi/RBAC, isolasi data, validasi input, sesi/CSRF, header/CSP,
manajemen secret, error handling, dependency, integrasi GPS/notifikasi, ekspor data, dan risiko deployment.
Tidak dilakukan: pentest eksternal, uji beban, dan pengujian infrastruktur jaringan nyata.

> **Pembaruan remediasi:** temuan keamanan pada level kode/konfigurasi telah ditutup dan diuji —
> lihat `docs/PRODUCTION_BLOCKER_REMEDIATION.md`. Risiko yang tersisa bersifat operasional
> (infrastruktur, kredensial nyata, skala) dan dicantumkan pada §8.

---

## 1. Ringkasan

- Tidak ditemukan kerentanan CRITICAL (RCE/SQLi/auth bypass) pada kode aplikasi.
- RBAC dan isolasi data ditegakkan di backend, bukan hanya UI, dan tercakup test.
- Remidiasi menutup risiko konfigurasi utama: guard `JWT_SECRET`/CORS/cookie produksi, seed terpisah,
  HTTPS + HSTS, backup/restore teruji, concurrency penugasan, observability, dan endpoint ingest GPS
  ber-token dengan timing-safe comparison.
- Notifikasi eksternal bersifat opt-in, memvalidasi kredensial saat startup, memask target, menyimpan
  riwayat pengiriman tanpa secret, dan hanya dapat dibaca role dengan `audit:read`.
- `npm audit --omit=dev` backend dan frontend: **0 vulnerabilities** (zod 4.6.7, react-router 7.18.6,
  vite 7.3.8, nodemailer 10.6.1).

**Status: READY FOR STAGING.** Belum production-ready karena item operasional pada §8 (TLS nyata,
database least privilege, backup terjadwal/PITR, kredensial integrasi nyata, uji beban/pentest).

---

## 2. Model ancaman singkat

Asumsi demo: aplikasi berjalan lokal/internal, pengguna memakai akun demo, data sintetis,
GPS simulator, dan channel notifikasi eksternal nonaktif. Aktor yang dipertimbangkan:

1. Pengguna terautentikasi dengan role rendah (crew employee/driver) yang mencoba naik hak akses.
2. Penyerang jaringan yang dapat menyadap HTTP lokal.
3. Pengguna tak terautentikasi yang mencoba brute force/login.
4. Operator yang salah konfigurasi saat menaikkan ke server bersama.
5. Pengirim data palsu ke endpoint ingest GPS.

---

## 3. Autentikasi dan sesi

| Kontrol | Implementasi | Penilaian |
|---------|--------------|-----------|
| Password hashing | bcrypt, 10 rounds (`BCRYPT_ROUNDS`) | PASS |
| Login rate limit | 10 gagal / 15 menit per `ip|email`, in-memory | PARTIAL (M2: single-instance) |
| Pesan error | Generik `Email atau password salah` | PASS |
| Audit | `LOGIN_FAILED`, `LOGIN`, `LOGOUT` | PASS |
| JWT | HS256, `sub` + `role`, expiry 12 jam | PARTIAL (M7: tanpa revocation) |
| JWT secret | Guard production: wajib ada, ≥32 karakter, bukan placeholder, cukup acak | **RESOLVED** |
| Cookie | `fleet_session`, `httpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=12h`; `Secure` dipaksa `true` oleh overlay produksi | PASS |
| Bearer | Didukung untuk test/alat di non-production; production cookie-only | PASS |
| Reload user | Tiap request memuat ulang user dan menolak user nonaktif | PASS |
| Token di body | Tidak dikirim saat `NODE_ENV=production` | FIXED |
| Logout | Menghapus cookie + audit | PASS |

Catatan: JWT 12 jam tanpa refresh/revocation list. Penonaktifan user tetap efektif seketika karena
`requireAuth` memuat ulang user dari DB. Untuk produksi, pertimbangkan rotasi secret dan sesi lebih pendek.

---

## 4. Otorisasi dan isolasi data

### 4.1 RBAC

Sumber tunggal: `backend/src/lib/permissions.js`, ditegakkan dengan `requirePermission(...)` pada route.
Role: `SYSTEM_ADMIN`, `FLEET_MANAGER`, `DRIVER_COORDINATOR`, `MAINTENANCE_OFFICER`, `DISPATCHER`,
`CREW_EMPLOYEE`, `DRIVER`. `STAFF` = lima role non-driver/non-crew.

Contoh kontrol yang diuji:

- Crew employee tidak bisa membaca master data armada, seluruh trip, atau audit log.
- Driver tidak bisa mengakses master driver/armada, tidak bisa assign trip, hanya trip miliknya.
- Dispatcher tidak bisa membaca audit log atau mengelola user.
- Fleet manager tidak bisa mengelola user, tetapi bisa menghapus kendaraan yang tidak terpakai.
- Maintenance officer tidak bisa membuat kendaraan, tetapi bisa membaca maintenance.
- Driver coordinator bisa membuat driver, bukan kendaraan.
- Employee hanya melihat booking miliknya dan tidak bisa approve.
- Driver tidak bisa membuka channel/delivery notifikasi (`403`), karena route membutuhkan `audit:read`.

Hasil: **PASS** (`test/rbac.test.js`, `test/notification-channels*.test.js`).

### 4.2 Isolasi data per pengguna

- Driver: daftar/ubah trip difilter berdasarkan `driver.userId`.
- Crew employee: booking difilter berdasarkan `requesterId`.
- Dashboard personal mengikuti role; data agregat hanya untuk staff.
- Delivery notifikasi menyertakan `userId` hanya untuk role `audit:read`.

Hasil: **PASS**.

### 4.3 Endpoint ingest GPS

- `POST /api/gps/ingest` berada sebelum middleware auth manusia, tetapi:
  - endpoint **404** bila `GPS_INGEST_TOKEN` tidak diset;
  - wajib header `x-gps-token` dengan perbandingan timing-safe;
  - payload divalidasi zod; timestamp masa depan >5 menit atau backfill >7 hari ditolak;
  - IMEI tidak dikenal → 404, device nonaktif → 409;
  - hanya device ACTIVE terdaftar yang dapat menghasilkan status `LIVE`.
- Tidak ada pembocoran token di response atau log; request body tidak dicatat.

Hasil: **PASS** (`test/gps-ingest.test.js`, `gps-ingest-hidden.test.js`).

---

## 5. Validasi input dan injeksi

| Vektor | Kontrol | Penilaian |
|--------|---------|-----------|
| SQL injection | Prisma ORM parameterized; raw SQL hanya `SELECT 1` health check dan lock/`FOR UPDATE` dengan parameter | PASS |
| Mass assignment | Route memilih field eksplisit; tidak ada spread `req.body` ke Prisma | PASS |
| Payload besar | `express.json({ limit: '1mb' })` | PASS |
| Validasi tipe/format | zod 4 schema per route (email, enum status, tanggal, angka, IMEI, koordinat) | PASS |
| Path/ID | ID dipakai sebagai nilai `where`, bukan string SQL | PASS |
| CSV injection | `lib/csv.js` memberi prefix `'` pada sel berbahaya (`= + @ -` non-angka) | PASS |
| XLS injection | `lib/excel.js` menulis semua teks sebagai `ss:Type="String"` dan meng-escape XML | PASS |
| XSS | React meng-escape output; tidak ada `dangerouslySetInnerHTML`; CSP `script-src 'self'` | PASS |
| Upload file | Tidak ada endpoint upload | N/A |
| SSRF | Tidak ada fetch server-side ke URL pengguna; adapter Telegram hanya ke `TELEGRAM_API_BASE` yang dikonfigurasi | PASS |

Catatan dependency: advisory `zod <4.6.6` (memory exhaustion) telah ditutup dengan upgrade ke zod 4;
`npm audit` kini bersih.

---

## 6. Proteksi browser dan header

| Kontrol | Implementasi | Penilaian |
|---------|--------------|-----------|
| CSP (nginx) | `default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`; `object-src 'none'`; `frame-ancestors 'none'` | PASS dengan catatan M6 |
| Header API | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP | PASS |
| HSTS | `Strict-Transport-Security: max-age=31536000; includeSubDomains` di `deploy/nginx.https.conf` | **RESOLVED** (aktif saat HTTPS) |
| TLS | TLS 1.2/1.3, HTTP→HTTPS redirect, session tickets off | **RESOLVED** (konfigurasi) |
| CORS | Allowlist origin, `credentials: true`; wildcard ditolak di production | PASS/FIXED |
| CSRF | `SameSite=Lax` + JSON-only + tidak ada state change via GET + allowlist CORS | PASS |
| Clickjacking | `X-Frame-Options: DENY` + `frame-ancestors 'none'` | PASS |
| Token di localStorage | Tidak ada; hanya cache profil user (tanpa token) | PASS |

---

## 7. Error handling, logging, dan secret

### 7.1 Error handling

- `ZodError` → 400 dengan detail field.
- `HttpError` → status + pesan terkontrol.
- Prisma `P2002/P2025/P2003` → 409/404/409 tanpa membocorkan query.
- Error lain → 500 generik; detail hanya bila `NODE_ENV=development` dan bukan test.
- Handler `unhandledRejection`/`uncaughtException` menutup proses dengan exit code 1.

### 7.2 Logging

- Log JSON terstruktur dengan `requestId`, `method`, `path`, `status`, `durationMs`, `userId`.
- `X-Request-Id` inbound divalidasi formatnya, atau UUID v4 digenerate; dicerminkan di response.
- Logger meredaksi key sensitif (`password|token|secret|authorization|cookie|jwt|api_key`) dan memotong
  string panjang. Body/header/cookie tidak pernah dicatat.
- Error 5xx, kegagalan audit, kegagalan worker GPS, dan kegagalan notifikasi tercatat sebagai event terpisah.
- Metrik Prometheus token-gated (`/api/metrics`); panduan alert di `docs/OBSERVABILITY_GUIDE.md`.

### 7.3 Secret

- `JWT_SECRET` dibaca dari env; default kode hanya untuk lokal.
- Guard production menolak secret kosong, <32 karakter, placeholder (`replace-this-demo`, `change-me`, dll.),
  atau entropi rendah; menolak `CORS_ORIGIN=*` dan cookie non-Secure tanpa opt-in eksplisit.
- `METRICS_TOKEN` dan `GPS_INGEST_TOKEN` minimal 16 karakter bila diset; endpoint tersembunyi bila kosong.
- `EMAIL_NOTIFICATIONS_ENABLED`/`TELEGRAM_NOTIFICATIONS_ENABLED` gagal startup bila kredensial tidak lengkap.
- SMTP/Telegram secret tidak pernah dikembalikan API, tidak masuk riwayat delivery, dan tidak dicatat log;
  error transport disanitasi agar token/URL tidak bocor.
- Tidak ada secret hard-coded lain di repo; `.env` di-ignore Git.

---

## 8. Risiko deployment dan infrastruktur

| Risiko | Dampak | Status |
|--------|--------|--------|
| HTTP tanpa TLS | Cookie/kredensial dapat disadap | **RESOLVED (config)** — overlay HTTPS + HSTS; sertifikat nyata wajib dipasang |
| `COOKIE_SECURE=false` di demo | Cookie tanpa flag Secure | Demo lokal opt-in `ALLOW_INSECURE_HTTP=true`; produksi menolak |
| DB port `5544` diekspos + password demo | Akses DB langsung bila host terjangkau | OPEN M5 — tutup port, secret manager, role least privilege |
| Seed demo saat boot | Data demo masuk ke DB produksi | **RESOLVED** — seed guard + command produksi tanpa seed |
| Tanpa backup/PITR | Kehilangan data permanen | **RESOLVED (skrip+drill)** — penjadwalan/PITR = operasional |
| Single instance | Rate limit/SSE/simulator tidak konsisten saat scaling | OPEN M9 — perlu Redis/queue |
| Tanpa rate limit global | Penyalahgunaan endpoint selain login | OPEN M11 |
| Tanpa monitoring/alert | Insiden tidak terdeteksi | **RESOLVED** — log/metrik/health + panduan alert; pengiriman ke stack eksternal = operasional |
| Integrasi eksternal diklaim aktif | Ekspektasi palsu | Adapter GPS/email/Telegram nonaktif secara default; label DEMO dipertahankan |

---

## 9. Dependency audit (npm audit --omit=dev)

### Backend

```
found 0 vulnerabilities
```

`zod@^4.6.7`, `nodemailer@^10.6.1`, `@prisma/client@^5.22.0`, `express@^4.21.2`.

### Frontend

```
found 0 vulnerabilities
```

`react-router-dom@^7.18.6`, `vite@^7.3.8`, `react@^18.3.1`.

Tidak ada downgrade atau pemaksaan mayor tanpa kebutuhan; regression dicek lewat suite backend 102 kasus
dan build Vite produksi.

---

## 10. Temuan peringkat (ringkas)

| ID | Severity | Temuan | Status |
|----|----------|--------|--------|
| H1 | HIGH | Tidak ada backup/restore otomatis | **RESOLVED** (skrip + drill); penjadwalan/PITR operasional |
| H2 | HIGH | HTTP tanpa TLS; cookie non-Secure di demo | **RESOLVED (config)** — HTTPS overlay + HSTS |
| H3 | HIGH | Seed demo saat boot | **RESOLVED** |
| H4 | HIGH | JWT secret placeholder | **RESOLVED** |
| H5 | HIGH | Race penugasan lintas booking | **RESOLVED** |
| H6 | HIGH | Advisory `zod` | **RESOLVED** |
| H7 | HIGH | Observability/logging | **RESOLVED** |
| M1 | MEDIUM | Float untuk nilai uang | OPEN |
| M2 | MEDIUM | Rate limit in-memory, tanpa trust proxy | OPEN |
| M3 | MEDIUM | GPS simulator saja | **RESOLVED** — adapter + ingest; perangkat nyata belum diuji |
| M4 | MEDIUM | Notifikasi in-process | **RESOLVED** — adapter + riwayat; eksternal nonaktif default |
| M5 | MEDIUM | DB terekspos, role owner | OPEN |
| M6 | MEDIUM | CSP `unsafe-inline`, font eksternal | PARTIAL — HSTS ditambahkan; CSP mengikuti kebutuhan UI |
| M7 | MEDIUM | JWT 12 jam tanpa revocation | ACCEPTED |
| M8 | MEDIUM | Advisory frontend | **RESOLVED** |
| M9 | MEDIUM | Single-instance | OPEN |
| M10 | MEDIUM | Password demo dipublikasikan | ACCEPTED (DEMO) |
| M11 | MEDIUM | Tanpa rate limit global | OPEN |
| M12 | MEDIUM | Timing enumerasi email | OPEN (rendah) |
| L1–L5 | LOW | Lihat PRODUCTION_READINESS_AUDIT | INFO (L2/L3 FIXED) |

---

## 11. Rekomendasi keamanan prioritas

1. Pasang TLS nyata, verifikasi HSTS dan cookie `Secure` dari jaringan nyata.
2. Secret manager; rotasi JWT; pertimbangkan sesi lebih pendek/revocation.
3. Database terkelola: tutup port, role aplikasi least privilege, password kuat.
4. Backup terjadwal + retensi + PITR + uji restore berkala.
5. Rate limit global dan proteksi brute force berbasis penyimpanan bersama (Redis) bila multi-instance.
6. Pengiriman log/metrik ke agregator + error tracking; aktifkan alert sesuai `OBSERVABILITY_GUIDE.md`.
7. Uji perangkat GPS nyata dan kredensial email/Telegram valid sebelum mengaktifkan integrasi eksternal.
8. Uji beban dan pentest eksternal; pertimbangkan `Decimal` untuk data finansial.

---

## 12. Kesimpulan

Dari sisi kode aplikasi, kontrol auth, RBAC, validasi, audit, dan penanganan secret tergolong baik.
Seluruh temuan HIGH pada audit awal telah ditutup dan diverifikasi dengan test, build, validasi compose,
drill backup/restore, serta smoke mode production. Tidak ada klaim integrasi eksternal yang belum terbukti.

**READY FOR STAGING** dengan akses terbatas dan data sintetis. **NOT READY FOR PRODUCTION** sampai risiko
operasional §8 diselesaikan di infrastruktur target.

# DEPLOYMENT CHECKLIST — KCIC Fleet & Driver Management

Gunakan bersama `docs/PRODUCTION_READINESS_AUDIT.md`, `docs/SECURITY_AUDIT.md`, dan
`docs/PRODUCTION_BLOCKER_REMEDIATION.md`. Checklist ini mengasumsikan deployment single-node
(db + api + web) di belakang reverse proxy HTTPS.

---

## 0. Status

- **Demo lokal (HTTP, data sintetis):** `docker compose up -d --build` — siap.
- **Staging:** **READY** dengan data sintetis, akses terbatas, dan label DEMO.
- **Production:** **BELUM**, sampai item operasional §1 yang masih terbuka (bertanda `[ ]`) selesai di
  infrastruktur target. Blocker kode/konfigurasi sudah diselesaikan di repo.

---

## 1. Blocker sebelum produksi

Sudah diselesaikan di repo dan diverifikasi:

- [x] Guard `JWT_SECRET` produksi (wajib ≥32 karakter acak, menolak placeholder).
- [x] Seed demo tidak berjalan saat boot produksi; seed hanya lewat profile `seed`.
- [x] Concurrency penugasan ditangani (advisory lock + `FOR UPDATE`) dan diuji.
- [x] Dependency berisiko di-upgrade; `npm audit --omit=dev` 0 vulnerabilities.
- [x] Log terstruktur, request ID, health check, metrik, dan panduan alert tersedia.
- [x] Skrip backup/restore + drill restore ke DB staging.
- [x] Konfigurasi HTTPS (TLS 1.2/1.3, HSTS, redirect) dan overlay produksi dengan cookie `Secure`.
- [x] Adapter GPS ingest ber-token dan adapter notifikasi Email/Telegram dengan riwayat pengiriman.

Masih menjadi tanggung jawab deployment (wajib sebelum produksi):

- [ ] Pasang sertifikat TLS nyata di `deploy/certs` dan verifikasi HSTS/cookie `Secure` dari jaringan nyata.
- [ ] `JWT_SECRET` acak dari secret manager (bukan file ter-commit).
- [ ] Jadwalkan `scripts/backup.sh`, retensi offsite/terenkripsi, dan aktifkan WAL/PITR.
- [ ] Database terkelola: port tidak publik, role aplikasi least privilege, password kuat.
- [ ] Kirim log/metrik ke agregator (Loki/ELK/CloudWatch) dan aktifkan alert.
- [ ] Kredensial nyata GPS/email/Telegram (atau biarkan nonaktif dengan label DEMO).
- [ ] Uji beban dan pentest; rencana scaling multi-instance (Redis/queue).

---

## 2. Variabel environment

| Variabel | Demo compose | Produksi | Catatan |
|----------|--------------|----------|---------|
| `NODE_ENV` | `production` | `production` | Menonaktifkan detail error/log dev. |
| `JWT_SECRET` | placeholder (ditolak guard) | **wajib acak ≥32 byte** | Guard menolak kosong/pendek/placeholder. |
| `COOKIE_SECURE` | `false` (HTTP lokal) | `true` (dipaksa overlay) | Wajib true saat HTTPS. |
| `ALLOW_INSECURE_HTTP` | `true` (demo) | `false` | Opt-in eksplisit untuk cookie non-Secure di demo. |
| `CORS_ORIGIN` | allowlist localhost | origin web final | Wildcard ditolak di production. |
| `DATABASE_URL` | `postgresql://fleet:...@db:5432/fleet_demo` | kredensial terkelola | Jangan pakai password demo. |
| `PORT` | `4000` | `4000`/sesuai | API listen. |
| `JWT_EXPIRES_IN` | `12h` | pertimbangkan lebih pendek | Tanpa refresh token. |
| `BCRYPT_ROUNDS` | `10` | ≥10 (ukur CPU) | Menaikkan memperlambat login. |
| `GPS_SIM_ENABLED` | `true` | **`false`** kecuali demo | Simulator bukan integrasi nyata. |
| `GPS_SIM_INTERVAL_MS` | `15000` | n/a | Minimum 3000. |
| `GPS_INGEST_TOKEN` | kosong | kosong atau ≥16 karakter | Kosong = endpoint ingest 404; isi = aktifkan ingest perangkat. |
| `GPS_STALE_AFTER_MS` | `60000` | sesuai SLA | Ambang status STALE; OFFLINE tetap 2 menit. |
| `METRICS_TOKEN` | kosong | ≥16 karakter | Kosong = `/api/metrics` 404; isi = scrape token. |
| `EMAIL_NOTIFICATIONS_ENABLED` | `false` | `false` kecuali kredensial valid | Butuh `SMTP_HOST` + `EMAIL_FROM`. |
| `SMTP_HOST/PORT/SECURE/USER/PASS`, `EMAIL_FROM` | kosong | sesuai SMTP | Jangan commit kredensial. |
| `TELEGRAM_NOTIFICATIONS_ENABLED` | `false` | `false` kecuali kredensial valid | Butuh `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`. |
| `NOTIFICATION_RETRY_BASE_MS` | `500` | `500`/sesuai | Backoff retry (maks 3 percobaan). |
| `ALLOW_DEMO_SEED` | `true` (demo) | **`false`** | Seed produksi ditolak kecuali true eksplisit. |
| `SEED_PASSWORD` | `Demo123!` | jangan dipakai | Hanya untuk seed demo. |
| `WEB_HTTPS_PORT` / `TLS_CERT_DIR` | n/a | `8443` / path cert | Overlay produksi. |

Port default compose: web `8090`, API `4010`, DB `5544` (ubah via `.env` di root project).
Overlay produksi: web HTTPS `8443` (default) → container `443`.

---

## 3. Pre-deploy

- [ ] Commit/tag image yang akan dideploy (jangan deploy working tree kotor).
- [ ] `docker compose config` valid (demo).
- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` valid dengan
      `JWT_SECRET` dan `CORS_ORIGIN` produksi (overlay menolak bila kosong).
- [ ] `cd backend && npm ci && npm test` → **102/102 lulus**.
- [ ] `cd frontend && npm ci && npm run build` → build sukses.
- [ ] `npm audit --omit=dev` backend & frontend → catat hasil (saat audit: 0 vulnerabilities).
- [ ] Backup DB terbaru tersedia dan **diuji restore** ke DB sementara (`scripts/restore.sh` menolak
      menimpa DB live).
- [ ] Review migrasi Prisma terbaru (`20261123095809_notification_channels` hanya menambah tabel
      `NotificationDelivery`); pastikan tidak ada `DROP` tak terduga.
- [ ] Secret dimasukkan lewat environment/secret manager, bukan file ter-commit.
- [ ] DNS, sertifikat TLS di `deploy/certs`, dan reverse proxy siap.

---

## 4. Langkah deploy

Demo lokal (HTTP):

```bash
docker compose up -d --build
docker compose ps
curl -s http://localhost:4010/api/health
```

Staging/produksi (overlay HTTPS):

```bash
JWT_SECRET="$(openssl rand -base64 48)" \
CORS_ORIGIN="https://fleet.example.internal" \
METRICS_TOKEN="<token-16+-chars>" \
WEB_HTTPS_PORT=8443 \
TLS_CERT_DIR=./deploy/certs \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Catatan:

- Overlay produksi menjalankan `npx prisma generate && npx prisma migrate deploy && node src/server.js`
  — **tidak** menjalankan seed.
- Seed demo/staging hanya lewat profile terpisah:
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile seed run --rm seed`
  (dengan `ALLOW_DEMO_SEED=true`).
- Jangan mengaktifkan `EMAIL_NOTIFICATIONS_ENABLED`/`TELEGRAM_NOTIFICATIONS_ENABLED` tanpa kredensial
  valid — startup produksi akan gagal cepat (by design).

Deploy manual (tanpa Docker):

```bash
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
NODE_ENV=production COOKIE_SECURE=true node src/server.js

cd ../frontend
npm ci
npm run build
# serve dist/ via nginx HTTPS (gunakan deploy/nginx.https.conf sebagai acuan)
```

---

## 5. Smoke test pasca-deploy

- [ ] `GET /api/health` → `ok:true`, `database:up`, dan status simulator sesuai konfigurasi.
- [ ] Login admin berhasil; `Set-Cookie` berisi `HttpOnly`, `SameSite=Lax`, dan **`Secure`** di HTTPS.
- [ ] Body login produksi **tidak** memuat `token`; uji API memakai cookie sesi.
- [ ] Logout menghapus cookie; akses `/api/auth/me` → 401.
- [ ] RBAC negatif: crew employee → `/api/audit` dan `/api/vehicles` 403; driver → `/api/notifications/channels` 403.
- [ ] Alur utama: booking → approve → assign → ubah status trip → selesai.
- [ ] Driver hanya melihat trip miliknya.
- [ ] GPS Monitoring menampilkan mode telemetri (SIMULATED/LIVE/STALE/OFFLINE); `source=DEMO_SIMULATOR`
      saat simulator aktif dan disclaimer terlihat.
- [ ] `POST /api/gps/ingest` → 404 bila `GPS_INGEST_TOKEN` kosong; 401 tanpa header token bila diset.
- [ ] `GET /api/notifications/channels` → status channel tanpa secret; `deliveries` kosong/terisi sesuai aktivitas.
- [ ] SSE notifikasi tersambung (tanpa buffering, tidak terputus proxy).
- [ ] `GET /api/metrics` → 401 tanpa token, 200 dengan `X-Metrics-Token`.
- [ ] Ekspor laporan `.xls`/CSV terunduh dan terbuka.
- [ ] Dark mode & tampilan mobile login/dashboard tidak overflow.
- [ ] `docker compose logs api` bersih dari error 500 berulang.

Contoh cek cookie:

```bash
curl -s -D - -o /dev/null \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.local","password":"Demo123!"}' \
  https://<host>/api/auth/login | grep -i set-cookie
```

---

## 6. Backup

Prosedur lengkap: `docs/BACKUP_RESTORE_RUNBOOK.md`. Ringkas:

```bash
./scripts/backup.sh /secure/backups
./scripts/restore.sh /secure/backups/fleet_demo_<stamp>.dump fleet_restore_check
```

- `backup.sh` menghasilkan dump `-Fc`, checksum SHA-256, dan metadata.
- `restore.sh` menolak menimpa DB live atau DB yang sudah ada, memverifikasi checksum, dan mencetak
  hitungan verifikasi.
- Simpan salinan offsite terenkripsi; retensi minimal 7 harian + 4 mingguan (sesuaikan kebijakan).
- Untuk PITR, aktifkan WAL archiving di PostgreSQL terkelola/instalasi.
- Jadwalkan drill restore berkala dan catat hasilnya. Jangan menimpa DB produksi saat uji.

---

## 7. Rollback

1. Hentikan trafik baru atau arahkan ke instance lama.
2. Deploy image/tag sebelumnya.
3. Jika migrasi gagal di tengah jalan, **jangan** `prisma migrate reset`. Gunakan
   `prisma migrate resolve --rolled-back <migration>` hanya setelah insiden migrasi terkonfirmasi.
4. Jika migrasi sudah diterapkan dan data berubah, pulihkan dari backup terakhir yang tervalidasi
   (restore ke DB baru, verifikasi, lalu arahkan `DATABASE_URL`).
5. Jalankan smoke test §5 sebelum membuka trafik.

---

## 8. Operasional dan monitoring

- [ ] Scrape `/api/metrics` dengan `X-Metrics-Token`; aktifkan alert pada `docs/OBSERVABILITY_GUIDE.md`
      (API down, DB down, 5xx ratio, latensi, simulator stalled, memory, restart loop).
- [ ] Kirim log JSON ke agregator; gunakan `X-Request-Id` untuk korelasi dengan nginx.
- [ ] Error tracking (Sentry dsb.) untuk exception backend/frontend bila tersedia.
- [ ] Job harian: backup + verifikasi ukuran/checksum; mingguan: uji restore.
- [ ] Rotasi log dan retensi audit sesuai kebijakan.
- [ ] Pantau koneksi SSE dan jumlah klien; restart API memutus SSE (klien reconnect).
- [ ] Jika multi-instance: pindahkan rate limiter dan bus notifikasi ke Redis/queue; simulator GPS
      berjalan di satu worker; tinjau ulang SSE.

---

## 9. Go / No-Go

**Go untuk staging/demo internal** bila:

- [ ] `JWT_SECRET` diganti, akses terbatas, data sintetis, label DEMO terlihat.
- [ ] Backup tersedia dan pernah diuji restore.
- [ ] Peserta mengetahui GPS berupa simulator dan channel notifikasi eksternal nonaktif.

**No-Go untuk produksi** bila masih ada:

- [ ] HTTP tanpa TLS atau `COOKIE_SECURE=false` di luar opt-in demo.
- [ ] Seed demo berjalan saat boot.
- [ ] Tanpa backup/PITR teruji dan terjadwal.
- [ ] Placeholder JWT secret atau secret di file ter-commit.
- [ ] Database terekspos publik atau role owner.
- [ ] Tanpa monitoring/alert yang benar-benar terkirim.
- [ ] Kredensial GPS/email/Telegram belum valid tetapi channel diaktifkan.

Keputusan saat ini: **READY FOR STAGING / DEMO INTERNAL**.
**NOT READY FOR PRODUCTION** sampai item terbuka §1 dan §9 diselesaikan serta diverifikasi di infrastruktur nyata.

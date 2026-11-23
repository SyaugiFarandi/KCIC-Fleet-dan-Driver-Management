import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  CloudUpload,
  Clock,
  Fuel,
  MapPin,
  RefreshCw,
  Trash2,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtDateTime } from '../format.js';
import { enqueue, flushQueue, readQueue, removeQueueItem, subscribeQueue } from '../offlineQueue.js';
import { Badge, ErrorBanner, Field, Modal, PageHeader, Spinner, useConfirm, useToast } from '../ui.jsx';

const FUEL_TYPES = ['BIOSOLAR', 'PERTALITE', 'PERTAMAX', 'DEXLITE'];

const NEXT_ACTION = {
  SCHEDULED: { status: 'DRIVER_ACCEPTED', label: 'Terima penugasan' },
  PICKED_UP: { status: 'IN_PROGRESS', label: 'Mulai perjalanan' },
  IN_PROGRESS: { status: 'COMPLETED', label: 'Selesaikan trip' },
};

const ACTIVE_ORDER = ['IN_PROGRESS', 'PICKED_UP', 'DRIVER_ACCEPTED', 'SCHEDULED'];
const CLOSED = ['COMPLETED', 'CANCELLED'];

function readCache(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

export default function DriverHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const cacheKey = `fleet_driver_cache_${user.id}`;

  const [trips, setTrips] = useState([]);
  const [queue, setQueue] = useState(() => readQueue());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [stale, setStale] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [fuelOpen, setFuelOpen] = useState(false);
  const [fuelBusy, setFuelBusy] = useState(false);
  const [fuelForm, setFuelForm] = useState({ tripId: '', fuelType: 'BIOSOLAR', liters: '', pricePerLiter: '', station: '' });
  const previousQueue = useRef(queue.length);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('/trips', { query: { pageSize: 200 } });
      const items = result.items || [];
      setTrips(items);
      setStale(false);
      localStorage.setItem(cacheKey, JSON.stringify({ savedAt: new Date().toISOString(), items: items.slice(0, 50) }));
      setError(null);
    } catch (err) {
      const cached = readCache(cacheKey);
      if (cached) {
        setTrips(cached.items);
        setStale(true);
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    if (!navigator.onLine) {
      const cached = readCache(cacheKey);
      if (cached) {
        setTrips(cached.items);
        setStale(true);
        setLoading(false);
        return;
      }
    }
    load();
  }, [cacheKey, load]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(
    () =>
      subscribeQueue((items) => {
        setQueue(items);
        if (items.length < previousQueue.current) load();
        previousQueue.current = items.length;
      }),
    [load]
  );

  const activeTrips = trips
    .filter((trip) => !CLOSED.includes(trip.status))
    .sort((a, b) => ACTIVE_ORDER.indexOf(a.status) - ACTIVE_ORDER.indexOf(b.status));
  const completedCount = trips.filter((trip) => trip.status === 'COMPLETED').length;
  const scheduledCount = trips.filter((trip) => trip.status === 'SCHEDULED').length;

  const perform = async (trip, status) => {
    if (status === 'COMPLETED') {
      const ok = await confirm({
        title: 'Selesaikan trip?',
        message: `Trip ${trip.booking.code} akan ditandai selesai dan booking terkait menjadi COMPLETED.`,
        confirmLabel: 'Selesaikan',
      });
      if (!ok) return;
    }
    setBusyId(trip.id);
    const label = `${status === 'COMPLETED' ? 'Selesaikan' : status === 'IN_PROGRESS' ? 'Mulai' : 'Terima'} ${trip.booking.code}`;
    try {
      if (!online) {
        enqueue({ label, path: `/trips/${trip.id}/status`, method: 'PATCH', body: { status } });
        toast.success('Offline: aksi disimpan di antrean dan dikirim saat online.');
        return;
      }
      await api(`/trips/${trip.id}/status`, { method: 'PATCH', body: { status } });
      toast.success('Status trip diperbarui.');
      await load();
    } catch (err) {
      if (!err.status) {
        enqueue({ label, path: `/trips/${trip.id}/status`, method: 'PATCH', body: { status } });
        toast.success('Koneksi terputus: aksi disimpan di antrean.');
      } else {
        toast.error(err.message);
      }
    } finally {
      setBusyId('');
    }
  };

  const syncNow = async () => {
    if (!queue.length) return;
    setSyncing(true);
    try {
      const summary = await flushQueue();
      if (summary.ok) toast.success(`${summary.ok} aksi tersinkronkan.`);
      if (summary.failed || summary.conflict) toast.error(summary.messages.slice(0, 2).join(' · '));
      if (!summary.ok && summary.remaining) toast.error('Sinkronisasi belum berhasil; antrean tetap disimpan.');
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const submitFuel = async (event) => {
    event.preventDefault();
    if (!fuelForm.tripId) {
      toast.error('Pilih trip untuk pengajuan bahan bakar.');
      return;
    }
    if (!(Number(fuelForm.liters) > 0)) {
      toast.error('Volume bahan bakar harus lebih dari 0 liter.');
      return;
    }
    setFuelBusy(true);
    try {
      await api('/fuel', {
        method: 'POST',
        body: {
          tripId: fuelForm.tripId,
          fuelType: fuelForm.fuelType,
          liters: Number(fuelForm.liters),
          ...(fuelForm.pricePerLiter ? { pricePerLiter: Number(fuelForm.pricePerLiter) } : {}),
          ...(fuelForm.station ? { station: fuelForm.station } : {}),
          paymentMethod: 'FUEL_CARD',
        },
      });
      toast.success('Pengajuan bahan bakar tercatat dan menunggu review.');
      setFuelOpen(false);
      setFuelForm({ tripId: '', fuelType: 'BIOSOLAR', liters: '', pricePerLiter: '', station: '' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setFuelBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="PWA driver"
        title="Tugas Saya"
        subtitle="Penugasan perjalanan Anda, dapat diakses dari ponsel. Saat offline, pembaruan status diantrekan dan dikirim otomatis ketika koneksi kembali."
        actions={
          <>
            <span className={`sync-chip sync-chip-static ${online ? '' : 'sync-chip-offline'}`}>
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              {online ? 'Online' : 'Offline'}
            </span>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {(stale || !online) && (
        <div className="panel driver-stale">
          <WifiOff size={16} />
          <div>
            <b>{online ? 'Menampilkan data tersimpan.' : 'Anda sedang offline.'}</b>
            <p>
              {online
                ? 'Data terakhir dari perangkat dipakai karena permintaan terbaru gagal.'
                : 'Aksi status trip akan masuk antrean lokal dan tersinkron otomatis saat koneksi kembali.'}
              {stale && ' Data dapat berbeda dengan server.'}
            </p>
          </div>
        </div>
      )}

      <div className="stats-grid driver-stats">
        <div className="stat-card">
          <div className="stat-top"><span>Tugas aktif</span><MapPin size={18} /></div>
          <strong>{activeTrips.length}</strong>
          <small>{activeTrips.filter((trip) => ['IN_PROGRESS', 'PICKED_UP'].includes(trip.status)).length} sedang berjalan</small>
        </div>
        <div className="stat-card">
          <div className="stat-top"><span>Terjadwal</span><Clock size={18} /></div>
          <strong>{scheduledCount}</strong>
          <small>Menunggu diterima</small>
        </div>
        <div className="stat-card">
          <div className="stat-top"><span>Selesai</span><CheckCircle2 size={18} /></div>
          <strong>{completedCount}</strong>
          <small>Riwayat penugasan Anda</small>
        </div>
        <div className="stat-card">
          <div className="stat-top"><span>Antrean offline</span><CloudUpload size={18} /></div>
          <strong>{queue.length}</strong>
          <small>{queue.length ? 'Belum tersinkron' : 'Semua tersinkron'}</small>
        </div>
      </div>

      <section className="panel">
        <h3 className="panel-title">Penugasan aktif</h3>
        {loading && !trips.length ? (
          <div className="table-state">
            <Spinner /> Memuat penugasan...
          </div>
        ) : activeTrips.length === 0 ? (
          <p className="panel-empty">Tidak ada penugasan aktif. Penugasan baru dari dispatcher akan muncul di sini.</p>
        ) : (
          <div className="driver-trip-list">
            {activeTrips.map((trip) => {
              const action = NEXT_ACTION[trip.status];
              const needsChecklist = trip.status === 'DRIVER_ACCEPTED';
              return (
                <article className="driver-trip-card" key={trip.id}>
                  <div className="driver-trip-head">
                    <b>{trip.booking.code}</b>
                    <Badge value={trip.status} />
                  </div>
                  <p className="driver-trip-route">
                    {trip.booking.origin} <ArrowRight size={14} /> {trip.booking.destination}
                  </p>
                  <div className="driver-trip-meta">
                    <span><Clock size={14} /> {fmtDateTime(trip.booking.departureAt)}</span>
                    <span><Users size={14} /> {trip.booking.passengerCount} pax</span>
                    <span><MapPin size={14} /> {trip.vehicle?.plateNumber || 'Kendaraan belum ada'}</span>
                  </div>
                  {needsChecklist ? (
                    <button type="button" className="btn btn-primary driver-action" onClick={() => navigate('/trips')}>
                      <ClipboardCheck size={17} /> Checklist &amp; konfirmasi jemput
                    </button>
                  ) : action ? (
                    <button
                      type="button"
                      className="btn btn-primary driver-action"
                      disabled={busyId === trip.id}
                      onClick={() => perform(trip, action.status)}
                    >
                      {action.label}
                      {!online && <span className="driver-queue-hint">· antrekan</span>}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="driver-links">
        <button type="button" className="panel driver-link" onClick={() => navigate('/trips')}>
          <ClipboardCheck size={20} />
          <span>Semua perjalanan &amp; checklist</span>
        </button>
        <button type="button" className="panel driver-link" onClick={() => navigate('/inspection')}>
          <CheckCircle2 size={20} />
          <span>Inspeksi kendaraan</span>
        </button>
        <button type="button" className="panel driver-link" onClick={() => setFuelOpen(true)}>
          <Fuel size={20} />
          <span>Lapor bahan bakar</span>
        </button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Antrean offline</h3>
            <p>Aksi tersimpan di perangkat ini sampai berhasil dikirim.</p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={syncNow} disabled={!queue.length || syncing || !online}>
            <CloudUpload size={14} /> {syncing ? 'Sinkron...' : 'Sinkronkan sekarang'}
          </button>
        </div>
        {queue.length === 0 ? (
          <p className="panel-empty">Tidak ada aksi menunggu. Semua perubahan sudah terkirim.</p>
        ) : (
          <ul className="driver-queue-list">
            {queue.map((item) => (
              <li key={item.id}>
                <div>
                  <b>{item.label}</b>
                  <small>{fmtDateTime(item.createdAt)}</small>
                </div>
                <button type="button" className="icon-btn icon-bad" title="Hapus dari antrean" onClick={() => removeQueueItem(item.id)}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {fuelOpen && (
        <Modal
          title="Lapor bahan bakar"
          subtitle="Pengajuan driver memakai fuel card dan menunggu review fleet officer."
          onClose={() => !fuelBusy && setFuelOpen(false)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setFuelOpen(false)} disabled={fuelBusy}>
                Batal
              </button>
              <button type="submit" form="driver-fuel-form" className="btn btn-primary" disabled={fuelBusy || !online}>
                {fuelBusy ? 'Mengirim...' : 'Kirim pengajuan'}
              </button>
            </>
          }
        >
          {!online && (
            <p className="form-hint warn">Pengajuan bahan bakar membutuhkan koneksi online dan tidak masuk antrean offline.</p>
          )}
          <form id="driver-fuel-form" onSubmit={submitFuel}>
            <div className="form-grid">
              <Field label="Trip" className="span-2" hint="Kendaraan dan driver diambil otomatis dari trip.">
                <select
                  required
                  value={fuelForm.tripId}
                  onChange={(event) => setFuelForm({ ...fuelForm, tripId: event.target.value })}
                >
                  <option value="">— Pilih trip —</option>
                  {trips.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.booking.code} · {trip.booking.origin} → {trip.booking.destination} ({trip.status})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Jenis BBM">
                <select value={fuelForm.fuelType} onChange={(event) => setFuelForm({ ...fuelForm, fuelType: event.target.value })}>
                  {FUEL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Volume (liter)">
                <input
                  required
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={fuelForm.liters}
                  onChange={(event) => setFuelForm({ ...fuelForm, liters: event.target.value })}
                />
              </Field>
              <Field label="Harga per liter (opsional)" hint="Kosongkan untuk memakai harga referensi.">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={fuelForm.pricePerLiter}
                  onChange={(event) => setFuelForm({ ...fuelForm, pricePerLiter: event.target.value })}
                />
              </Field>
              <Field label="SPBU (opsional)">
                <input
                  value={fuelForm.station}
                  onChange={(event) => setFuelForm({ ...fuelForm, station: event.target.value })}
                  placeholder="Contoh: SPBU DEMO 31.101"
                />
              </Field>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

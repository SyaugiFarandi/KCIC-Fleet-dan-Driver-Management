import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Pencil, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { api, apiDelete, apiPatch, apiPost } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { Badge, DataTable, ErrorBanner, Field, Modal, PageHeader, SearchBox, useConfirm, useToast } from '../ui.jsx';

const emptyForm = () => ({
  code: '',
  origin: '',
  destination: '',
  estimatedMinutes: 30,
  distanceKm: 10,
  active: true,
  maxHeightM: '',
  maxWeightTon: '',
  restrictionNotes: '',
});

const emptyPoint = () => ({ name: '', kind: 'WAYPOINT', lat: '', lng: '', notes: '' });

function restrictionSummary(route) {
  const restrictions = route.restrictions;
  if (!restrictions || typeof restrictions !== 'object') return null;
  const parts = [];
  if (restrictions.maxHeightM != null) parts.push(`Tinggi ≤ ${restrictions.maxHeightM} m`);
  if (restrictions.maxWeightTon != null) parts.push(`Bobot ≤ ${restrictions.maxWeightTon} ton`);
  if (!parts.length && restrictions.notes) parts.push('Catatan restriksi');
  return parts.length ? parts : null;
}

function routePointsText(points) {
  if (!points?.length) return 'Belum ada titik';
  return points.map((point) => point.name).join(' → ');
}

export default function RoutesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', active: '' });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);

  const [pointsModal, setPointsModal] = useState(null);
  const [pointsBusy, setPointsBusy] = useState(false);

  const [recommendOpen, setRecommendOpen] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [recForm, setRecForm] = useState({ bookingId: '', origin: '', destination: '', passengers: '' });
  const [recResult, setRecResult] = useState(null);
  const [recBusy, setRecBusy] = useState(false);
  const [assigningId, setAssigningId] = useState(null);

  const canWrite = can(user.role, 'routes:write');
  const canDelete = can(user.role, 'routes:delete');
  const canOptimize = can(user.role, 'routes:optimize');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('/routes', { query: { pageSize: 200 } });
      setItems(result.items || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadBookings = useCallback(async () => {
    setBookingsLoading(true);
    try {
      const result = await api('/bookings', { query: { status: 'PENDING,APPROVED', pageSize: 100 } });
      setBookings(result.items || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBookingsLoading(false);
    }
  }, [toast]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter((route) => {
      if (filters.active && String(route.active) !== filters.active) return false;
      if (!q) return true;
      return [route.code, route.origin, route.destination, ...(route.points || []).map((point) => point.name)]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [items, filters]);

  const openCreate = () => {
    setForm(emptyForm());
    setModal({ type: 'create' });
  };

  const openEdit = (route) => {
    setForm({
      code: route.code,
      origin: route.origin,
      destination: route.destination,
      estimatedMinutes: route.estimatedMinutes,
      distanceKm: route.distanceKm,
      active: route.active,
      maxHeightM: route.restrictions?.maxHeightM ?? '',
      maxWeightTon: route.restrictions?.maxWeightTon ?? '',
      restrictionNotes: route.restrictions?.notes ?? '',
    });
    setModal({ type: 'edit', route });
  };

  const submit = async (event) => {
    event.preventDefault();
    const restrictions = {};
    if (form.maxHeightM !== '') restrictions.maxHeightM = Number(form.maxHeightM);
    if (form.maxWeightTon !== '') restrictions.maxWeightTon = Number(form.maxWeightTon);
    if (form.restrictionNotes.trim()) restrictions.notes = form.restrictionNotes.trim();
    const payload = {
      ...(form.code.trim() ? { code: form.code.trim() } : {}),
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      estimatedMinutes: Number(form.estimatedMinutes),
      distanceKm: Number(form.distanceKm),
      active: Boolean(form.active),
      restrictions: Object.keys(restrictions).length ? restrictions : null,
    };
    setBusy(true);
    try {
      if (modal.type === 'create') {
        await apiPost('/routes', payload);
        toast.success('Rute ditambahkan.');
      } else {
        await apiPatch(`/routes/${modal.route.id}`, payload);
        toast.success('Rute diperbarui.');
      }
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (route) => {
    const ok = await confirm({
      title: 'Hapus rute?',
      message: `Rute ${route.origin} → ${route.destination} akan dihapus permanen.`,
      confirmLabel: 'Hapus',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiDelete(`/routes/${route.id}`);
      toast.success('Rute dihapus.');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openPoints = (route) => {
    const points = (route.points || []).map((point) => ({
      name: point.name,
      kind: point.kind,
      lat: point.lat,
      lng: point.lng,
      notes: point.notes || '',
    }));
    setPointsModal({ route, points: points.length ? points : [{ ...emptyPoint(), kind: 'PICKUP' }] });
  };

  const updatePoint = (index, patch) => {
    setPointsModal((current) => ({
      ...current,
      points: current.points.map((point, idx) => (idx === index ? { ...point, ...patch } : point)),
    }));
  };

  const addPoint = () => {
    setPointsModal((current) => ({
      ...current,
      points: [...current.points, { ...emptyPoint(), kind: current.points.length === 0 ? 'PICKUP' : 'WAYPOINT' }],
    }));
  };

  const removePoint = (index) => {
    setPointsModal((current) => ({ ...current, points: current.points.filter((_, idx) => idx !== index) }));
  };

  const savePoints = async () => {
    const points = pointsModal.points;
    if (!points.length) {
      toast.error('Minimal satu titik rute.');
      return;
    }
    const invalid = points.find(
      (point) =>
        point.name.trim().length < 2 ||
        point.lat === '' ||
        point.lng === '' ||
        Number.isNaN(Number(point.lat)) ||
        Number.isNaN(Number(point.lng)) ||
        Math.abs(Number(point.lat)) > 90 ||
        Math.abs(Number(point.lng)) > 180
    );
    if (invalid) {
      toast.error('Lengkapi nama, latitude (-90..90), dan longitude (-180..180) setiap titik.');
      return;
    }
    setPointsBusy(true);
    try {
      const updated = await api(`/routes/${pointsModal.route.id}/points`, {
        method: 'PUT',
        body: {
          points: points.map((point) => ({
            name: point.name.trim(),
            kind: point.kind,
            lat: Number(point.lat),
            lng: Number(point.lng),
            notes: point.notes.trim() || null,
          })),
        },
      });
      toast.success(`Titik rute ${updated.code} diperbarui.`);
      setPointsModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPointsBusy(false);
    }
  };

  const toggleRecommend = async () => {
    const next = !recommendOpen;
    setRecommendOpen(next);
    if (next && !bookings.length) await loadBookings();
  };

  const runRecommendation = async (event) => {
    event.preventDefault();
    const query = recForm.bookingId
      ? { bookingId: recForm.bookingId }
      : {
          origin: recForm.origin.trim(),
          destination: recForm.destination.trim(),
          ...(recForm.passengers ? { passengers: Number(recForm.passengers) } : {}),
        };
    if (!recForm.bookingId && (!query.origin || !query.destination)) {
      toast.error('Isi asal dan tujuan atau pilih booking.');
      return;
    }
    setRecBusy(true);
    try {
      const result = await api('/routes/recommendations', { query });
      setRecResult(result);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRecBusy(false);
    }
  };

  const selectedBooking = bookings.find((booking) => booking.id === recForm.bookingId) || null;

  const assignRoute = async (candidate) => {
    if (!selectedBooking) return;
    const ok = await confirm({
      title: 'Tetapkan rute ke booking?',
      message: `Rute ${candidate.code} (${candidate.origin} → ${candidate.destination}) akan ditetapkan ke ${selectedBooking.code}. Perubahan hanya berlaku selama booking belum ditugaskan.`,
      confirmLabel: 'Tetapkan rute',
    });
    if (!ok) return;
    setAssigningId(candidate.id);
    try {
      await apiPatch(`/bookings/${selectedBooking.id}`, { routeId: candidate.id });
      toast.success(`Rute ${candidate.code} ditetapkan ke ${selectedBooking.code}.`);
      setRecResult(null);
      await Promise.all([load(), loadBookings()]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAssigningId(null);
    }
  };

  const columns = [
    { key: 'code', label: 'Kode', render: (route) => <b>{route.code}</b> },
    { key: 'origin', label: 'Asal' },
    { key: 'destination', label: 'Tujuan' },
    { key: 'estimatedMinutes', label: 'Estimasi', render: (route) => `${route.estimatedMinutes} menit` },
    { key: 'distanceKm', label: 'Jarak', render: (route) => `${Number(route.distanceKm).toLocaleString('id-ID')} km` },
    {
      key: 'points',
      label: 'Titik rute',
      render: (route) => (
        <button type="button" className="link-btn" onClick={() => openPoints(route)} title="Lihat titik rute">
          <MapPin size={14} /> {route.points?.length || 0} titik
        </button>
      ),
    },
    {
      key: 'restrictions',
      label: 'Restriksi',
      render: (route) => {
        const summary = restrictionSummary(route);
        if (!summary) return <span className="muted">Tidak ada</span>;
        return (
          <div className="badge-row">
            {summary.map((label) => (
              <Badge key={label} value="WARN" tone="amber" label={label} />
            ))}
          </div>
        );
      },
    },
    {
      key: 'active',
      label: 'Status',
      render: (route) => <Badge value={route.active ? 'ACTIVE' : 'INACTIVE'} label={route.active ? 'Aktif' : 'Nonaktif'} />,
    },
    ...(canWrite || canOptimize
      ? [
          {
            key: 'actions',
            label: 'Aksi',
            render: (route) => (
              <div className="row-actions">
                <button type="button" className="icon-btn" title="Titik rute" onClick={() => openPoints(route)}>
                  <MapPin size={15} />
                </button>
                {canWrite && (
                  <button type="button" className="icon-btn" title="Ubah" onClick={() => openEdit(route)}>
                    <Pencil size={15} />
                  </button>
                )}
                {canDelete && (
                  <button type="button" className="icon-btn icon-bad" title="Hapus" onClick={() => remove(route)}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Data induk transportasi"
        title="Master Rute"
        subtitle="Rute perjalanan, titik jemput/antar, restriksi, dan rekomendasi rute untuk dispatcher."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            {canOptimize && (
              <button type="button" className={`btn ${recommendOpen ? 'btn-secondary' : 'btn-secondary'}`} onClick={toggleRecommend}>
                <Sparkles size={15} /> Rekomendasi Rute
              </button>
            )}
            {canWrite && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={15} /> Tambah Rute
              </button>
            )}
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {recommendOpen && canOptimize && (
        <section className="panel recommend-panel">
          <div className="panel-head">
            <div>
              <h3>Rekomendasi rute</h3>
              <p className="muted">
                Sistem memberi skor berdasarkan estimasi, kecocokan asal/tujuan, restriksi, dan kapasitas. Keputusan akhir ada di
                dispatcher.
              </p>
            </div>
          </div>
          <form className="recommend-form" onSubmit={runRecommendation}>
            <Field label="Booking (opsional)">
              <select
                value={recForm.bookingId}
                onChange={(event) => setRecForm({ ...recForm, bookingId: event.target.value })}
                disabled={bookingsLoading}
              >
                <option value="">Tanpa booking (input manual)</option>
                {bookings.map((booking) => (
                  <option key={booking.id} value={booking.id}>
                    {booking.code} · {booking.origin} → {booking.destination} · {booking.passengerCount} pax
                  </option>
                ))}
              </select>
            </Field>
            {recForm.bookingId ? (
              <div className="recommend-booking">
                {selectedBooking ? (
                  <span>
                    <b>{selectedBooking.code}</b> · {selectedBooking.origin} → {selectedBooking.destination} ·{' '}
                    {selectedBooking.passengerCount} penumpang · status {selectedBooking.status}
                  </span>
                ) : (
                  <span className="muted">Booking tidak ditemukan pada daftar.</span>
                )}
              </div>
            ) : (
              <>
                <Field label="Asal">
                  <input value={recForm.origin} onChange={(event) => setRecForm({ ...recForm, origin: event.target.value })} placeholder="Stasiun Halim" />
                </Field>
                <Field label="Tujuan">
                  <input
                    value={recForm.destination}
                    onChange={(event) => setRecForm({ ...recForm, destination: event.target.value })}
                    placeholder="Kantor Pusat"
                  />
                </Field>
                <Field label="Penumpang">
                  <input
                    type="number"
                    min="1"
                    max="80"
                    value={recForm.passengers}
                    onChange={(event) => setRecForm({ ...recForm, passengers: event.target.value })}
                  />
                </Field>
              </>
            )}
            <div className="recommend-actions">
              <button type="submit" className="btn btn-primary" disabled={recBusy}>
                <Sparkles size={15} /> {recBusy ? 'Menghitung...' : 'Cari rekomendasi'}
              </button>
              {recResult && (
                <button type="button" className="btn btn-secondary" onClick={() => setRecResult(null)}>
                  <X size={15} /> Bersihkan hasil
                </button>
              )}
            </div>
          </form>

          {recResult && (
            <div className="recommend-results">
              <div className="recommend-meta">
                <span>
                  {recResult.candidates.length} rute aktif dievaluasi untuk {recResult.input.origin} → {recResult.input.destination}
                  {recResult.input.passengers ? ` · ${recResult.input.passengers} penumpang` : ''}
                </span>
              </div>
              {recResult.candidates.length === 0 ? (
                <p className="muted">Tidak ada rute aktif yang dapat dievaluasi.</p>
              ) : (
                <ol className="candidate-list">
                  {recResult.candidates.map((candidate) => (
                    <li key={candidate.id} className={`candidate-card${candidate.blocked ? ' candidate-blocked' : ''}`}>
                      <div className="candidate-head">
                        <span className="candidate-rank">#{candidate.rank}</span>
                        <div>
                          <b>{candidate.code}</b>
                          <span className="muted">
                            {' '}
                            {candidate.origin} → {candidate.destination}
                          </span>
                        </div>
                        <div className="candidate-badges">
                          {candidate.current && <Badge value="ACTIVE" label="Rute saat ini" />}
                          {candidate.blocked && <Badge value="REJECTED" label="Tidak disarankan" />}
                        </div>
                      </div>
                      <div className="candidate-meta">
                        <span>{candidate.estimatedMinutes} menit</span>
                        <span>{Number(candidate.distanceKm).toLocaleString('id-ID')} km</span>
                        <span>{candidate.points.length} titik</span>
                        <span>Skor {candidate.score}</span>
                      </div>
                      <p className="candidate-points">{routePointsText(candidate.points)}</p>
                      {candidate.warnings.length > 0 && (
                        <ul className="candidate-warnings">
                          {candidate.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      )}
                      <div className="candidate-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openPoints(candidate)}>
                          <MapPin size={14} /> Lihat titik
                        </button>
                        {selectedBooking && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={assigningId === candidate.id}
                            onClick={() => assignRoute(candidate)}
                          >
                            {assigningId === candidate.id ? 'Menetapkan...' : `Tetapkan ke ${selectedBooking.code}`}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <details className="sla-evidence">
                <summary>Dasar perhitungan rekomendasi</summary>
                <p>{recResult.rules.scoring}</p>
                <ul>
                  {recResult.rules.limitations.map((limit) => (
                    <li key={limit}>{limit}</li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </section>
      )}

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari kode, asal, tujuan, titik..." />
          <div className="toolbar-selects">
            <select value={filters.active} onChange={(event) => setFilters({ ...filters, active: event.target.value })}>
              <option value="">Semua status</option>
              <option value="true">Aktif</option>
              <option value="false">Nonaktif</option>
            </select>
          </div>
        </div>
        <DataTable columns={columns} rows={filtered} loading={loading} empty="Tidak ada rute sesuai filter." />
      </div>

      {modal && (
        <Modal
          title={modal.type === 'create' ? 'Tambah Rute' : `Ubah ${modal.route.origin} → ${modal.route.destination}`}
          subtitle="Kode rute opsional; sistem akan membuat kode otomatis jika dikosongkan."
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="route-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Simpan'}
              </button>
            </>
          }
        >
          <form id="route-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Kode Rute (opsional)">
                <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="RTE-HAL-BDG" />
              </Field>
              <Field label="Status">
                <div className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) => setForm({ ...form, active: event.target.checked })}
                  />
                  <span>Rute aktif</span>
                </div>
              </Field>
              <Field label="Asal">
                <input required minLength={2} value={form.origin} onChange={(event) => setForm({ ...form, origin: event.target.value })} />
              </Field>
              <Field label="Tujuan">
                <input
                  required
                  minLength={2}
                  value={form.destination}
                  onChange={(event) => setForm({ ...form, destination: event.target.value })}
                />
              </Field>
              <Field label="Estimasi (menit)">
                <input
                  required
                  type="number"
                  min="1"
                  max="1440"
                  value={form.estimatedMinutes}
                  onChange={(event) => setForm({ ...form, estimatedMinutes: event.target.value })}
                />
              </Field>
              <Field label="Jarak (km)">
                <input
                  required
                  type="number"
                  min="0.1"
                  step="0.1"
                  max="2000"
                  value={form.distanceKm}
                  onChange={(event) => setForm({ ...form, distanceKm: event.target.value })}
                />
              </Field>
              <Field label="Batas tinggi (m, opsional)">
                <input
                  type="number"
                  min="0.5"
                  step="0.1"
                  max="10"
                  value={form.maxHeightM}
                  onChange={(event) => setForm({ ...form, maxHeightM: event.target.value })}
                  placeholder="Contoh 2.3"
                />
              </Field>
              <Field label="Batas bobot (ton, opsional)">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  max="100"
                  value={form.maxWeightTon}
                  onChange={(event) => setForm({ ...form, maxWeightTon: event.target.value })}
                  placeholder="Contoh 3.5"
                />
              </Field>
              <Field label="Catatan restriksi (opsional)">
                <input
                  value={form.restrictionNotes}
                  onChange={(event) => setForm({ ...form, restrictionNotes: event.target.value })}
                  maxLength={300}
                  placeholder="Contoh: akses basement, perlu stiker resmi (DEMO)"
                />
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {pointsModal && (
        <Modal
          size="lg"
          title={`Titik Rute ${pointsModal.route.code}`}
          subtitle={`${pointsModal.route.origin} → ${pointsModal.route.destination}. Urutan titik menentukan arah perjalanan.`}
          onClose={() => setPointsModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setPointsModal(null)}>
                {canWrite ? 'Batal' : 'Tutup'}
              </button>
              {canWrite && (
                <button type="button" className="btn btn-primary" onClick={savePoints} disabled={pointsBusy}>
                  {pointsBusy ? 'Menyimpan...' : 'Simpan titik'}
                </button>
              )}
            </>
          }
        >
          <div className="route-points">
            {pointsModal.points.map((point, index) => (
              <div className="route-point-card" key={index}>
                <div className="route-point-head">
                  <span className="route-point-seq">{index + 1}</span>
                  {canWrite ? (
                    <input
                      className="route-point-name"
                      value={point.name}
                      onChange={(event) => updatePoint(index, { name: event.target.value })}
                      placeholder="Nama titik"
                      aria-label={`Nama titik ${index + 1}`}
                    />
                  ) : (
                    <b>{point.name}</b>
                  )}
                  {canWrite && pointsModal.points.length > 1 && (
                    <button type="button" className="icon-btn icon-bad" title="Hapus titik" onClick={() => removePoint(index)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                <div className="route-point-grid">
                  <Field label="Tipe">
                    <select
                      value={point.kind}
                      onChange={(event) => updatePoint(index, { kind: event.target.value })}
                      disabled={!canWrite}
                    >
                      <option value="PICKUP">Pickup</option>
                      <option value="WAYPOINT">Waypoint</option>
                      <option value="DROP_OFF">Drop off</option>
                    </select>
                  </Field>
                  <Field label="Latitude">
                    <input
                      type="number"
                      step="0.000001"
                      value={point.lat}
                      onChange={(event) => updatePoint(index, { lat: event.target.value })}
                      disabled={!canWrite}
                    />
                  </Field>
                  <Field label="Longitude">
                    <input
                      type="number"
                      step="0.000001"
                      value={point.lng}
                      onChange={(event) => updatePoint(index, { lng: event.target.value })}
                      disabled={!canWrite}
                    />
                  </Field>
                  <Field label="Catatan">
                    <input
                      value={point.notes}
                      onChange={(event) => updatePoint(index, { notes: event.target.value })}
                      disabled={!canWrite}
                      maxLength={200}
                    />
                  </Field>
                </div>
              </div>
            ))}
            {canWrite && (
              <button type="button" className="btn btn-secondary" onClick={addPoint}>
                <Plus size={15} /> Tambah titik
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

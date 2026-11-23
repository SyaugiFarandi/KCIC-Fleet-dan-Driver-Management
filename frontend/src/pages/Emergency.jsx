import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Eye, Plus, RefreshCw, Siren, Timer, Truck, X } from 'lucide-react';
import { api, apiPatch, apiPost } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtDateTime, toDateTimeLocal } from '../format.js';
import { can } from '../permissions.js';
import { Badge, DataTable, DetailItem, ErrorBanner, Field, Modal, PageHeader, SearchBox, StatCard, useConfirm, useToast } from '../ui.jsx';

const STATUSES = ['PENDING', 'APPROVED', 'ASSIGNED', 'COMPLETED', 'REJECTED', 'CANCELLED'];

const defaultDeparture = () => toDateTimeLocal(new Date(Date.now() + 15 * 60000));

const emptyForm = () => ({
  purpose: '',
  reason: '',
  department: '',
  passengerCount: 4,
  origin: '',
  destination: '',
  departureAt: defaultDeparture(),
  returnAt: '',
});

function responseMinutes(booking) {
  if (!booking.decidedAt) return null;
  return Math.max(0, Math.round((new Date(booking.decidedAt).getTime() - new Date(booking.createdAt).getTime()) / 60000));
}

export default function Emergency() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  const canDecide = can(user.role, 'emergency:decide');
  const canAssign = can(user.role, 'trips:assign');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, stats] = await Promise.all([
        api('/emergency', { query: { pageSize: 200 } }),
        api('/emergency/summary'),
      ]);
      setItems(list.items || []);
      setSummary(stats);
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

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter((booking) => {
      if (filters.status && booking.status !== filters.status) return false;
      if (!q) return true;
      return [booking.code, booking.origin, booking.destination, booking.purpose, booking.emergencyReason, booking.requester?.name]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [items, filters]);

  const openCreate = () => {
    setForm(emptyForm());
    setModal({ type: 'create' });
  };

  const submitCreate = async (event) => {
    event.preventDefault();
    if (form.reason.trim().length < 10) {
      toast.error('Alasan darurat minimal 10 karakter.');
      return;
    }
    setBusy(true);
    try {
      const created = await apiPost('/emergency/requests', {
        purpose: form.purpose.trim(),
        reason: form.reason.trim(),
        department: form.department.trim() || undefined,
        passengerCount: Number(form.passengerCount),
        origin: form.origin.trim(),
        destination: form.destination.trim(),
        departureAt: form.departureAt,
        ...(form.returnAt ? { returnAt: form.returnAt } : {}),
      });
      toast.success(`Permintaan darurat ${created.code} dikirim menunggu keputusan.`);
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async (booking) => {
    const ok = await confirm({
      title: 'Setujui transport darurat?',
      message: `${booking.code} (${booking.origin} → ${booking.destination}) akan disetujui dan siap ditugaskan ke kendaraan.`,
      confirmLabel: 'Setujui',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await apiPatch(`/emergency/${booking.id}/decision`, { decision: 'APPROVED' });
      toast.success(`${booking.code} disetujui.`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitReject = async (event) => {
    event.preventDefault();
    if (reason.trim().length < 3) {
      toast.error('Alasan penolakan wajib diisi.');
      return;
    }
    setBusy(true);
    try {
      await apiPatch(`/emergency/${modal.booking.id}/decision`, { decision: 'REJECTED', reason: reason.trim() });
      toast.success(`${modal.booking.code} ditolak.`);
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitCancel = async (event) => {
    event.preventDefault();
    if (reason.trim().length < 3) {
      toast.error('Alasan pembatalan wajib diisi.');
      return;
    }
    setBusy(true);
    try {
      await apiPatch(`/emergency/${modal.booking.id}/cancel`, { reason: reason.trim() });
      toast.success(`${modal.booking.code} dibatalkan.`);
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openDispatch = async (booking) => {
    setModal({ type: 'dispatch', booking, availability: null, loading: true, form: { vehicleId: '', driverId: '', notes: '' } });
    try {
      const data = await api('/trips/availability', { query: { bookingId: booking.id } });
      setModal((current) => (current?.type === 'dispatch' ? { ...current, availability: data, loading: false } : current));
    } catch (err) {
      toast.error(err.message);
      setModal((current) => (current?.type === 'dispatch' ? { ...current, loading: false } : current));
    }
  };

  const submitDispatch = async (event) => {
    event.preventDefault();
    const { vehicleId, driverId, notes } = modal.form;
    if (!vehicleId || !driverId) {
      toast.error('Pilih kendaraan dan driver.');
      return;
    }
    setBusy(true);
    try {
      const trip = await apiPost('/trips', {
        bookingId: modal.booking.id,
        vehicleId,
        driverId,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast.success(`Penugasan dibuat: ${trip.vehicle.plateNumber} / ${trip.driver.name}.`);
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'code',
      label: 'Kode',
      render: (booking) => (
        <div className="cell-stack">
          <b>{booking.code}</b>
          <Badge value="EMERGENCY" tone="red" label="Darurat" />
          <small>{fmtDateTime(booking.createdAt)}</small>
        </div>
      ),
    },
    {
      key: 'requester',
      label: 'Pemohon',
      render: (booking) => (
        <div className="cell-stack">
          <b>{booking.requester?.name || '—'}</b>
          <small>{booking.department}</small>
        </div>
      ),
    },
    {
      key: 'route',
      label: 'Rute & alasan',
      render: (booking) => (
        <div className="cell-stack">
          <b>
            {booking.origin} → {booking.destination}
          </b>
          <small title={booking.emergencyReason}>{booking.purpose}</small>
        </div>
      ),
    },
    { key: 'departureAt', label: 'Berangkat', render: (booking) => fmtDateTime(booking.departureAt) },
    { key: 'passengerCount', label: 'Pax', render: (booking) => `${booking.passengerCount} orang` },
    { key: 'status', label: 'Status', render: (booking) => <Badge value={booking.status} /> },
    {
      key: 'assignment',
      label: 'Penugasan',
      render: (booking) =>
        booking.trip ? (
          <div className="cell-stack">
            <b>{booking.trip.vehicle?.plateNumber || '—'}</b>
            <small>{booking.trip.driver?.name || '—'}</small>
            <Badge value={booking.trip.status} />
          </div>
        ) : (
          <span className="muted">Belum ditugaskan</span>
        ),
    },
    {
      key: 'response',
      label: 'Respons',
      render: (booking) => {
        const minutes = responseMinutes(booking);
        return minutes === null ? <span className="muted">—</span> : `${minutes} menit`;
      },
    },
    {
      key: 'actions',
      label: 'Aksi',
      render: (booking) => {
        const canCancel =
          (canDecide || booking.requesterId === user.id) && ['PENDING', 'APPROVED'].includes(booking.status) && !booking.trip;
        return (
          <div className="row-actions">
            <button type="button" className="icon-btn" title="Detail" onClick={() => setModal({ type: 'detail', booking })}>
              <Eye size={15} />
            </button>
            {booking.status === 'PENDING' && canDecide && (
              <>
                <button type="button" className="icon-btn icon-good" title="Setujui" onClick={() => approve(booking)} disabled={busy}>
                  <Check size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-bad"
                  title="Tolak"
                  onClick={() => {
                    setReason('');
                    setModal({ type: 'reject', booking });
                  }}
                  disabled={busy}
                >
                  <X size={15} />
                </button>
              </>
            )}
            {booking.status === 'APPROVED' && !booking.trip && canAssign && (
              <button type="button" className="icon-btn" title="Tugaskan kendaraan" onClick={() => openDispatch(booking)} disabled={busy}>
                <Truck size={15} />
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                className="icon-btn icon-bad"
                title="Batalkan"
                onClick={() => {
                  setReason('');
                  setModal({ type: 'cancel', booking });
                }}
                disabled={busy}
              >
                <X size={15} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Operasi darurat"
        title="Transport Darurat"
        subtitle="Permintaan, persetujuan, penugasan, dan pemantauan transportasi darurat (data DEMO)."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={15} /> Ajukan Darurat
            </button>
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="callout callout-warn" role="status">
        <Siren size={18} />
        <div>
          <b>Alur demo: pengajuan → keputusan → penugasan → monitoring.</b>
          <p>
            Permintaan darurat tetap melewati persetujuan role berwenang dan validasi penugasan kendaraan/driver. KPI dihitung dari data DEMO
            lokal, bukan data operasional resmi KCIC.
          </p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          label="Menunggu keputusan"
          value={summary?.pendingApproval ?? '—'}
          hint={summary?.oldestPendingMinutes != null ? `Tertua ${summary.oldestPendingMinutes} menit` : 'Tidak ada antrean'}
          icon={Clock}
        />
        <StatCard label="Siap ditugaskan" value={summary?.awaitingAssignment ?? '—'} hint="Sudah disetujui" icon={Siren} />
        <StatCard label="Trip aktif" value={summary?.activeTrips ?? '—'} hint={`${summary?.dispatched ?? 0} penugasan dibuat`} icon={Truck} />
        <StatCard
          label="Rata-rata respons"
          value={summary?.avgApprovalMinutes != null ? `${summary.avgApprovalMinutes} mnt` : '—'}
          hint="Pengajuan → keputusan"
          icon={Timer}
        />
        <StatCard
          label="Selesai"
          value={summary?.completed ?? '—'}
          hint={`${summary?.total ?? 0} permintaan darurat`}
          icon={Check}
        />
      </div>

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari kode, rute, alasan, pemohon..." />
          <div className="toolbar-selects">
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">Semua status</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DataTable columns={columns} rows={filtered} loading={loading} empty="Tidak ada permintaan darurat sesuai filter." />
      </div>

      {modal?.type === 'create' && (
        <Modal
          title="Ajukan Transport Darurat"
          subtitle="Permintaan akan masuk ke antrean persetujuan role berwenang. Data ini DEMO."
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="emergency-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Mengirim...' : 'Kirim permintaan'}
              </button>
            </>
          }
        >
          <form id="emergency-form" onSubmit={submitCreate} className="form-grid">
            <Field label="Tujuan mobilisasi">
              <input
                required
                minLength={3}
                value={form.purpose}
                onChange={(event) => setForm({ ...form, purpose: event.target.value })}
                placeholder="Contoh: evakuasi kru"
              />
            </Field>
            <Field label="Departemen">
              <input
                value={form.department}
                onChange={(event) => setForm({ ...form, department: event.target.value })}
                placeholder={user.department || 'Operasional'}
              />
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
            <Field label="Penumpang">
              <input
                required
                type="number"
                min="1"
                max="80"
                value={form.passengerCount}
                onChange={(event) => setForm({ ...form, passengerCount: event.target.value })}
              />
            </Field>
            <Field label="Berangkat">
              <input
                required
                type="datetime-local"
                value={form.departureAt}
                onChange={(event) => setForm({ ...form, departureAt: event.target.value })}
              />
            </Field>
            <Field label="Kembali (opsional)">
              <input
                type="datetime-local"
                value={form.returnAt}
                onChange={(event) => setForm({ ...form, returnAt: event.target.value })}
              />
            </Field>
            <Field label="Alasan darurat (wajib)">
              <textarea
                required
                minLength={10}
                maxLength={500}
                rows={3}
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
                placeholder="Jelaskan kondisi darurat dan urgensi mobilisasi"
              />
            </Field>
          </form>
        </Modal>
      )}

      {(modal?.type === 'reject' || modal?.type === 'cancel') && (
        <Modal
          title={modal.type === 'reject' ? `Tolak ${modal.booking.code}` : `Batalkan ${modal.booking.code}`}
          subtitle={
            modal.type === 'reject'
              ? 'Alasan penolakan akan dicatat pada audit log dan dikirim ke pemohon.'
              : 'Pembatalan hanya berlaku untuk permintaan yang belum ditugaskan.'
          }
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Kembali
              </button>
              <button type="submit" form="reason-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : modal.type === 'reject' ? 'Tolak permintaan' : 'Batalkan permintaan'}
              </button>
            </>
          }
        >
          <form id="reason-form" onSubmit={modal.type === 'reject' ? submitReject : submitCancel}>
            <Field label="Alasan">
              <textarea
                required
                minLength={3}
                maxLength={300}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={modal.type === 'reject' ? 'Alasan penolakan' : 'Alasan pembatalan'}
              />
            </Field>
          </form>
        </Modal>
      )}

      {modal?.type === 'dispatch' && (
        <Modal
          title={`Tugaskan ${modal.booking.code}`}
          subtitle={`${modal.booking.origin} → ${modal.booking.destination} · ${modal.booking.passengerCount} penumpang. Penugasan tunduk pada validasi konflik jadwal, maintenance, dan SIM.`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="dispatch-form" className="btn btn-primary" disabled={busy || modal.loading}>
                {busy ? 'Menugaskan...' : 'Buat penugasan'}
              </button>
            </>
          }
        >
          {modal.loading ? (
            <p className="muted">Memuat ketersediaan kendaraan dan driver...</p>
          ) : !modal.availability ? (
            <p className="muted">Ketersediaan tidak dapat dimuat. Tutup dan coba lagi.</p>
          ) : (
            <form id="dispatch-form" onSubmit={submitDispatch} className="form-grid">
              <div className="span-2 muted">
                Jadwal pemakaian: {fmtDateTime(modal.availability.window?.from)} — {fmtDateTime(modal.availability.window?.to)}. Daftar di bawah
                sudah memperhitungkan konflik jadwal dan status armada.
              </div>
              <Field label={`Kendaraan tersedia (${modal.availability.vehicles?.length || 0})`}>
                <select
                  value={modal.form.vehicleId}
                  onChange={(event) => setModal((current) => ({ ...current, form: { ...current.form, vehicleId: event.target.value } }))}
                  required
                >
                  <option value="">Pilih kendaraan</option>
                  {(modal.availability.vehicles || []).map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.plateNumber} · {vehicle.brand} {vehicle.model} · {vehicle.capacity} kursi
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Driver tersedia (${modal.availability.drivers?.length || 0})`}>
                <select
                  value={modal.form.driverId}
                  onChange={(event) => setModal((current) => ({ ...current, form: { ...current.form, driverId: event.target.value } }))}
                  required
                >
                  <option value="">Pilih driver</option>
                  {(modal.availability.drivers || []).map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name}
                      {driver.vendor?.name ? ` · ${driver.vendor.name}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Catatan penugasan (opsional)">
                <input
                  value={modal.form.notes}
                  onChange={(event) => setModal((current) => ({ ...current, form: { ...current.form, notes: event.target.value } }))}
                  maxLength={300}
                />
              </Field>
              {(!modal.availability.vehicles?.length || !modal.availability.drivers?.length) && (
                <div className="callout callout-warn span-2">
                  <Siren size={16} />
                  <div>
                    <b>Ketersediaan tidak lengkap.</b>
                    <p>Pastikan ada kendaraan dan driver yang bebas pada jadwal ini, atau tindak lanjuti melalui vendor.</p>
                  </div>
                </div>
              )}
            </form>
          )}
        </Modal>
      )}

      {modal?.type === 'detail' && (
        <Modal
          title={`${modal.booking.code} · Transport Darurat`}
          subtitle={`${modal.booking.origin} → ${modal.booking.destination}`}
          onClose={() => setModal(null)}
          footer={
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
              Tutup
            </button>
          }
        >
          <div className="detail-grid">
            <DetailItem label="Status">
              <Badge value={modal.booking.status} />
            </DetailItem>
            <DetailItem label="Pemohon">{modal.booking.requester?.name || '—'}</DetailItem>
            <DetailItem label="Departemen">{modal.booking.department}</DetailItem>
            <DetailItem label="Penumpang">{modal.booking.passengerCount} orang</DetailItem>
            <DetailItem label="Asal">{modal.booking.origin}</DetailItem>
            <DetailItem label="Tujuan">{modal.booking.destination}</DetailItem>
            <DetailItem label="Berangkat">{fmtDateTime(modal.booking.departureAt)}</DetailItem>
            <DetailItem label="Kembali">{fmtDateTime(modal.booking.returnAt)}</DetailItem>
            <DetailItem label="Diajukan">{fmtDateTime(modal.booking.createdAt)}</DetailItem>
            <DetailItem label="Diputuskan">
              {modal.booking.decidedBy?.name
                ? `${modal.booking.decidedBy.name} · ${fmtDateTime(modal.booking.decidedAt)}`
                : '—'}
            </DetailItem>
            <DetailItem label="Penugasan">
              {modal.booking.trip
                ? `${modal.booking.trip.vehicle?.plateNumber || '—'} / ${modal.booking.trip.driver?.name || '—'}`
                : 'Belum ditugaskan'}
            </DetailItem>
            <DetailItem label="Status Trip">
              {modal.booking.trip ? <Badge value={modal.booking.trip.status} /> : '—'}
            </DetailItem>
            <DetailItem label="Tujuan mobilisasi" className="span-2">
              {modal.booking.purpose}
            </DetailItem>
            <DetailItem label="Alasan darurat" className="span-2">
              {modal.booking.emergencyReason || '—'}
            </DetailItem>
            {modal.booking.rejectionReason && (
              <DetailItem label="Alasan penolakan" className="span-2">
                {modal.booking.rejectionReason}
              </DetailItem>
            )}
            {modal.booking.cancelledReason && (
              <DetailItem label="Alasan pembatalan" className="span-2">
                {modal.booking.cancelledReason}
              </DetailItem>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ClipboardCheck, Eye, RefreshCw, Repeat } from 'lucide-react';
import { api, apiPatch } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { fmtDateTime, statusLabel } from '../format.js';
import {
  Badge,
  DataTable,
  DetailItem,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  SearchBox,
  Spinner,
  Timeline,
  useConfirm,
  useToast,
} from '../ui.jsx';

const TRIP_TRANSITIONS = {
  SCHEDULED: ['DRIVER_ACCEPTED', 'CANCELLED'],
  DRIVER_ACCEPTED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const STATUS_TABS = [
  ['', 'Semua'],
  ['SCHEDULED', 'Terjadwal'],
  ['DRIVER_ACCEPTED', 'Diterima'],
  ['PICKED_UP', 'Penjemputan'],
  ['IN_PROGRESS', 'Berjalan'],
  ['COMPLETED', 'Selesai'],
  ['CANCELLED', 'Dibatalkan'],
];

const QUICK_ACTION_LABELS = {
  DRIVER_ACCEPTED: 'Terima',
  PICKED_UP: 'Jemput',
  IN_PROGRESS: 'Mulai',
  COMPLETED: 'Selesai',
};

export default function Trips() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', status: '' });

  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [statusForm, setStatusForm] = useState({ status: '', note: '' });
  const [availability, setAvailability] = useState(null);
  const [assignForm, setAssignForm] = useState({ vehicleId: '', driverId: '', notes: '' });
  const [assignLoading, setAssignLoading] = useState(false);
  const [checklistTemplate, setChecklistTemplate] = useState(null);
  const [checklistForm, setChecklistForm] = useState({ items: [], note: '' });
  const [checklistLoading, setChecklistLoading] = useState(false);

  const canAssign = can(user.role, 'trips:assign');
  const canUpdateAny = can(user.role, 'trips:update:any');
  const isDriver = user.role === 'DRIVER';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('/trips', { query: { pageSize: 200 } });
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

  useEffect(() => {
    if (modal?.type !== 'detail') return undefined;
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    api(`/trips/${modal.trip.id}`)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modal]);

  useEffect(() => {
    if (modal?.type !== 'reassign') return undefined;
    let cancelled = false;
    setAvailability(null);
    setAssignForm({ vehicleId: modal.trip.vehicle?.id || '', driverId: modal.trip.driver?.id || '', notes: '' });
    setAssignLoading(true);
    api('/trips/availability', { query: { bookingId: modal.trip.booking.id, excludeTripId: modal.trip.id } })
      .then((data) => {
        if (!cancelled) setAvailability(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setAssignLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modal]);

  const counts = useMemo(() => {
    const map = { '': items.length };
    items.forEach((trip) => {
      map[trip.status] = (map[trip.status] || 0) + 1;
    });
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter((trip) => {
      if (filters.status && trip.status !== filters.status) return false;
      if (!q) return true;
      return [
        trip.booking?.code,
        trip.booking?.origin,
        trip.booking?.destination,
        trip.vehicle?.plateNumber,
        trip.driver?.name,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [items, filters]);

  const openStatus = (trip) => {
    const options = TRIP_TRANSITIONS[trip.status] || [];
    setStatusForm({ status: options[0] || '', note: '' });
    setModal({ type: 'status', trip });
  };

  const submitStatus = async (event) => {
    event.preventDefault();
    if (!statusForm.status) {
      toast.error('Pilih status baru.');
      return;
    }
    setBusy(true);
    try {
      await apiPatch(`/trips/${modal.trip.id}/status`, {
        status: statusForm.status,
        ...(statusForm.note.trim() ? { note: statusForm.note.trim() } : {}),
      });
      toast.success(`Status trip diperbarui menjadi ${statusLabel(statusForm.status)}.`);
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const ensureChecklistTemplate = async () => {
    if (checklistTemplate) return checklistTemplate;
    const data = await api('/trips/checklist-template');
    setChecklistTemplate(data.items);
    return data.items;
  };

  const openChecklist = useCallback(
    async (trip) => {
      setModal({ type: 'checklist', trip });
      setChecklistForm({ items: [], note: trip.checklist?.note || '' });
      setChecklistLoading(true);
      try {
        const template = await ensureChecklistTemplate();
        const saved = new Map((trip.checklist?.items || []).map((item) => [item.key, item.checked]));
        setChecklistForm({
          items: template.map((item) => ({ ...item, checked: Boolean(saved.get(item.key)) })),
          note: trip.checklist?.note || '',
        });
      } catch (err) {
        toast.error(err.message);
      } finally {
        setChecklistLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checklistTemplate, toast]
  );

  const saveChecklist = async () => {
    if (!checklistForm.items.length) {
      toast.error('Checklist belum dimuat.');
      return;
    }
    setBusy(true);
    try {
      await apiPatch(`/trips/${modal.trip.id}/checklist`, {
        items: checklistForm.items.map((item) => ({ key: item.key, checked: item.checked })),
        ...(checklistForm.note.trim() ? { note: checklistForm.note.trim() } : {}),
      });
      toast.success('Checklist pra-perjalanan tersimpan.');
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const quickStatus = async (trip, status) => {
    if (status === 'PICKED_UP' && trip.checklist?.complete !== true) {
      toast.info('Lengkapi checklist pra-perjalanan sebelum menjemput penumpang.');
      openChecklist(trip);
      return;
    }
    if (status === 'COMPLETED') {
      const ok = await confirm({
        title: 'Selesaikan perjalanan?',
        message: `Trip untuk ${trip.booking.code} akan ditandai selesai dan booking menjadi COMPLETED.`,
        confirmLabel: 'Selesaikan',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await apiPatch(`/trips/${trip.id}/status`, { status });
      toast.success(`Status trip: ${statusLabel(status)}.`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitReassign = async (event) => {
    event.preventDefault();
    if (!assignForm.vehicleId || !assignForm.driverId) {
      toast.error('Pilih kendaraan dan driver.');
      return;
    }
    setBusy(true);
    try {
      await apiPatch(`/trips/${modal.trip.id}/assignment`, {
        vehicleId: assignForm.vehicleId,
        driverId: assignForm.driverId,
        ...(assignForm.notes.trim() ? { notes: assignForm.notes.trim() } : {}),
      });
      toast.success('Penugasan trip diperbarui.');
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
      key: 'booking',
      label: 'Booking',
      render: (trip) => (
        <div className="cell-stack">
          <b>{trip.booking?.code}</b>
          <small>
            {trip.booking?.origin} → {trip.booking?.destination}
          </small>
        </div>
      ),
    },
    {
      key: 'departure',
      label: 'Keberangkatan',
      render: (trip) => (
        <div className="cell-stack">
          <b>{fmtDateTime(trip.booking?.departureAt)}</b>
          <small>{trip.booking?.passengerCount} penumpang</small>
        </div>
      ),
    },
    {
      key: 'vehicle',
      label: 'Kendaraan',
      render: (trip) => (
        <div className="cell-stack">
          <b>{trip.vehicle?.plateNumber}</b>
          <small>
            {trip.vehicle?.brand} {trip.vehicle?.model}
          </small>
        </div>
      ),
    },
    {
      key: 'driver',
      label: 'Driver',
      render: (trip) => (
        <div className="cell-stack">
          <b>{trip.driver?.name}</b>
          <small>{trip.driver?.phone}</small>
        </div>
      ),
    },
    { key: 'status', label: 'Status', render: (trip) => <Badge value={trip.status} /> },
    {
      key: 'actions',
      label: 'Aksi',
      render: (trip) => {
        const nextOptions = TRIP_TRANSITIONS[trip.status] || [];
        return (
          <div className="row-actions">
            <button type="button" className="icon-btn" title="Detail & riwayat" onClick={() => setModal({ type: 'detail', trip })}>
              <Eye size={15} />
            </button>
            {isDriver && nextOptions.filter((status) => status !== 'CANCELLED').length > 0 && (
              <div className="quick-actions">
                {nextOptions
                  .filter((status) => status !== 'CANCELLED')
                  .map((status) => (
                    <button
                      type="button"
                      key={status}
                      className="btn btn-sm btn-primary"
                      disabled={busy}
                      onClick={() => quickStatus(trip, status)}
                    >
                      {QUICK_ACTION_LABELS[status] || statusLabel(status)}
                    </button>
                  ))}
              </div>
            )}
            {!isDriver && canUpdateAny && nextOptions.length > 0 && (
              <button type="button" className="icon-btn icon-blue" title="Ubah status" onClick={() => openStatus(trip)}>
                <CalendarClock size={15} />
              </button>
            )}
            {!['COMPLETED', 'CANCELLED'].includes(trip.status) && (isDriver || canUpdateAny) && (
              <button
                type="button"
                className={`icon-btn ${trip.checklist?.complete ? 'icon-good' : ''}`.trim()}
                title={trip.checklist?.complete ? 'Checklist lengkap' : 'Checklist pra-perjalanan belum lengkap'}
                onClick={() => openChecklist(trip)}
              >
                <ClipboardCheck size={15} />
              </button>
            )}
            {canAssign && !['COMPLETED', 'CANCELLED'].includes(trip.status) && (
              <button type="button" className="icon-btn" title="Ganti penugasan" onClick={() => setModal({ type: 'reassign', trip })}>
                <Repeat size={15} />
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
        eyebrow="Dispatch & eksekusi perjalanan"
        title="Trip Management"
        subtitle={
          isDriver
            ? 'Kelola status perjalanan yang ditugaskan kepada Anda.'
            : 'Pantau eksekusi perjalanan, ubah status, dan ganti penugasan armada.'
        }
        actions={
          <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari booking, rute, kendaraan, driver..." />
          <div className="filter-tabs">
            {STATUS_TABS.map(([value, label]) => (
              <button
                type="button"
                key={value || 'all'}
                className={`filter-tab ${filters.status === value ? 'filter-tab-active' : ''}`}
                onClick={() => setFilters({ ...filters, status: value })}
              >
                {label}
                <span>{counts[value] || 0}</span>
              </button>
            ))}
          </div>
        </div>

        <DataTable columns={columns} rows={filtered} loading={loading} empty="Tidak ada trip sesuai filter." />
      </div>

      {modal?.type === 'detail' && (
        <Modal
          title={`Trip ${modal.trip.booking?.code}`}
          subtitle={`${modal.trip.booking?.origin} → ${modal.trip.booking?.destination}`}
          onClose={() => setModal(null)}
          size="lg"
          footer={
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
              Tutup
            </button>
          }
        >
          {detailLoading ? (
            <div className="page-loading">
              <Spinner /> Memuat detail...
            </div>
          ) : detail ? (
            <>
              <div className="detail-grid">
                <DetailItem label="Status">
                  <Badge value={detail.status} />
                </DetailItem>
                <DetailItem label="Pemohon">{detail.booking?.requester?.name}</DetailItem>
                <DetailItem label="Keberangkatan">{fmtDateTime(detail.booking?.departureAt)}</DetailItem>
                <DetailItem label="Kembali">{detail.booking?.returnAt ? fmtDateTime(detail.booking.returnAt) : '—'}</DetailItem>
                <DetailItem label="Kendaraan">
                  {detail.vehicle?.plateNumber} — {detail.vehicle?.brand} {detail.vehicle?.model}
                </DetailItem>
                <DetailItem label="Driver">
                  {detail.driver?.name} <span className="muted">{detail.driver?.phone}</span>
                </DetailItem>
                <DetailItem label="Ditugaskan Oleh">{detail.assignedBy?.name || '—'}</DetailItem>
                <DetailItem label="Ditugaskan Pada">{fmtDateTime(detail.assignedAt)}</DetailItem>
                {detail.notes && (
                  <DetailItem label="Catatan" className="span-2">
                    {detail.notes}
                  </DetailItem>
                )}
              </div>
              <div className="section-divider">
                <h4>Checklist Pra-Perjalanan</h4>
              </div>
              {detail.checklist?.items?.length ? (
                <>
                  <ul className="checklist-view">
                    {detail.checklist.items.map((item) => (
                      <li key={item.key} className={item.checked ? 'checklist-done' : ''}>
                        <span className="checklist-mark">{item.checked ? '✓' : '○'}</span>
                        {item.label}
                      </li>
                    ))}
                  </ul>
                  <p className="muted small-note">
                    {detail.checklist.complete ? 'Checklist lengkap.' : 'Checklist belum lengkap — status Penjemputan membutuhkan checklist lengkap.'}
                    {detail.checklist.updatedAt ? ` Diperbarui ${fmtDateTime(detail.checklist.updatedAt)}.` : ''}
                    {detail.checklist.note ? ` Catatan: ${detail.checklist.note}` : ''}
                  </p>
                </>
              ) : (
                <p className="panel-empty">Checklist belum diisi. Checklist wajib lengkap sebelum status Penjemputan (PICKED_UP).</p>
              )}
              {!['COMPLETED', 'CANCELLED'].includes(detail.status) && (isDriver || canUpdateAny) && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openChecklist(detail)}>
                  <ClipboardCheck size={13} /> {detail.checklist ? 'Perbarui Checklist' : 'Isi Checklist'}
                </button>
              )}

              <div className="section-divider">
                <h4>Riwayat Perjalanan</h4>
              </div>
              <Timeline events={detail.events} />
            </>
          ) : (
            <p className="panel-empty">Detail tidak tersedia.</p>
          )}
        </Modal>
      )}

      {modal?.type === 'status' && (
        <Modal
          title="Ubah Status Trip"
          subtitle={`${modal.trip.booking?.code} · status saat ini ${statusLabel(modal.trip.status)}`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="trip-status-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Perbarui Status'}
              </button>
            </>
          }
        >
          <form id="trip-status-form" onSubmit={submitStatus}>
            <Field label="Status baru" hint="Hanya transisi yang valid yang ditampilkan.">
              <select value={statusForm.status} onChange={(event) => setStatusForm({ ...statusForm, status: event.target.value })} required>
                {(TRIP_TRANSITIONS[modal.trip.status] || []).map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </Field>
            {statusForm.status === 'PICKED_UP' && modal.trip.checklist?.complete !== true && (
              <p className="form-hint warn">
                Checklist pra-perjalanan belum lengkap. Backend akan menolak transisi PICKED_UP sampai seluruh item checklist dicentang.
              </p>
            )}
            <Field label="Catatan (opsional)">
              <textarea
                rows={3}
                value={statusForm.note}
                onChange={(event) => setStatusForm({ ...statusForm, note: event.target.value })}
                placeholder="Catatan status perjalanan..."
              />
            </Field>
          </form>
        </Modal>
      )}

      {modal?.type === 'reassign' && (
        <Modal
          title="Ganti Penugasan Trip"
          subtitle={`${modal.trip.booking?.code} · ${modal.trip.booking?.origin} → ${modal.trip.booking?.destination}`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="reassign-form" className="btn btn-primary" disabled={busy || assignLoading}>
                {busy ? 'Menyimpan...' : 'Simpan Penugasan'}
              </button>
            </>
          }
        >
          {assignLoading ? (
            <div className="page-loading">
              <Spinner /> Menghitung ketersediaan...
            </div>
          ) : availability ? (
            <form id="reassign-form" onSubmit={submitReassign}>
              <p className="muted small-note">
                Ketersediaan dihitung untuk jadwal {fmtDateTime(availability.window?.from)} — {fmtDateTime(availability.window?.to)}.
              </p>
              <div className="form-grid">
                <Field label={`Kendaraan tersedia (${availability.vehicles?.length || 0})`}>
                  <select
                    required
                    value={assignForm.vehicleId}
                    onChange={(event) => setAssignForm({ ...assignForm, vehicleId: event.target.value })}
                  >
                    <option value="">— Pilih kendaraan —</option>
                    {(availability.vehicles || []).map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.plateNumber} · {vehicle.brand} {vehicle.model} · {vehicle.capacity} pax
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`Driver tersedia (${availability.drivers?.length || 0})`}>
                  <select
                    required
                    value={assignForm.driverId}
                    onChange={(event) => setAssignForm({ ...assignForm, driverId: event.target.value })}
                  >
                    <option value="">— Pilih driver —</option>
                    {(availability.drivers || []).map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.name} · {driver.type === 'VENDOR' ? driver.vendor?.name || 'Vendor' : 'Internal'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Catatan perubahan (opsional)" className="span-2">
                  <textarea
                    rows={2}
                    value={assignForm.notes}
                    onChange={(event) => setAssignForm({ ...assignForm, notes: event.target.value })}
                    placeholder="Alasan pergantian kendaraan/driver..."
                  />
                </Field>
              </div>
            </form>
          ) : (
            <p className="panel-empty">Ketersediaan tidak dapat dimuat.</p>
          )}
        </Modal>
      )}

      {modal?.type === 'checklist' && (
        <Modal
          title="Checklist Pra-Perjalanan"
          subtitle={`${modal.trip.booking?.code} · wajib lengkap sebelum status Penjemputan (PICKED_UP)`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="button" className="btn btn-primary" onClick={saveChecklist} disabled={busy || checklistLoading}>
                {busy ? 'Menyimpan...' : 'Simpan Checklist'}
              </button>
            </>
          }
        >
          {checklistLoading ? (
            <div className="page-loading">
              <Spinner /> Memuat checklist...
            </div>
          ) : (
            <div className="checklist-form">
              {checklistForm.items.map((item, index) => (
                <label key={item.key} className={`checklist-item ${item.checked ? 'checklist-item-done' : ''}`.trim()}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(event) => {
                      const items = [...checklistForm.items];
                      items[index] = { ...item, checked: event.target.checked };
                      setChecklistForm({ ...checklistForm, items });
                    }}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
              <Field label="Catatan kondisi kendaraan (opsional)">
                <textarea
                  rows={2}
                  value={checklistForm.note}
                  onChange={(event) => setChecklistForm({ ...checklistForm, note: event.target.value })}
                  placeholder="Contoh: ada lecet kecil di bumper belakang."
                />
              </Field>
              <p className="muted small-note">
                {checklistForm.items.filter((item) => item.checked).length} / {checklistForm.items.length} item dicentang.
              </p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

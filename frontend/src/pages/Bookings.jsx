import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, CalendarDays, Check, Eye, List, Pencil, Plus, RefreshCw, Repeat, Trash2, Truck, X } from 'lucide-react';
import BookingCalendar from './BookingCalendar.jsx';
import { api, apiDelete, apiPatch, apiPost } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { fmtDateTime, toDateTimeLocal } from '../format.js';
import {
  Badge,
  ColumnPicker,
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
  useLocalStorageState,
  useToast,
  useUnsavedGuard,
} from '../ui.jsx';

const STATUS_TABS = [
  ['', 'Semua'],
  ['PENDING', 'Menunggu'],
  ['APPROVED', 'Disetujui'],
  ['ASSIGNED', 'Ditugaskan'],
  ['COMPLETED', 'Selesai'],
  ['REJECTED', 'Ditolak'],
  ['CANCELLED', 'Dibatalkan'],
];

const emptyForm = (user) => ({
  department: user?.department || '',
  purpose: '',
  passengerCount: 1,
  routeMode: 'route',
  routeId: '',
  origin: '',
  destination: '',
  departureAt: '',
  returnAt: '',
  repeat: false,
  frequency: 'WEEKLY',
  repeatCount: 3,
});

export default function Bookings() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState([]);
  const [options, setOptions] = useState({ routes: [], departments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useLocalStorageState('fleet_booking_filters_v1', { q: '', status: '' });
  const [hiddenColumns, setHiddenColumns] = useLocalStorageState('fleet_booking_columns_v1', { passengerCount: true });
  const [selected, setSelected] = useState(() => new Set());
  const [view, setView] = useState('list');

  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const deleteTimers = useRef(new Map());
  const [searchParams, setSearchParams] = useSearchParams();

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [availability, setAvailability] = useState(null);
  const [dispatchForm, setDispatchForm] = useState({ vehicleId: '', driverId: '', notes: '' });
  const [dispatchLoading, setDispatchLoading] = useState(false);

  const [reason, setReason] = useState('');

  const canDecide = can(user.role, 'bookings:decide');
  const canAssign = can(user.role, 'trips:assign');
  const canDelete = can(user.role, 'bookings:delete');
  const isElevated = ['SYSTEM_ADMIN', 'FLEET_MANAGER'].includes(user.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, opts] = await Promise.all([api('/bookings', { query: { pageSize: 200 } }), api('/bookings/options')]);
      setItems(list.items || []);
      setOptions(opts || { routes: [], departments: [] });
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
    api(`/bookings/${modal.booking.id}`)
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
    if (modal?.type !== 'dispatch') return undefined;
    let cancelled = false;
    setAvailability(null);
    setDispatchForm({ vehicleId: '', driverId: '', notes: '' });
    setDispatchLoading(true);
    api('/trips/availability', { query: { bookingId: modal.booking.id } })
      .then((data) => {
        if (!cancelled) setAvailability(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setDispatchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modal]);

  const counts = useMemo(() => {
    const map = { '': items.length };
    items.forEach((item) => {
      map[item.status] = (map[item.status] || 0) + 1;
    });
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter((booking) => {
      if (filters.status && booking.status !== filters.status) return false;
      if (!q) return true;
      return [booking.code, booking.requester?.name, booking.origin, booking.destination, booking.purpose]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [items, filters]);

  const openCreate = () => {
    setForm(emptyForm(user));
    setFormErrors({});
    setModal({ type: 'create' });
  };

  const openEdit = (booking) => {
    setForm({
      department: booking.department || '',
      purpose: booking.purpose || '',
      passengerCount: booking.passengerCount || 1,
      routeMode: booking.routeId ? 'route' : 'manual',
      routeId: booking.routeId || '',
      origin: booking.origin || '',
      destination: booking.destination || '',
      departureAt: toDateTimeLocal(booking.departureAt),
      returnAt: toDateTimeLocal(booking.returnAt),
    });
    setFormErrors({});
    setModal({ type: 'edit', booking });
  };

  const formDirty =
    (modal?.type === 'create' || modal?.type === 'edit') &&
    Boolean(form.purpose || form.origin || form.destination || form.departureAt || form.repeat || (form.routeMode === 'route' && form.routeId));
  useUnsavedGuard(formDirty);

  const closeFormModal = async () => {
    if (formDirty) {
      const ok = await confirm({
        title: 'Tutup formulir booking?',
        message: 'Perubahan yang belum disimpan akan hilang.',
        confirmLabel: 'Tutup tanpa simpan',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setModal(null);
  };

  useEffect(() => {
    const status = searchParams.get('status');
    const wantsNew = searchParams.get('new') === '1';
    if (status) setFilters((current) => ({ ...current, status }));
    if (wantsNew) {
      setForm(emptyForm(user));
      setFormErrors({});
      setModal({ type: 'create' });
    }
    if (status || wantsNew) setSearchParams({}, { replace: true });
    // Hydrate only on the first render with query params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      deleteTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    []
  );

  const openDispatch = (booking) => {
    setModal({ type: 'dispatch', booking });
  };

  const submitBooking = async (event) => {
    event.preventDefault();
    const errors = {};
    if (!form.purpose?.trim() || form.purpose.trim().length < 3) errors.purpose = 'Tujuan perjalanan minimal 3 karakter.';
    const pax = Number(form.passengerCount);
    if (!Number.isInteger(pax) || pax < 1 || pax > 80) errors.passengerCount = 'Jumlah penumpang harus antara 1 dan 80.';
    if (form.routeMode === 'route' && !form.routeId) errors.routeId = 'Pilih rute perjalanan atau isi asal/tujuan manual.';
    if (form.routeMode === 'manual') {
      if (!form.origin?.trim() || form.origin.trim().length < 2) errors.origin = 'Lokasi penjemputan minimal 2 karakter.';
      if (!form.destination?.trim() || form.destination.trim().length < 2) errors.destination = 'Lokasi tujuan minimal 2 karakter.';
    }
    if (!form.departureAt) errors.departureAt = 'Waktu keberangkatan wajib diisi.';
    else if (new Date(form.departureAt).getTime() < Date.now() - 5 * 60 * 1000) errors.departureAt = 'Waktu keberangkatan tidak boleh di masa lalu.';
    if (form.returnAt && form.departureAt && new Date(form.returnAt) <= new Date(form.departureAt)) {
      errors.returnAt = 'Waktu kembali harus setelah waktu keberangkatan.';
    }
    if (modal.type === 'create' && form.repeat) {
      const count = Number(form.repeatCount);
      if (!Number.isInteger(count) || count < 2 || count > 8) errors.repeatCount = 'Jumlah jadwal seri harus 2–8.';
    }
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    const payload = {
      department: form.department?.trim() || undefined,
      purpose: form.purpose.trim(),
      passengerCount: pax,
      departureAt: new Date(form.departureAt).toISOString(),
      returnAt: form.returnAt ? new Date(form.returnAt).toISOString() : null,
      routeId: form.routeMode === 'route' ? form.routeId : null,
    };
    if (form.routeMode === 'manual') {
      payload.origin = form.origin.trim();
      payload.destination = form.destination.trim();
    }
    if (modal.type === 'create' && form.repeat) {
      payload.recurrence = { frequency: form.frequency, count: Number(form.repeatCount) };
    }
    setBusy(true);
    try {
      if (modal.type === 'create') {
        const created = await apiPost('/bookings', payload);
        toast.success(
          created.series
            ? `${created.series.count} booking seri dibuat (${created.series.codes[0]} … ${created.series.codes[created.series.codes.length - 1]}), menunggu approval.`
            : `Booking ${created.code} dibuat dan menunggu approval.`
        );
      } else {
        await apiPatch(`/bookings/${modal.booking.id}`, payload);
        toast.success('Booking diperbarui.');
      }
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (booking, decision, decisionReason) => {
    setBusy(true);
    try {
      await apiPatch(`/bookings/${booking.id}/decision`, { decision, ...(decisionReason ? { reason: decisionReason } : {}) });
      toast.success(decision === 'APPROVED' ? `Booking ${booking.code} disetujui.` : `Booking ${booking.code} ditolak.`);
      setModal(null);
      setReason('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelBooking = async (booking) => {
    setBusy(true);
    try {
      await apiPatch(`/bookings/${booking.id}/cancel`, reason.trim() ? { reason: reason.trim() } : {});
      toast.success(`Booking ${booking.code} dibatalkan.`);
      setModal(null);
      setReason('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeBooking = async (booking) => {
    const ok = await confirm({
      title: 'Hapus booking?',
      message: `Booking ${booking.code} akan dihapus permanen.`,
      detail: 'Penghapusan ditunda sekitar 8 detik; gunakan tombol “Urungkan” pada notifikasi jika berubah pikiran.',
      confirmLabel: 'Hapus',
      tone: 'danger',
    });
    if (!ok) return;
    const snapshot = items;
    setItems((current) => current.filter((item) => item.id !== booking.id));
    const timer = window.setTimeout(async () => {
      deleteTimers.current.delete(booking.id);
      try {
        await apiDelete(`/bookings/${booking.id}`);
        toast.info(`Booking ${booking.code} dihapus permanen.`);
      } catch (err) {
        toast.error(err.message);
        setItems(snapshot);
      }
    }, 8000);
    deleteTimers.current.set(booking.id, timer);
    toast.success(`Booking ${booking.code} dihapus.`, {
      action: {
        label: 'Urungkan',
        onClick: () => {
          const pending = deleteTimers.current.get(booking.id);
          if (pending) window.clearTimeout(pending);
          deleteTimers.current.delete(booking.id);
          setItems(snapshot);
        },
      },
    });
  };

  const cancelSeries = async (booking) => {
    const ok = await confirm({
      title: 'Batalkan seluruh seri booking?',
      message: `Semua jadwal aktif pada seri dengan kode ${booking.code} akan dibatalkan.`,
      confirmLabel: 'Batalkan seri',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await apiPatch(`/bookings/series/${booking.seriesId}/cancel`, reason.trim() ? { reason: reason.trim() } : {});
      toast.success(`${result.cancelled} jadwal dibatalkan${result.skipped ? `, ${result.skipped} jadwal dilewati karena sudah selesai/tidak dapat dibatalkan` : ''}.`);
      setModal(null);
      setReason('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const bulkApprove = async () => {
    const pending = filtered.filter((booking) => selected.has(String(booking.id)) && booking.status === 'PENDING');
    if (!pending.length) return;
    setBusy(true);
    let done = 0;
    let failed = 0;
    for (const booking of pending) {
      try {
        await apiPatch(`/bookings/${booking.id}/decision`, { decision: 'APPROVED' });
        done += 1;
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    setSelected(new Set());
    if (done) toast.success(`${done} booking disetujui${failed ? `, ${failed} gagal` : ''}.`);
    else toast.error('Tidak ada booking yang berhasil disetujui.');
    await load();
  };

  const submitDispatch = async (event) => {
    event.preventDefault();
    if (!dispatchForm.vehicleId || !dispatchForm.driverId) {
      toast.error('Pilih kendaraan dan driver.');
      return;
    }
    setBusy(true);
    try {
      const trip = await apiPost('/trips', {
        bookingId: modal.booking.id,
        vehicleId: dispatchForm.vehicleId,
        driverId: dispatchForm.driverId,
        notes: dispatchForm.notes || undefined,
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

  const canEdit = (booking) =>
    (booking.requesterId === user.id && booking.status === 'PENDING') ||
    (isElevated && ['PENDING', 'APPROVED'].includes(booking.status));

  const canCancel = (booking) =>
    ['PENDING', 'APPROVED', 'ASSIGNED'].includes(booking.status) &&
    !['PICKED_UP', 'IN_PROGRESS'].includes(booking.trip?.status) &&
    (canDecide || booking.requesterId === user.id);

  const columns = [
    {
      key: 'code',
      label: 'Kode',
      render: (booking) => (
        <div className="cell-stack">
          <b>{booking.code}</b>
          <small>{fmtDateTime(booking.createdAt)}</small>
          {booking.seriesId && (
            <small className="series-tag">
              <Repeat size={10} /> Seri berulang
            </small>
          )}
        </div>
      ),
    },
    {
      key: 'requester',
      label: 'Pemohon',
      render: (booking) => (
        <div className="cell-stack">
          <b>{booking.requester?.name || '—'}</b>
          <small>{booking.department || booking.requester?.department || '—'}</small>
        </div>
      ),
    },
    {
      key: 'route',
      label: 'Rute',
      render: (booking) => (
        <div className="cell-stack">
          <b>
            {booking.origin} → {booking.destination}
          </b>
          <small>{booking.purpose}</small>
        </div>
      ),
    },
    { key: 'departureAt', label: 'Keberangkatan', render: (booking) => fmtDateTime(booking.departureAt) },
    { key: 'passengerCount', label: 'Pax', render: (booking) => `${booking.passengerCount} orang` },
    {
      key: 'assignment',
      label: 'Penugasan',
      render: (booking) =>
        booking.trip ? (
          <div className="cell-stack">
            <b>{booking.trip.vehicle?.plateNumber || '—'}</b>
            <small>{booking.trip.driver?.name || '—'}</small>
          </div>
        ) : (
          <span className="muted">Belum ditugaskan</span>
        ),
    },
    { key: 'status', label: 'Status', render: (booking) => <Badge value={booking.status} /> },
    {
      key: 'actions',
      label: 'Aksi',
      render: (booking) => (
        <div className="row-actions">
          <button type="button" className="icon-btn" title="Detail" onClick={() => setModal({ type: 'detail', booking })}>
            <Eye size={15} />
          </button>
          {booking.status === 'PENDING' && canDecide && (
            <>
              <button
                type="button"
                className="icon-btn icon-good"
                title="Setujui"
                onClick={() => decide(booking, 'APPROVED')}
                disabled={busy}
              >
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
              >
                <X size={15} />
              </button>
            </>
          )}
          {booking.status === 'APPROVED' && canAssign && (
            <button type="button" className="icon-btn icon-blue" title="Tugaskan kendaraan & driver" onClick={() => openDispatch(booking)}>
              <Truck size={15} />
            </button>
          )}
          {canEdit(booking) && (
            <button type="button" className="icon-btn" title="Ubah" onClick={() => openEdit(booking)}>
              <Pencil size={15} />
            </button>
          )}
          {canCancel(booking) && (
            <button
              type="button"
              className="icon-btn icon-bad"
              title="Batalkan booking"
              onClick={() => {
                setReason('');
                setModal({ type: 'cancel', booking });
              }}
            >
              <Ban size={15} />
            </button>
          )}
          {canDelete && ['REJECTED', 'CANCELLED'].includes(booking.status) && !booking.trip && (
            <button type="button" className="icon-btn icon-bad" title="Hapus" onClick={() => removeBooking(booking)}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const tableColumns = columns.filter((column) => column.key === 'actions' || !hiddenColumns[column.key]);
  const selectedPending = filtered.filter((booking) => selected.has(String(booking.id)) && booking.status === 'PENDING').length;

  return (
    <>
      <PageHeader
        eyebrow="Permintaan transportasi"
        title="Booking Transportasi"
        subtitle="Buat permintaan, setujui, tugaskan armada, dan pantau status perjalanan."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={15} /> Buat Booking
            </button>
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari kode, pemohon, rute..." />
          <div className="toolbar-right">
            <span className="result-count">
              {filtered.length} dari {items.length} booking
            </span>
            <ColumnPicker
              columns={columns.filter((column) => column.key !== 'actions')}
              hidden={hiddenColumns}
              onChange={setHiddenColumns}
            />
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
            <div className="view-toggle">
              <button
                type="button"
                className={view === 'list' ? 'view-toggle-active' : ''}
                onClick={() => setView('list')}
                title="Tampilan daftar"
              >
                <List size={14} /> Daftar
              </button>
              <button
                type="button"
                className={view === 'calendar' ? 'view-toggle-active' : ''}
                onClick={() => setView('calendar')}
                title="Tampilan kalender"
              >
                <CalendarDays size={14} /> Kalender
              </button>
            </div>
          </div>
        </div>

        {canDecide && selectedPending > 0 && (
          <div className="bulk-bar">
            <span>
              <b>{selectedPending}</b> booking terpilih menunggu persetujuan
            </span>
            <div className="bulk-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())} disabled={busy}>
                Bersihkan
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={bulkApprove} disabled={busy}>
                <Check size={14} /> {busy ? 'Memproses...' : 'Setujui terpilih'}
              </button>
            </div>
          </div>
        )}

        {view === 'list' ? (
          <DataTable
            columns={tableColumns}
            rows={filtered}
            loading={loading}
            empty="Tidak ada booking sesuai filter."
            emptyAction={
              <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
                <Plus size={14} /> Buat booking pertama
              </button>
            }
            rowKey={(booking) => String(booking.id)}
            selectable={canDecide}
            selectedIds={selected}
            onSelect={setSelected}
            pageSize={25}
          />
        ) : (
          <BookingCalendar
            bookings={filtered}
            canCheckAvailability={canAssign}
            onOpenBooking={(booking) => setModal({ type: 'detail', booking })}
          />
        )}
      </div>

      {(modal?.type === 'create' || modal?.type === 'edit') && (
        <Modal
          title={modal.type === 'create' ? 'Buat Permintaan Transportasi' : `Ubah Booking ${modal.booking.code}`}
          subtitle="Waktu keberangkatan tidak boleh di masa lalu."
          onClose={closeFormModal}
          size="lg"
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeFormModal}>
                Batal
              </button>
              <button type="submit" form="booking-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Simpan Booking'}
              </button>
            </>
          }
        >
          <form id="booking-form" onSubmit={submitBooking} noValidate>
            <div className="form-grid">
              <Field label="Departemen">
                <input
                  list="booking-departments"
                  value={form.department}
                  onChange={(event) => setForm({ ...form, department: event.target.value })}
                  placeholder="Contoh: Crew Operations"
                />
                <datalist id="booking-departments">
                  {options.departments.map((department) => (
                    <option key={department} value={department} />
                  ))}
                </datalist>
              </Field>
              <Field label="Jumlah Penumpang" error={formErrors.passengerCount}>
                <input
                  required
                  type="number"
                  min="1"
                  max="80"
                  value={form.passengerCount}
                  onChange={(event) => setForm({ ...form, passengerCount: event.target.value })}
                />
              </Field>
              <Field label="Tujuan Perjalanan" className="span-2" error={formErrors.purpose}>
                <input
                  required
                  minLength={3}
                  value={form.purpose}
                  onChange={(event) => setForm({ ...form, purpose: event.target.value })}
                  placeholder="Contoh: Meeting koordinasi di Bandung"
                />
              </Field>
              <Field
                label="Rute"
                className="span-2"
                error={formErrors.routeId}
                hint={formErrors.routeId ? undefined : 'Pilih rute master atau isi asal/tujuan manual.'}
              >
                <select
                  value={form.routeMode === 'manual' ? '__manual' : form.routeId}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === '__manual') setForm({ ...form, routeMode: 'manual', routeId: '' });
                    else setForm({ ...form, routeMode: 'route', routeId: value });
                  }}
                >
                  <option value="" disabled>
                    — Pilih rute —
                  </option>
                  {options.routes.map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.origin} → {route.destination} ({route.distanceKm} km)
                    </option>
                  ))}
                  <option value="__manual">Isi asal &amp; tujuan manual</option>
                </select>
              </Field>
              {form.routeMode === 'manual' && (
                <>
                  <Field label="Lokasi Penjemputan" error={formErrors.origin}>
                    <input
                      required
                      minLength={2}
                      value={form.origin}
                      onChange={(event) => setForm({ ...form, origin: event.target.value })}
                      placeholder="Contoh: Stasiun Halim"
                    />
                  </Field>
                  <Field label="Lokasi Tujuan" error={formErrors.destination}>
                    <input
                      required
                      minLength={2}
                      value={form.destination}
                      onChange={(event) => setForm({ ...form, destination: event.target.value })}
                      placeholder="Contoh: Kantor Pusat"
                    />
                  </Field>
                </>
              )}
              <Field label="Waktu Keberangkatan" error={formErrors.departureAt}>
                <input
                  required
                  type="datetime-local"
                  value={form.departureAt}
                  onChange={(event) => setForm({ ...form, departureAt: event.target.value })}
                />
              </Field>
              <Field label="Waktu Kembali (opsional)" error={formErrors.returnAt}>
                <input
                  type="datetime-local"
                  value={form.returnAt}
                  onChange={(event) => setForm({ ...form, returnAt: event.target.value })}
                />
              </Field>
              {modal.type === 'create' && (
                <div className="span-2 recurrence-box">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={form.repeat}
                      onChange={(event) => setForm({ ...form, repeat: event.target.checked })}
                    />
                    <span>Buat jadwal berulang (booking multi-hari)</span>
                  </label>
                  {form.repeat && (
                    <div className="form-grid recurrence-grid">
                      <Field label="Frekuensi">
                        <select
                          value={form.frequency}
                          onChange={(event) => setForm({ ...form, frequency: event.target.value })}
                        >
                          <option value="DAILY">Harian</option>
                          <option value="WEEKLY">Mingguan</option>
                        </select>
                      </Field>
                      <Field
                        label="Jumlah jadwal"
                        error={formErrors.repeatCount}
                        hint={formErrors.repeatCount ? undefined : '2–8 jadwal, termasuk jadwal pertama.'}
                      >
                        <input
                          type="number"
                          min="2"
                          max="8"
                          value={form.repeatCount}
                          onChange={(event) => setForm({ ...form, repeatCount: event.target.value })}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </div>
          </form>
        </Modal>
      )}

      {modal?.type === 'detail' && (
        <Modal
          title={`Booking ${modal.booking.code}`}
          subtitle="Detail permintaan dan riwayat perjalanan."
          onClose={() => setModal(null)}
          size="lg"
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Tutup
              </button>
              {detail?.seriesId && canCancel(detail) && (
                <button type="button" className="btn btn-danger" onClick={() => cancelSeries(detail)} disabled={busy}>
                  <Repeat size={15} /> Batalkan Seluruh Seri
                </button>
              )}
              {detail?.status === 'APPROVED' && canAssign && (
                <button type="button" className="btn btn-primary" onClick={() => openDispatch(detail)}>
                  <Truck size={15} /> Tugaskan Kendaraan &amp; Driver
                </button>
              )}
            </>
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
                <DetailItem label="Pemohon">
                  {detail.requester?.name} <span className="muted">({detail.requester?.email})</span>
                </DetailItem>
                <DetailItem label="Departemen">{detail.department}</DetailItem>
                <DetailItem label="Penumpang">{detail.passengerCount} orang</DetailItem>
                <DetailItem label="Asal">{detail.origin}</DetailItem>
                <DetailItem label="Tujuan">{detail.destination}</DetailItem>
                <DetailItem label="Keberangkatan">{fmtDateTime(detail.departureAt)}</DetailItem>
                <DetailItem label="Kembali">{detail.returnAt ? fmtDateTime(detail.returnAt) : 'Tidak ada'}</DetailItem>
                <DetailItem label="Dibuat">{fmtDateTime(detail.createdAt)}</DetailItem>
                <DetailItem label="Diputuskan">
                  {detail.decidedBy ? `${detail.decidedBy.name} · ${fmtDateTime(detail.decidedAt)}` : '—'}
                </DetailItem>
                <DetailItem label="Tujuan Perjalanan" className="span-2">
                  {detail.purpose}
                </DetailItem>
                {detail.rejectionReason && (
                  <DetailItem label="Alasan Penolakan" className="span-2">
                    {detail.rejectionReason}
                  </DetailItem>
                )}
                {detail.cancelledReason && (
                  <DetailItem label="Alasan Pembatalan" className="span-2">
                    {detail.cancelledReason}
                  </DetailItem>
                )}
              </div>

              <div className="section-divider">
                <h4>Penugasan &amp; Perjalanan</h4>
              </div>

              {detail.trip ? (
                <>
                  <div className="detail-grid">
                    <DetailItem label="Kendaraan">
                      {detail.trip.vehicle?.plateNumber} — {detail.trip.vehicle?.brand} {detail.trip.vehicle?.model}
                    </DetailItem>
                    <DetailItem label="Driver">
                      {detail.trip.driver?.name} <span className="muted">{detail.trip.driver?.phone}</span>
                    </DetailItem>
                    <DetailItem label="Status Trip">
                      <Badge value={detail.trip.status} />
                    </DetailItem>
                    <DetailItem label="Ditugaskan Oleh">{detail.trip.assignedBy?.name || '—'}</DetailItem>
                  </div>
                  <Timeline events={detail.trip.events} />
                </>
              ) : (
                <p className="panel-empty">Belum ada penugasan kendaraan/driver untuk booking ini.</p>
              )}
            </>
          ) : (
            <p className="panel-empty">Detail tidak tersedia.</p>
          )}
        </Modal>
      )}

      {modal?.type === 'dispatch' && (
        <Modal
          title={`Tugaskan Armada — ${modal.booking.code}`}
          subtitle={`${modal.booking.origin} → ${modal.booking.destination} · ${modal.booking.passengerCount} penumpang`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="dispatch-form" className="btn btn-primary" disabled={busy || dispatchLoading}>
                {busy ? 'Memproses...' : 'Buat Penugasan'}
              </button>
            </>
          }
        >
          {dispatchLoading ? (
            <div className="page-loading">
              <Spinner /> Menghitung ketersediaan...
            </div>
          ) : availability ? (
            <form id="dispatch-form" onSubmit={submitDispatch}>
              <p className="muted small-note">
                Jadwal pemakaian: {fmtDateTime(availability.window?.from)} — {fmtDateTime(availability.window?.to)}. Daftar di bawah sudah
                bebas bentrok jadwal, kapasitas cukup, dan SIM driver masih berlaku.
              </p>
              <div className="form-grid">
                <Field label={`Kendaraan tersedia (${availability.vehicles?.length || 0})`}>
                  <select
                    required
                    value={dispatchForm.vehicleId}
                    onChange={(event) => setDispatchForm({ ...dispatchForm, vehicleId: event.target.value })}
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
                    value={dispatchForm.driverId}
                    onChange={(event) => setDispatchForm({ ...dispatchForm, driverId: event.target.value })}
                  >
                    <option value="">— Pilih driver —</option>
                    {(availability.drivers || []).map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.name} · {driver.type === 'VENDOR' ? driver.vendor?.name || 'Vendor' : 'Internal'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Catatan (opsional)" className="span-2">
                  <textarea
                    rows={2}
                    value={dispatchForm.notes}
                    onChange={(event) => setDispatchForm({ ...dispatchForm, notes: event.target.value })}
                    placeholder="Instruksi untuk driver..."
                  />
                </Field>
              </div>
              {(!availability.vehicles?.length || !availability.drivers?.length) && (
                <p className="form-hint warn">Belum ada kendaraan/driver yang memenuhi syarat pada jadwal ini.</p>
              )}
            </form>
          ) : (
            <p className="panel-empty">Ketersediaan tidak dapat dimuat.</p>
          )}
        </Modal>
      )}

      {modal?.type === 'reject' && (
        <Modal
          title={`Tolak Booking ${modal.booking.code}`}
          subtitle="Alasan penolakan wajib diisi dan akan terlihat oleh pemohon."
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => {
                  if (reason.trim().length < 3) {
                    toast.error('Alasan penolakan minimal 3 karakter.');
                    return;
                  }
                  decide(modal.booking, 'REJECTED', reason.trim());
                }}
              >
                Tolak Booking
              </button>
            </>
          }
        >
          <Field label="Alasan penolakan">
            <textarea
              rows={3}
              required
              minLength={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Contoh: Kendaraan tidak tersedia pada jadwal tersebut."
            />
          </Field>
        </Modal>
      )}

      {modal?.type === 'cancel' && (
        <Modal
          title={`Batalkan Booking ${modal.booking.code}`}
          subtitle="Jika sudah ditugaskan, trip aktif akan ikut dibatalkan."
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Kembali
              </button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => cancelBooking(modal.booking)}>
                Batalkan Booking
              </button>
            </>
          }
        >
          <Field label="Alasan pembatalan (opsional)">
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Contoh: Agenda dibatalkan oleh pemohon."
            />
          </Field>
        </Modal>
      )}
    </>
  );
}

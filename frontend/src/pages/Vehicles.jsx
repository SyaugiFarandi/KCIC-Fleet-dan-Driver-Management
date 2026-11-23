import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, apiDelete, apiPatch, apiPost } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { expiryState, fmtDate } from '../format.js';
import {
  Badge,
  DataTable,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  SearchBox,
  useConfirm,
  useToast,
} from '../ui.jsx';

const emptyForm = () => ({
  plateNumber: '',
  brand: '',
  model: '',
  category: 'Minibus',
  capacity: 4,
  ownership: 'KCIC',
  vendorId: '',
  year: '',
  color: '',
  odometerKm: '',
  lastServiceAt: '',
  stnkExpiry: '',
  insuranceExpiry: '',
  notes: '',
  status: 'AVAILABLE',
});

function ExpiryCell({ label, value }) {
  const state = expiryState(value);
  return (
    <div className="cell-stack">
      <small>
        {label}: {fmtDate(value)}
      </small>
      {state && state.tone !== 'green' && <Badge value="EXPIRY" label={state.label} tone={state.tone} />}
    </div>
  );
}

export default function Vehicles() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', status: '', ownership: '' });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);

  const canWrite = can(user.role, 'vehicles:write');
  const canDelete = can(user.role, 'vehicles:delete');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, vendorList] = await Promise.all([
        api('/vehicles', { query: { pageSize: 200 } }),
        api('/vendors', { query: { pageSize: 200 } }),
      ]);
      setItems(list.items || []);
      setVendors(vendorList.items || []);
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
    return items.filter((vehicle) => {
      if (filters.status && vehicle.status !== filters.status) return false;
      if (filters.ownership && vehicle.ownership !== filters.ownership) return false;
      if (!q) return true;
      return [vehicle.plateNumber, vehicle.brand, vehicle.model, vehicle.category, vehicle.vendor?.name]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [items, filters]);

  const openCreate = () => {
    setForm(emptyForm());
    setModal({ type: 'create' });
  };

  const openEdit = (vehicle) => {
    setForm({
      plateNumber: vehicle.plateNumber,
      brand: vehicle.brand,
      model: vehicle.model,
      category: vehicle.category,
      capacity: vehicle.capacity,
      ownership: vehicle.ownership,
      vendorId: vehicle.vendorId || '',
      year: vehicle.year ?? '',
      color: vehicle.color || '',
      odometerKm: vehicle.odometerKm ?? '',
      lastServiceAt: vehicle.lastServiceAt ? vehicle.lastServiceAt.slice(0, 10) : '',
      stnkExpiry: vehicle.stnkExpiry ? vehicle.stnkExpiry.slice(0, 10) : '',
      insuranceExpiry: vehicle.insuranceExpiry ? vehicle.insuranceExpiry.slice(0, 10) : '',
      notes: vehicle.notes || '',
      status: vehicle.status,
    });
    setModal({ type: 'edit', vehicle });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (form.ownership === 'VENDOR' && !form.vendorId) {
      toast.error('Pilih vendor untuk kendaraan milik vendor.');
      return;
    }
    const editableStatus = modal.type === 'edit' && ['AVAILABLE', 'INACTIVE'].includes(modal.vehicle.status);
    const payload = {
      plateNumber: form.plateNumber.trim(),
      brand: form.brand.trim(),
      model: form.model.trim(),
      category: form.category.trim(),
      capacity: Number(form.capacity),
      ownership: form.ownership,
      vendorId: form.ownership === 'VENDOR' ? form.vendorId : null,
      year: form.year ? Number(form.year) : null,
      color: form.color.trim() || null,
      odometerKm: form.odometerKm !== '' ? Number(form.odometerKm) : null,
      lastServiceAt: form.lastServiceAt || null,
      stnkExpiry: form.stnkExpiry || null,
      insuranceExpiry: form.insuranceExpiry || null,
      notes: form.notes.trim() || null,
      ...(editableStatus ? { status: form.status } : {}),
    };
    setBusy(true);
    try {
      if (modal.type === 'create') {
        await apiPost('/vehicles', payload);
        toast.success('Kendaraan ditambahkan.');
      } else {
        await apiPatch(`/vehicles/${modal.vehicle.id}`, payload);
        toast.success('Data kendaraan diperbarui.');
      }
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (vehicle) => {
    const ok = await confirm({
      title: 'Hapus kendaraan?',
      message: `Kendaraan ${vehicle.plateNumber} akan dihapus permanen.`,
      confirmLabel: 'Hapus',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiDelete(`/vehicles/${vehicle.id}`);
      toast.success('Kendaraan dihapus.');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    {
      key: 'plate',
      label: 'Nomor Polisi',
      render: (vehicle) => (
        <div className="cell-stack">
          <b>{vehicle.plateNumber}</b>
          <small>{vehicle.category}</small>
        </div>
      ),
    },
    {
      key: 'vehicle',
      label: 'Kendaraan',
      render: (vehicle) => (
        <div className="cell-stack">
          <b>
            {vehicle.brand} {vehicle.model}
          </b>
          <small>
            {vehicle.year || '—'} {vehicle.color ? `· ${vehicle.color}` : ''}
          </small>
        </div>
      ),
    },
    { key: 'capacity', label: 'Kapasitas', render: (vehicle) => `${vehicle.capacity} orang` },
    {
      key: 'ownership',
      label: 'Kepemilikan',
      render: (vehicle) => (
        <div className="cell-stack">
          <Badge value={vehicle.ownership} tone={vehicle.ownership === 'KCIC' ? 'blue' : 'purple'} />
          {vehicle.vendor && <small>{vehicle.vendor.name}</small>}
        </div>
      ),
    },
    { key: 'status', label: 'Status', render: (vehicle) => <Badge value={vehicle.status} /> },
    {
      key: 'documents',
      label: 'Dokumen',
      render: (vehicle) => (
        <div className="cell-stack doc-cell">
          <ExpiryCell label="STNK" value={vehicle.stnkExpiry} />
          <ExpiryCell label="Asuransi" value={vehicle.insuranceExpiry} />
        </div>
      ),
    },
    {
      key: 'history',
      label: 'Riwayat',
      render: (vehicle) => (
        <div className="cell-stack">
          <small>{vehicle._count?.trips || 0} trip</small>
          <small>{vehicle._count?.maintenance || 0} maintenance</small>
          <small>Servis: {vehicle.lastServiceAt ? fmtDate(vehicle.lastServiceAt) : '—'}</small>
        </div>
      ),
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            label: 'Aksi',
            render: (vehicle) => (
              <div className="row-actions">
                <button type="button" className="icon-btn" title="Ubah" onClick={() => openEdit(vehicle)}>
                  <Pencil size={15} />
                </button>
                {canDelete && (
                  <button type="button" className="icon-btn icon-bad" title="Hapus" onClick={() => remove(vehicle)}>
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
        eyebrow="FLEET MASTER DATA"
        title="Manajemen Kendaraan"
        subtitle="Kelola armada KCIC dan vendor beserta status operasionalnya."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            {canWrite && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={15} /> Tambah Kendaraan
              </button>
            )}
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari plat, merek, model..." />
          <div className="toolbar-selects">
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">Semua status</option>
              <option value="AVAILABLE">Tersedia</option>
              <option value="ASSIGNED">Ditugaskan</option>
              <option value="MAINTENANCE">Perawatan</option>
              <option value="INACTIVE">Nonaktif</option>
            </select>
            <select value={filters.ownership} onChange={(event) => setFilters({ ...filters, ownership: event.target.value })}>
              <option value="">Semua kepemilikan</option>
              <option value="KCIC">KCIC</option>
              <option value="VENDOR">Vendor</option>
            </select>
          </div>
        </div>
        <DataTable columns={columns} rows={filtered} loading={loading} empty="Tidak ada kendaraan sesuai filter." />
      </div>

      {modal && (
        <Modal
          title={modal.type === 'create' ? 'Tambah Kendaraan' : `Ubah ${modal.vehicle.plateNumber}`}
          subtitle="Status ASSIGNED dan MAINTENANCE dikelola otomatis oleh trip & maintenance."
          onClose={() => setModal(null)}
          size="lg"
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="vehicle-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Simpan'}
              </button>
            </>
          }
        >
          <form id="vehicle-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Nomor Polisi">
                <input
                  required
                  minLength={3}
                  maxLength={20}
                  value={form.plateNumber}
                  onChange={(event) => setForm({ ...form, plateNumber: event.target.value })}
                  placeholder="B 1234 KCX"
                />
              </Field>
              <Field label="Kategori">
                <input
                  required
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                  placeholder="Minibus / Bus / MPV"
                />
              </Field>
              <Field label="Merek">
                <input required value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} />
              </Field>
              <Field label="Model">
                <input required value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
              </Field>
              <Field label="Kapasitas (orang)">
                <input
                  required
                  type="number"
                  min="1"
                  max="80"
                  value={form.capacity}
                  onChange={(event) => setForm({ ...form, capacity: event.target.value })}
                />
              </Field>
              <Field label="Kepemilikan">
                <select value={form.ownership} onChange={(event) => setForm({ ...form, ownership: event.target.value })}>
                  <option value="KCIC">KCIC</option>
                  <option value="VENDOR">Vendor</option>
                </select>
              </Field>
              {form.ownership === 'VENDOR' && (
                <Field label="Vendor">
                  <select required value={form.vendorId} onChange={(event) => setForm({ ...form, vendorId: event.target.value })}>
                    <option value="">— Pilih vendor —</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Tahun">
                <input type="number" min="1990" value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} />
              </Field>
              <Field label="Warna">
                <input value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
              </Field>
              <Field label="Odometer (km)">
                <input
                  type="number"
                  min="0"
                  value={form.odometerKm}
                  onChange={(event) => setForm({ ...form, odometerKm: event.target.value })}
                />
              </Field>
              <Field label="Servis Terakhir">
                <input
                  type="date"
                  value={form.lastServiceAt}
                  onChange={(event) => setForm({ ...form, lastServiceAt: event.target.value })}
                />
              </Field>
              <Field label="Masa Berlaku STNK" hint="Badge 'segera habis' muncul jika ≤ 30 hari.">
                <input
                  type="date"
                  value={form.stnkExpiry}
                  onChange={(event) => setForm({ ...form, stnkExpiry: event.target.value })}
                />
              </Field>
              <Field label="Masa Berlaku Asuransi">
                <input
                  type="date"
                  value={form.insuranceExpiry}
                  onChange={(event) => setForm({ ...form, insuranceExpiry: event.target.value })}
                />
              </Field>
              {modal.type === 'edit' && ['AVAILABLE', 'INACTIVE'].includes(modal.vehicle.status) && (
                <Field label="Status manual">
                  <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                    <option value="AVAILABLE">Tersedia</option>
                    <option value="INACTIVE">Nonaktif</option>
                  </select>
                </Field>
              )}
              <Field label="Catatan" className="span-2">
                <textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
              </Field>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

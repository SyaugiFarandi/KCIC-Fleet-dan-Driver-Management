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
  name: '',
  phone: '',
  licenseNumber: '',
  licenseCategory: 'SIM A',
  licenseExpiry: '',
  type: 'INTERNAL',
  vendorId: '',
  userId: '',
  active: true,
  notes: '',
});

export default function Drivers() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', type: '', active: '' });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);

  const canWrite = can(user.role, 'drivers:write');
  const canDelete = can(user.role, 'drivers:delete');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, vendorList] = await Promise.all([
        api('/drivers', { query: { pageSize: 200 } }),
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

  const loadCandidates = async () => {
    try {
      const result = await api('/drivers/user-candidates');
      setCandidates(result.items || []);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter((driver) => {
      if (filters.type && driver.type !== filters.type) return false;
      if (filters.active && String(driver.active) !== filters.active) return false;
      if (!q) return true;
      return [driver.name, driver.phone, driver.licenseNumber, driver.user?.email, driver.vendor?.name]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [items, filters]);

  const openCreate = () => {
    setForm(emptyForm());
    loadCandidates();
    setModal({ type: 'create' });
  };

  const openEdit = (driver) => {
    setForm({
      name: driver.name,
      phone: driver.phone,
      licenseNumber: driver.licenseNumber,
      licenseCategory: driver.licenseCategory || 'SIM A',
      licenseExpiry: driver.licenseExpiry ? driver.licenseExpiry.slice(0, 10) : '',
      type: driver.type,
      vendorId: driver.vendorId || '',
      userId: driver.userId || '',
      active: driver.active,
      notes: driver.notes || '',
    });
    loadCandidates();
    setModal({ type: 'edit', driver });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (form.type === 'VENDOR' && !form.vendorId) {
      toast.error('Pilih vendor untuk driver vendor.');
      return;
    }
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      licenseNumber: form.licenseNumber.trim(),
      licenseCategory: form.licenseCategory.trim(),
      licenseExpiry: form.licenseExpiry,
      type: form.type,
      vendorId: form.type === 'VENDOR' ? form.vendorId : null,
      userId: form.userId || null,
      active: Boolean(form.active),
      notes: form.notes.trim() || null,
    };
    setBusy(true);
    try {
      if (modal.type === 'create') {
        await apiPost('/drivers', payload);
        toast.success('Driver ditambahkan.');
      } else {
        await apiPatch(`/drivers/${modal.driver.id}`, payload);
        toast.success('Data driver diperbarui.');
      }
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (driver) => {
    const ok = await confirm({
      title: 'Hapus driver?',
      message: `Driver ${driver.name} akan dihapus permanen.`,
      confirmLabel: 'Hapus',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiDelete(`/drivers/${driver.id}`);
      toast.success('Driver dihapus.');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    {
      key: 'name',
      label: 'Nama Driver',
      render: (driver) => (
        <div className="cell-stack">
          <b>{driver.name}</b>
          <small>{driver.type === 'VENDOR' ? driver.vendor?.name || 'Vendor' : 'Internal'}</small>
        </div>
      ),
    },
    { key: 'phone', label: 'Telepon' },
    {
      key: 'license',
      label: 'SIM',
      render: (driver) => {
        const state = expiryState(driver.licenseExpiry);
        return (
          <div className="cell-stack">
            <b>{driver.licenseNumber}</b>
            <small>
              {driver.licenseCategory || 'SIM'} · {fmtDate(driver.licenseExpiry)}
            </small>
            {state && state.tone !== 'green' && (
              <Badge
                value="SIM"
                tone={state.tone}
                label={state.days < 0 ? 'SIM kedaluwarsa' : `SIM ${state.label}`}
              />
            )}
          </div>
        );
      },
    },
    {
      key: 'account',
      label: 'Akun',
      render: (driver) =>
        driver.user ? (
          <div className="cell-stack">
            <b>{driver.user.email}</b>
            <small>{driver.user.active ? 'Aktif' : 'Nonaktif'}</small>
          </div>
        ) : (
          <span className="muted">Tidak tertaut</span>
        ),
    },
    { key: 'trips', label: 'Trip', render: (driver) => driver._count?.trips || 0 },
    {
      key: 'status',
      label: 'Status',
      render: (driver) => (
        <div className="cell-stack">
          <Badge value={driver.active ? 'ACTIVE' : 'INACTIVE'} label={driver.active ? 'Aktif' : 'Nonaktif'} />
          <small>{driver.available ? 'Tersedia' : 'Sedang bertugas'}</small>
        </div>
      ),
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            label: 'Aksi',
            render: (driver) => (
              <div className="row-actions">
                <button type="button" className="icon-btn" title="Ubah" onClick={() => openEdit(driver)}>
                  <Pencil size={15} />
                </button>
                {canDelete && (
                  <button type="button" className="icon-btn icon-bad" title="Hapus" onClick={() => remove(driver)}>
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
        eyebrow="Pool driver"
        title="Manajemen Driver"
        subtitle="Kelola data driver internal dan vendor, masa berlaku SIM, serta akun login driver."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            {canWrite && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={15} /> Tambah Driver
              </button>
            )}
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari nama, telepon, SIM..." />
          <div className="toolbar-selects">
            <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
              <option value="">Semua tipe</option>
              <option value="INTERNAL">Internal</option>
              <option value="VENDOR">Vendor</option>
            </select>
            <select value={filters.active} onChange={(event) => setFilters({ ...filters, active: event.target.value })}>
              <option value="">Semua status</option>
              <option value="true">Aktif</option>
              <option value="false">Nonaktif</option>
            </select>
          </div>
        </div>
        <DataTable columns={columns} rows={filtered} loading={loading} empty="Tidak ada driver sesuai filter." />
      </div>

      {modal && (
        <Modal
          title={modal.type === 'create' ? 'Tambah Driver' : `Ubah ${modal.driver.name}`}
          subtitle="Driver dapat ditautkan ke akun pengguna dengan role Driver agar bisa login dan memperbarui trip."
          onClose={() => setModal(null)}
          size="lg"
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="driver-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Simpan'}
              </button>
            </>
          }
        >
          <form id="driver-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Nama Lengkap">
                <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <Field label="Telepon">
                <input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              </Field>
              <Field label="Nomor SIM">
                <input
                  required
                  value={form.licenseNumber}
                  onChange={(event) => setForm({ ...form, licenseNumber: event.target.value })}
                />
              </Field>
              <Field label="Kategori SIM">
                <input
                  value={form.licenseCategory}
                  onChange={(event) => setForm({ ...form, licenseCategory: event.target.value })}
                  placeholder="SIM A / SIM B1"
                />
              </Field>
              <Field label="Masa Berlaku SIM">
                <input
                  required
                  type="date"
                  value={form.licenseExpiry}
                  onChange={(event) => setForm({ ...form, licenseExpiry: event.target.value })}
                />
              </Field>
              <Field label="Tipe Driver">
                <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                  <option value="INTERNAL">Internal</option>
                  <option value="VENDOR">Vendor</option>
                </select>
              </Field>
              {form.type === 'VENDOR' && (
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
              <Field label="Tautkan Akun Login (opsional)" hint="Hanya akun dengan role Driver yang dapat ditautkan.">
                <select value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })}>
                  <option value="">— Tidak ditautkan —</option>
                  {candidates.map((candidate) => {
                    const linkedToOther =
                      candidate.driverProfile && candidate.driverProfile.id !== (modal.type === 'edit' ? modal.driver.id : undefined);
                    return (
                      <option key={candidate.id} value={candidate.id} disabled={Boolean(linkedToOther)}>
                        {candidate.name} ({candidate.email}){linkedToOther ? ' — sudah tertaut' : ''}
                      </option>
                    );
                  })}
                </select>
              </Field>
              <Field label="Status">
                <div className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) => setForm({ ...form, active: event.target.checked })}
                  />
                  <span>Driver aktif</span>
                </div>
              </Field>
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, apiDelete, apiPatch, apiPost } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { Badge, DataTable, ErrorBanner, Field, Modal, PageHeader, SearchBox, useConfirm, useToast } from '../ui.jsx';

const emptyForm = () => ({ name: '', contactName: '', phone: '', email: '', address: '', active: true });

export default function Vendors() {
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

  const canWrite = can(user.role, 'vendors:write');
  const canDelete = can(user.role, 'vendors:delete');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('/vendors', { query: { pageSize: 200 } });
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

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter((vendor) => {
      if (filters.active && String(vendor.active) !== filters.active) return false;
      if (!q) return true;
      return [vendor.name, vendor.contactName, vendor.phone, vendor.email].join(' ').toLowerCase().includes(q);
    });
  }, [items, filters]);

  const openCreate = () => {
    setForm(emptyForm());
    setModal({ type: 'create' });
  };

  const openEdit = (vendor) => {
    setForm({
      name: vendor.name,
      contactName: vendor.contactName,
      phone: vendor.phone,
      email: vendor.email || '',
      address: vendor.address || '',
      active: vendor.active,
    });
    setModal({ type: 'edit', vendor });
  };

  const submit = async (event) => {
    event.preventDefault();
    const payload = {
      name: form.name.trim(),
      contactName: form.contactName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      active: Boolean(form.active),
    };
    setBusy(true);
    try {
      if (modal.type === 'create') {
        await apiPost('/vendors', payload);
        toast.success('Vendor ditambahkan.');
      } else {
        await apiPatch(`/vendors/${modal.vendor.id}`, payload);
        toast.success('Data vendor diperbarui.');
      }
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (vendor) => {
    const ok = await confirm({
      title: 'Hapus vendor?',
      message: `Vendor ${vendor.name} akan dihapus permanen.`,
      confirmLabel: 'Hapus',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiDelete(`/vendors/${vendor.id}`);
      toast.success('Vendor dihapus.');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    {
      key: 'name',
      label: 'Nama Vendor',
      render: (vendor) => (
        <div className="cell-stack">
          <b>{vendor.name}</b>
          <small>{vendor.address || '—'}</small>
        </div>
      ),
    },
    { key: 'contactName', label: 'PIC' },
    {
      key: 'contact',
      label: 'Kontak',
      render: (vendor) => (
        <div className="cell-stack">
          <b>{vendor.phone}</b>
          <small>{vendor.email || '—'}</small>
        </div>
      ),
    },
    {
      key: 'fleet',
      label: 'Armada & Driver',
      render: (vendor) => (
        <div className="cell-stack">
          <b>{vendor._count?.vehicles || 0} kendaraan</b>
          <small>{vendor._count?.drivers || 0} driver</small>
        </div>
      ),
    },
    {
      key: 'active',
      label: 'Status',
      render: (vendor) => <Badge value={vendor.active ? 'ACTIVE' : 'INACTIVE'} label={vendor.active ? 'Aktif' : 'Nonaktif'} />,
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            label: 'Aksi',
            render: (vendor) => (
              <div className="row-actions">
                <button type="button" className="icon-btn" title="Ubah" onClick={() => openEdit(vendor)}>
                  <Pencil size={15} />
                </button>
                {canDelete && (
                  <button type="button" className="icon-btn icon-bad" title="Hapus" onClick={() => remove(vendor)}>
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
        eyebrow="Mitra vendor"
        title="Manajemen Vendor"
        subtitle="Kelola mitra penyedia kendaraan dan driver beserta data kontaknya."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            {canWrite && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={15} /> Tambah Vendor
              </button>
            )}
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari nama vendor, PIC, telepon..." />
          <div className="toolbar-selects">
            <select value={filters.active} onChange={(event) => setFilters({ ...filters, active: event.target.value })}>
              <option value="">Semua status</option>
              <option value="true">Aktif</option>
              <option value="false">Nonaktif</option>
            </select>
          </div>
        </div>
        <DataTable columns={columns} rows={filtered} loading={loading} empty="Tidak ada vendor sesuai filter." />
      </div>

      {modal && (
        <Modal
          title={modal.type === 'create' ? 'Tambah Vendor' : `Ubah ${modal.vendor.name}`}
          subtitle="Vendor yang masih memiliki kendaraan/driver tidak dapat dihapus, nonaktifkan sebagai gantinya."
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="vendor-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Simpan'}
              </button>
            </>
          }
        >
          <form id="vendor-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Nama Vendor" className="span-2">
                <input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <Field label="Nama PIC">
                <input
                  required
                  minLength={2}
                  value={form.contactName}
                  onChange={(event) => setForm({ ...form, contactName: event.target.value })}
                />
              </Field>
              <Field label="Telepon">
                <input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              </Field>
              <Field label="Email">
                <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              </Field>
              <Field label="Status">
                <div className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) => setForm({ ...form, active: event.target.checked })}
                  />
                  <span>Vendor aktif</span>
                </div>
              </Field>
              <Field label="Alamat" className="span-2">
                <textarea rows={2} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
              </Field>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

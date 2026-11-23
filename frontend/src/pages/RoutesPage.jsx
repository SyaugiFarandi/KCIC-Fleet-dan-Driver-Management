import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, apiDelete, apiPatch, apiPost } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { Badge, DataTable, ErrorBanner, Field, Modal, PageHeader, SearchBox, useConfirm, useToast } from '../ui.jsx';

const emptyForm = () => ({ code: '', origin: '', destination: '', estimatedMinutes: 30, distanceKm: 10, active: true });

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

  const canWrite = can(user.role, 'routes:write');
  const canDelete = can(user.role, 'routes:delete');

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

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter((route) => {
      if (filters.active && String(route.active) !== filters.active) return false;
      if (!q) return true;
      return [route.code, route.origin, route.destination].join(' ').toLowerCase().includes(q);
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
    });
    setModal({ type: 'edit', route });
  };

  const submit = async (event) => {
    event.preventDefault();
    const payload = {
      ...(form.code.trim() ? { code: form.code.trim() } : {}),
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      estimatedMinutes: Number(form.estimatedMinutes),
      distanceKm: Number(form.distanceKm),
      active: Boolean(form.active),
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

  const columns = [
    { key: 'code', label: 'Kode', render: (route) => <b>{route.code}</b> },
    { key: 'origin', label: 'Asal' },
    { key: 'destination', label: 'Tujuan' },
    { key: 'estimatedMinutes', label: 'Estimasi', render: (route) => `${route.estimatedMinutes} menit` },
    { key: 'distanceKm', label: 'Jarak', render: (route) => `${Number(route.distanceKm).toLocaleString('id-ID')} km` },
    {
      key: 'active',
      label: 'Status',
      render: (route) => <Badge value={route.active ? 'ACTIVE' : 'INACTIVE'} label={route.active ? 'Aktif' : 'Nonaktif'} />,
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            label: 'Aksi',
            render: (route) => (
              <div className="row-actions">
                <button type="button" className="icon-btn" title="Ubah" onClick={() => openEdit(route)}>
                  <Pencil size={15} />
                </button>
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
        eyebrow="TRANSPORT MASTER DATA"
        title="Master Rute"
        subtitle="Rute perjalanan yang dapat dipilih saat membuat permintaan transportasi."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            {canWrite && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={15} /> Tambah Rute
              </button>
            )}
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari kode, asal, tujuan..." />
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
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

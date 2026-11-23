import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Pencil, Play, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { api, apiDelete, apiPatch, apiPost } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { fmtDateTime, fmtMoney, toDateTimeLocal } from '../format.js';
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

const emptyForm = () => ({ vehicleId: '', title: '', description: '', scheduledAt: '', cost: 0 });

export default function Maintenance() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [completeCost, setCompleteCost] = useState(0);
  const [busy, setBusy] = useState(false);

  const canWrite = can(user.role, 'maintenance:write');
  const canDelete = can(user.role, 'maintenance:delete');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, vehicleList] = await Promise.all([
        api('/maintenance', { query: { pageSize: 200 } }),
        api('/vehicles', { query: { pageSize: 200 } }),
      ]);
      setItems(list.items || []);
      setVehicles((vehicleList.items || []).filter((vehicle) => vehicle.status !== 'INACTIVE'));
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
    return items.filter((item) => {
      if (filters.status && item.status !== filters.status) return false;
      if (!q) return true;
      return [item.vehicle?.plateNumber, item.title, item.description].join(' ').toLowerCase().includes(q);
    });
  }, [items, filters]);

  const openCreate = () => {
    setForm(emptyForm());
    setModal({ type: 'create' });
  };

  const openEdit = (item) => {
    setForm({
      vehicleId: item.vehicleId,
      title: item.title,
      description: item.description || '',
      scheduledAt: toDateTimeLocal(item.scheduledAt),
      cost: item.cost || 0,
    });
    setModal({ type: 'edit', item });
  };

  const submit = async (event) => {
    event.preventDefault();
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      scheduledAt: new Date(form.scheduledAt).toISOString(),
      cost: Number(form.cost || 0),
      ...(modal.type === 'create' ? { vehicleId: form.vehicleId } : {}),
    };
    setBusy(true);
    try {
      if (modal.type === 'create') {
        await apiPost('/maintenance', payload);
        toast.success('Jadwal maintenance dibuat.');
      } else {
        await apiPatch(`/maintenance/${modal.item.id}`, payload);
        toast.success('Maintenance diperbarui.');
      }
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const start = async (item) => {
    const ok = await confirm({
      title: 'Mulai maintenance?',
      message: `Kendaraan ${item.vehicle?.plateNumber} akan berstatus MAINTENANCE dan tidak dapat ditugaskan.`,
      confirmLabel: 'Mulai',
    });
    if (!ok) return;
    try {
      await apiPatch(`/maintenance/${item.id}/start`);
      toast.success('Maintenance dimulai.');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const cancel = async (item) => {
    const ok = await confirm({
      title: 'Batalkan maintenance?',
      message: `Maintenance "${item.title}" akan dibatalkan.`,
      confirmLabel: 'Batalkan',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiPatch(`/maintenance/${item.id}/cancel`);
      toast.success('Maintenance dibatalkan.');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const complete = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiPatch(`/maintenance/${modal.item.id}/complete`, { cost: Number(completeCost || 0) });
      toast.success('Maintenance selesai dan kendaraan kembali tersedia.');
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item) => {
    const ok = await confirm({
      title: 'Hapus maintenance?',
      message: `Catatan maintenance "${item.title}" akan dihapus permanen.`,
      confirmLabel: 'Hapus',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiDelete(`/maintenance/${item.id}`);
      toast.success('Maintenance dihapus.');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    {
      key: 'vehicle',
      label: 'Kendaraan',
      render: (item) => (
        <div className="cell-stack">
          <b>{item.vehicle?.plateNumber || '—'}</b>
          <small>
            {item.vehicle?.brand} {item.vehicle?.model}
          </small>
        </div>
      ),
    },
    {
      key: 'title',
      label: 'Pekerjaan',
      render: (item) => (
        <div className="cell-stack">
          <b>{item.title}</b>
          <small>{item.description || '—'}</small>
        </div>
      ),
    },
    { key: 'scheduledAt', label: 'Jadwal', render: (item) => fmtDateTime(item.scheduledAt) },
    { key: 'cost', label: 'Biaya', render: (item) => fmtMoney(item.cost) },
    { key: 'createdBy', label: 'Dibuat Oleh', render: (item) => item.createdBy?.name || '—' },
    { key: 'status', label: 'Status', render: (item) => <Badge value={item.status} /> },
    ...(canWrite
      ? [
          {
            key: 'actions',
            label: 'Aksi',
            render: (item) => (
              <div className="row-actions">
                {item.status === 'PLANNED' && (
                  <>
                    <button type="button" className="icon-btn" title="Ubah" onClick={() => openEdit(item)}>
                      <Pencil size={15} />
                    </button>
                    <button type="button" className="icon-btn icon-blue" title="Mulai maintenance" onClick={() => start(item)}>
                      <Play size={15} />
                    </button>
                  </>
                )}
                {item.status === 'IN_PROGRESS' && (
                  <button
                    type="button"
                    className="icon-btn icon-good"
                    title="Selesaikan"
                    onClick={() => {
                      setCompleteCost(item.cost || 0);
                      setModal({ type: 'complete', item });
                    }}
                  >
                    <CheckCircle2 size={15} />
                  </button>
                )}
                {['PLANNED', 'IN_PROGRESS'].includes(item.status) && (
                  <button type="button" className="icon-btn icon-bad" title="Batalkan" onClick={() => cancel(item)}>
                    <XCircle size={15} />
                  </button>
                )}
                {canDelete && ['PLANNED', 'CANCELLED'].includes(item.status) && (
                  <button type="button" className="icon-btn icon-bad" title="Hapus" onClick={() => remove(item)}>
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
        eyebrow="VEHICLE CARE"
        title="Perawatan Kendaraan"
        subtitle="Jadwalkan, jalankan, dan selesaikan maintenance armada. Kendaraan dalam perawatan tidak dapat ditugaskan."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            {canWrite && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={15} /> Jadwalkan Maintenance
              </button>
            )}
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari kendaraan atau pekerjaan..." />
          <div className="toolbar-selects">
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">Semua status</option>
              <option value="PLANNED">Direncanakan</option>
              <option value="IN_PROGRESS">Berlangsung</option>
              <option value="COMPLETED">Selesai</option>
              <option value="CANCELLED">Dibatalkan</option>
            </select>
          </div>
        </div>
        <DataTable columns={columns} rows={filtered} loading={loading} empty="Tidak ada data maintenance sesuai filter." />
      </div>

      {(modal?.type === 'create' || modal?.type === 'edit') && (
        <Modal
          title={modal.type === 'create' ? 'Jadwalkan Maintenance' : 'Ubah Maintenance'}
          subtitle={modal.type === 'create' ? 'Maintenance baru berstatus PLANNED.' : 'Hanya maintenance PLANNED yang dapat diubah.'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="maintenance-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Simpan'}
              </button>
            </>
          }
        >
          <form id="maintenance-form" onSubmit={submit}>
            <div className="form-grid">
              {modal.type === 'create' && (
                <Field label="Kendaraan" className="span-2">
                  <select required value={form.vehicleId} onChange={(event) => setForm({ ...form, vehicleId: event.target.value })}>
                    <option value="">— Pilih kendaraan —</option>
                    {vehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.plateNumber} · {vehicle.brand} {vehicle.model} ({vehicle.status})
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Jenis Perawatan" className="span-2">
                <input
                  required
                  minLength={3}
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  placeholder="Contoh: Servis berkala 10.000 km"
                />
              </Field>
              <Field label="Jadwal">
                <input
                  required
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })}
                />
              </Field>
              <Field label="Estimasi Biaya (Rp)">
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={form.cost}
                  onChange={(event) => setForm({ ...form, cost: event.target.value })}
                />
              </Field>
              <Field label="Deskripsi" className="span-2">
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="Detail pekerjaan atau catatan workshop..."
                />
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {modal?.type === 'complete' && (
        <Modal
          title="Selesaikan Maintenance"
          subtitle={`${modal.item.vehicle?.plateNumber} · ${modal.item.title}`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="complete-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Tandai Selesai'}
              </button>
            </>
          }
        >
          <form id="complete-form" onSubmit={complete}>
            <Field label="Biaya akhir (Rp)" hint="Kendaraan akan kembali tersedia setelah maintenance selesai.">
              <input
                type="number"
                min="0"
                step="1000"
                value={completeCost}
                onChange={(event) => setCompleteCost(event.target.value)}
              />
            </Field>
          </form>
        </Modal>
      )}
    </>
  );
}

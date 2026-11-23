import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Gauge, Pencil, Play, Plus, RefreshCw, Trash2, Wrench, XCircle } from 'lucide-react';
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
  StatCard,
  useConfirm,
  useToast,
} from '../ui.jsx';

const KIND_LABELS = { PREVENTIVE: 'Preventif', CORRECTIVE: 'Korektif', INSPECTION: 'Inspeksi' };
const PRIORITY_LABELS = { LOW: 'Rendah', NORMAL: 'Normal', HIGH: 'Tinggi', URGENT: 'Mendesak' };
const PRIORITY_TONES = { LOW: 'gray', NORMAL: 'blue', HIGH: 'amber', URGENT: 'red' };
const PREDICTION_LABELS = { OVERDUE: 'Jatuh tempo', DUE_SOON: 'Segera', OK: 'Aman', UNKNOWN: 'Belum diketahui' };
const PREDICTION_TONES = { OVERDUE: 'red', DUE_SOON: 'amber', OK: 'green', UNKNOWN: 'gray' };
const CONFIDENCE_LABELS = { HIGH: 'Data kuat', MEDIUM: 'Data sedang', LOW: 'Data terbatas' };

const emptyForm = () => ({
  vehicleId: '',
  title: '',
  description: '',
  scheduledAt: '',
  cost: 0,
  kind: 'PREVENTIVE',
  priority: 'NORMAL',
  defectId: '',
});


export default function Maintenance() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [predictions, setPredictions] = useState(null);
  const [defects, setDefects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', status: '', kind: '' });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [completeCost, setCompleteCost] = useState(0);
  const [busy, setBusy] = useState(false);

  const canWrite = can(user.role, 'maintenance:write');
  const canDelete = can(user.role, 'maintenance:delete');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, vehicleList, predictionData, defectList] = await Promise.all([
        api('/maintenance', { query: { pageSize: 200 } }),
        api('/vehicles', { query: { pageSize: 200 } }),
        api('/maintenance/predictions'),
        api('/defects', { query: { pageSize: 200 } }),
      ]);
      setItems(list.items || []);
      setVehicles((vehicleList.items || []).filter((vehicle) => vehicle.status !== 'INACTIVE'));
      setPredictions(predictionData);
      setDefects(defectList.items || []);
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
      if (filters.kind && item.kind !== filters.kind) return false;
      if (!q) return true;
      return [item.vehicle?.plateNumber, item.title, item.description].join(' ').toLowerCase().includes(q);
    });
  }, [items, filters]);

  const duePredictions = useMemo(
    () => (predictions?.items || []).filter((item) => ['OVERDUE', 'DUE_SOON'].includes(item.status)),
    [predictions]
  );

  const vehicleDefects = useMemo(
    () => defects.filter((defect) => defect.status !== 'RESOLVED' && !defect.maintenanceId && defect.vehicleId === form.vehicleId),
    [defects, form.vehicleId]
  );

  const openCreate = () => {
    setForm(emptyForm());
    setModal({ type: 'create' });
  };

  const openFromPrediction = (prediction) => {
    const scheduled = new Date(Date.now() + 7 * 86400000);
    scheduled.setHours(9, 0, 0, 0);
    setForm({
      ...emptyForm(),
      vehicleId: prediction.vehicleId,
      title: `Servis berkala ${prediction.plateNumber}`,
      description: prediction.reasons.join(' '),
      scheduledAt: toDateTimeLocal(scheduled),
      kind: 'PREVENTIVE',
      priority: prediction.priority,
    });
    setModal({ type: 'create' });
  };

  const openEdit = (item) => {
    setForm({
      vehicleId: item.vehicleId,
      title: item.title,
      description: item.description || '',
      scheduledAt: toDateTimeLocal(item.scheduledAt),
      cost: item.cost || 0,
      kind: item.kind || 'PREVENTIVE',
      priority: item.priority || 'NORMAL',
      defectId: '',
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
      kind: form.kind,
      priority: form.priority,
      ...(modal.type === 'create' ? { vehicleId: form.vehicleId, defectId: form.defectId || null } : {}),
    };
    setBusy(true);
    try {
      if (modal.type === 'create') {
        await apiPost('/maintenance', payload);
        toast.success(form.defectId ? 'Work order dibuat dan defect ditautkan.' : 'Work order dibuat.');
      } else {
        await apiPatch(`/maintenance/${modal.item.id}`, payload);
        toast.success('Work order diperbarui.');
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
      toast.success(
        modal.item.defects?.length
          ? 'Maintenance selesai, kendaraan tersedia, dan defect tertaut ditandai selesai.'
          : 'Maintenance selesai dan kendaraan kembali tersedia.'
      );
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
          <small>
            {KIND_LABELS[item.kind] || item.kind}
            {item.defects?.length ? ` · ${item.defects.length} defect tertaut` : ''}
          </small>
        </div>
      ),
    },
    {
      key: 'priority',
      label: 'Prioritas',
      render: (item) => <Badge value={PRIORITY_LABELS[item.priority] || item.priority} tone={PRIORITY_TONES[item.priority]} />,
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
        eyebrow="Perawatan kendaraan"
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

      <div className="stats-grid">
        <StatCard
          label="Prediksi Perlu Servis"
          value={predictions ? predictions.summary.overdue + predictions.summary.dueSoon : '—'}
          hint={predictions ? `${predictions.summary.overdue} jatuh tempo, ${predictions.summary.dueSoon} segera` : 'Memuat prediksi...'}
          icon={Gauge}
        />
        <StatCard label="Jatuh Tempo" value={predictions?.summary.overdue ?? '—'} hint="Melewati interval waktu/km" icon={AlertTriangle} />
        <StatCard label="Segera Servis" value={predictions?.summary.dueSoon ?? '—'} hint="≤ 1.000 km atau ≤ 14 hari" icon={Gauge} />
        <StatCard label="Tanpa Work Order" value={predictions?.summary.withoutWorkOrder ?? '—'} hint="Perlu dijadwalkan" icon={Wrench} />
      </div>

      {duePredictions.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Rekomendasi Perawatan</h2>
              <p>Estimasi rule-based dari interval servis dan odometer bahan bakar. Keputusan penjadwalan tetap di tangan tim.</p>
            </div>
          </div>
          <div className="insight-grid">
            {duePredictions.slice(0, 6).map((prediction) => (
              <div className="insight-card" key={prediction.vehicleId}>
                <div className="prediction-head">
                  <b>{prediction.plateNumber}</b>
                  <Badge value={PREDICTION_LABELS[prediction.status]} tone={PREDICTION_TONES[prediction.status]} />
                </div>
                <p>{prediction.reasons[0]}</p>
                <div className="badge-row">
                  <Badge value={CONFIDENCE_LABELS[prediction.confidence]} tone={prediction.confidence === 'LOW' ? 'amber' : 'gray'} />
                  {prediction.remainingKm != null && <Badge value={`Sisa ${prediction.remainingKm.toLocaleString('id-ID')} km`} tone={prediction.remainingKm <= 0 ? 'red' : 'amber'} />}
                  {prediction.remainingDays != null && <Badge value={`${prediction.remainingDays} hari`} tone={prediction.remainingDays <= 0 ? 'red' : 'amber'} />}
                </div>
                <div className="prediction-foot">
                  {prediction.plannedWorkOrder ? (
                    <small className="muted-text">Sudah dijadwalkan: {prediction.plannedWorkOrder.title}</small>
                  ) : prediction.hasOpenWorkOrder ? (
                    <small className="muted-text">Work order sedang berjalan.</small>
                  ) : canWrite ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openFromPrediction(prediction)}>
                      <Plus size={13} /> Buat Work Order
                    </button>
                  ) : (
                    <small className="muted-text">Belum ada work order.</small>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="muted-text prediction-note">
            Metode: {predictions?.rules?.[1]} Kualitas data: {predictions?.rules?.[3]}
          </p>
        </section>
      )}

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari kendaraan atau pekerjaan..." />
          <div className="toolbar-selects">
            <select value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}>
              <option value="">Semua jenis</option>
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
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
                  <select required value={form.vehicleId} onChange={(event) => setForm({ ...form, vehicleId: event.target.value, defectId: '' })}>
                    <option value="">— Pilih kendaraan —</option>
                    {vehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.plateNumber} · {vehicle.brand} {vehicle.model} ({vehicle.status})
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {modal.type === 'create' && form.vehicleId && vehicleDefects.length > 0 && (
                <Field label="Defect terkait (opsional)" className="span-2" hint="Defect akan ditandai diperbaiki dan otomatis selesai saat work order selesai.">
                  <select value={form.defectId} onChange={(event) => setForm({ ...form, defectId: event.target.value })}>
                    <option value="">— Tanpa defect —</option>
                    {vehicleDefects.map((defect) => (
                      <option key={defect.id} value={defect.id}>
                        {defect.title} ({defect.severity}/{defect.status})
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
              <Field label="Kategori">
                <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
                  {Object.entries(KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Prioritas">
                <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
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
            <Field
              label="Biaya akhir (Rp)"
              hint={
                modal.item.defects?.length
                  ? 'Defect tertaut akan ditandai selesai otomatis dan kendaraan kembali tersedia.'
                  : 'Kendaraan akan kembali tersedia setelah maintenance selesai.'
              }
            >
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

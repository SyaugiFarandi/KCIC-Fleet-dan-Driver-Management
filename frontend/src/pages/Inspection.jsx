import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FilePlus2,
  Plus,
  RefreshCw,
  Trash2,
  Wrench,
} from 'lucide-react';
import { api, apiDelete, apiPatch, apiPost } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { fmtDateTime } from '../format.js';
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

const TYPE_LABELS = { PRE_TRIP: 'Pra-Trip', POST_TRIP: 'Pasca-Trip', RELEASE: 'Release' };
const STATUS_LABELS = { DRAFT: 'Draft', PASSED: 'Lulus', DEFECTS: 'Ada Temuan', FAILED: 'Gagal Kritis' };
const STATUS_TONES = { DRAFT: 'amber', PASSED: 'green', DEFECTS: 'blue', FAILED: 'red' };
const SEVERITY_LABELS = { LOW: 'Rendah', MEDIUM: 'Sedang', HIGH: 'Tinggi', CRITICAL: 'Kritis' };
const SEVERITY_TONES = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'amber', CRITICAL: 'red' };
const DEFECT_STATUS_LABELS = { OPEN: 'Terbuka', IN_REPAIR: 'Diperbaiki', RESOLVED: 'Selesai' };
const DEFECT_STATUS_TONES = { OPEN: 'red', IN_REPAIR: 'amber', RESOLVED: 'green' };

const emptyCreate = () => ({
  vehicleId: '',
  driverId: '',
  tripId: '',
  templateId: '',
  type: 'PRE_TRIP',
  odometerKm: '',
  notes: '',
});

export default function Inspection() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [inspections, setInspections] = useState([]);
  const [summary, setSummary] = useState(null);
  const [defects, setDefects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', status: '', type: '' });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyCreate());
  const [detail, setDetail] = useState(null);
  const [detailItems, setDetailItems] = useState([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: '', category: 'PRE_TRIP', items: '' });
  const [resolveForm, setResolveForm] = useState({ id: null, note: '' });
  const [busy, setBusy] = useState(false);

  const canWrite = can(user.role, 'inspection:write');
  const canTemplate = can(user.role, 'inspection:template');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, summaryData, defectList, templateList, vehicleList, driverList, tripList] = await Promise.all([
        api('/inspections', { query: { pageSize: 200 } }),
        api('/inspections/summary'),
        api('/defects', { query: { pageSize: 200 } }),
        api('/inspections/templates', { query: { includeInactive: true } }),
        api('/vehicles', { query: { pageSize: 200 } }),
        api('/drivers', { query: { pageSize: 200 } }),
        api('/trips', { query: { pageSize: 200 } }),
      ]);
      setInspections(list.items || []);
      setSummary(summaryData);
      setDefects(defectList.items || []);
      setTemplates(templateList.items || []);
      setVehicles((vehicleList.items || []).filter((vehicle) => vehicle.status !== 'INACTIVE'));
      setDrivers(driverList.items || []);
      setTrips((tripList.items || []).filter((trip) => ['SCHEDULED', 'DRIVER_ACCEPTED', 'PICKED_UP', 'IN_PROGRESS'].includes(trip.status)));
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
    return inspections.filter((item) => {
      if (filters.status && item.status !== filters.status) return false;
      if (filters.type && item.type !== filters.type) return false;
      if (!q) return true;
      return [item.vehicle?.plateNumber, item.driver?.name, item.template?.name, item.trip?.booking?.code]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [inspections, filters]);

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === form.vehicleId);

  const openCreate = () => {
    setForm(emptyCreate());
    setModal({ type: 'create' });
  };

  const submitCreate = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await apiPost('/inspections', {
        vehicleId: form.vehicleId,
        driverId: form.driverId || null,
        tripId: form.tripId || null,
        templateId: form.templateId || null,
        type: form.type,
        odometerKm: form.odometerKm === '' ? null : Number(form.odometerKm),
        notes: form.notes.trim() || null,
      });
      toast.success('Inspeksi dibuat sebagai draft. Lengkapi checklist lalu selesaikan.');
      setModal(null);
      await load();
      await openDetail(created.id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (id) => {
    try {
      const data = await api(`/inspections/${id}`);
      setDetail(data);
      setDetailItems(data.items.map((item) => ({ key: item.key, label: item.label, critical: item.critical, checked: item.checked, note: item.note || '' })));
      setModal({ type: 'detail' });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleItem = (key, checked) => {
    setDetailItems((items) => items.map((item) => (item.key === key ? { ...item, checked } : item)));
  };

  const setItemNote = (key, note) => {
    setDetailItems((items) => items.map((item) => (item.key === key ? { ...item, note } : item)));
  };

  const saveProgress = async () => {
    if (!detail) return;
    setDetailBusy(true);
    try {
      const updated = await apiPatch(`/inspections/${detail.id}/items`, {
        items: detailItems.map((item) => ({ key: item.key, checked: item.checked, note: item.note.trim() || null })),
      });
      setDetail(updated);
      toast.success('Progres inspeksi disimpan.');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDetailBusy(false);
    }
  };

  const completeInspection = async () => {
    if (!detail) return;
    const unchecked = detailItems.filter((item) => !item.checked);
    const ok = await confirm({
      title: 'Selesaikan inspeksi?',
      message: unchecked.length
        ? `${unchecked.length} item belum dicentang dan akan otomatis dicatat sebagai defect. Item kritis yang gagal memblokir penugasan kendaraan.`
        : 'Semua item lulus. Inspeksi akan ditandai PASSED.',
      confirmLabel: 'Selesaikan',
      tone: unchecked.some((item) => item.critical) ? 'danger' : 'default',
    });
    if (!ok) return;
    setDetailBusy(true);
    try {
      await apiPatch(`/inspections/${detail.id}/items`, {
        items: detailItems.map((item) => ({ key: item.key, checked: item.checked, note: item.note.trim() || null })),
      });
      const completed = await apiPatch(`/inspections/${detail.id}/complete`, {
        odometerKm: detail.odometerKm ?? undefined,
        notes: detail.notes || undefined,
      });
      toast.success(
        completed.status === 'PASSED'
          ? 'Inspeksi lulus.'
          : `Inspeksi selesai dengan status ${STATUS_LABELS[completed.status]}. Defect dibuat otomatis.`
      );
      setDetail(completed);
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDetailBusy(false);
    }
  };

  const discardDraft = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: 'Hapus draft inspeksi?',
      message: 'Draft beserta item checklist akan dihapus permanen.',
      confirmLabel: 'Hapus',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiDelete(`/inspections/${detail.id}`);
      toast.success('Draft inspeksi dihapus.');
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const updateDefect = async (defect, status, note) => {
    try {
      await apiPatch(`/defects/${defect.id}`, { status, resolutionNote: note || undefined });
      toast.success(`Defect "${defect.title}" diperbarui.`);
      setResolveForm({ id: null, note: '' });
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submitResolve = async (event) => {
    event.preventDefault();
    const defect = defects.find((item) => item.id === resolveForm.id);
    if (!defect) return;
    if (resolveForm.note.trim().length < 3) {
      toast.error('Catatan penyelesaian minimal 3 karakter.');
      return;
    }
    await updateDefect(defect, 'RESOLVED', resolveForm.note.trim());
  };

  const submitTemplate = async (event) => {
    event.preventDefault();
    const lines = templateForm.items
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const items = lines.map((line, index) => {
      const [label, flag] = line.split('|').map((part) => part.trim());
      return {
        key: `item_${index + 1}`,
        label,
        critical: /^(critical|kritis|ya|true)$/i.test(flag || ''),
      };
    });
    if (!items.length) {
      toast.error('Minimal 1 item template.');
      return;
    }
    setBusy(true);
    try {
      await apiPost('/inspections/templates', {
        name: templateForm.name.trim(),
        category: templateForm.category,
        items,
      });
      toast.success('Template inspeksi dibuat.');
      setModal(null);
      setTemplateForm({ name: '', category: 'PRE_TRIP', items: '' });
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const inspectionColumns = [
    {
      key: 'createdAt',
      label: 'Waktu',
      render: (item) => (
        <div className="cell-stack">
          <b>{fmtDateTime(item.createdAt)}</b>
          <small>{item.trip?.booking?.code || 'Tanpa trip'}</small>
        </div>
      ),
    },
    {
      key: 'vehicle',
      label: 'Kendaraan',
      render: (item) => (
        <div className="cell-stack">
          <b>{item.vehicle?.plateNumber || '—'}</b>
          <small>{item.driver?.name || 'Tanpa driver'}</small>
        </div>
      ),
    },
    { key: 'type', label: 'Tipe', render: (item) => TYPE_LABELS[item.type] || item.type },
    { key: 'template', label: 'Template', render: (item) => item.template?.name || '—' },
    { key: 'items', label: 'Checklist', render: (item) => `${item._count?.items || 0} item` },
    { key: 'defects', label: 'Temuan', render: (item) => item._count?.defects || 0 },
    {
      key: 'status',
      label: 'Status',
      render: (item) => <Badge value={STATUS_LABELS[item.status] || item.status} tone={STATUS_TONES[item.status]} />,
    },
    {
      key: 'actions',
      label: 'Aksi',
      render: (item) => (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDetail(item.id)}>
          {item.status === 'DRAFT' ? 'Lanjutkan' : 'Detail'}
        </button>
      ),
    },
  ];

  const defectColumns = [
    {
      key: 'title',
      label: 'Defect',
      render: (item) => (
        <div className="cell-stack">
          <b>{item.title}</b>
          <small>{item.description || '—'}</small>
        </div>
      ),
    },
    { key: 'vehicle', label: 'Kendaraan', render: (item) => item.vehicle?.plateNumber || '—' },
    {
      key: 'severity',
      label: 'Severity',
      render: (item) => <Badge value={SEVERITY_LABELS[item.severity] || item.severity} tone={SEVERITY_TONES[item.severity]} />,
    },
    {
      key: 'status',
      label: 'Status',
      render: (item) => <Badge value={DEFECT_STATUS_LABELS[item.status] || item.status} tone={DEFECT_STATUS_TONES[item.status]} />,
    },
    { key: 'reportedAt', label: 'Dilaporkan', render: (item) => fmtDateTime(item.reportedAt) },
    {
      key: 'maintenance',
      label: 'Work Order',
      render: (item) => (item.maintenance ? <Badge value={item.maintenance.title} tone="blue" /> : <span className="muted-text">—</span>),
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            label: 'Aksi',
            render: (item) => (
              <div className="row-actions">
                {item.status === 'OPEN' && (
                  <button type="button" className="icon-btn icon-blue" title="Mulai perbaikan" onClick={() => updateDefect(item, 'IN_REPAIR')}>
                    <Wrench size={15} />
                  </button>
                )}
                {item.status !== 'RESOLVED' && (
                  <button
                    type="button"
                    className="icon-btn icon-good"
                    title="Selesaikan defect"
                    onClick={() => setResolveForm({ id: item.id, note: '' })}
                  >
                    <CheckCircle2 size={15} />
                  </button>
                )}
                {item.status === 'RESOLVED' && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => updateDefect(item, 'OPEN')}>
                    Buka ulang
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
        eyebrow="Keselamatan & kelayakan"
        title="Inspeksi Kendaraan"
        subtitle="Inspeksi pra-trip, pasca-trip, dan release. Defect kritis terbuka memblokir kendaraan dari penugasan."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            {canTemplate && (
              <button type="button" className="btn btn-secondary" onClick={() => setModal({ type: 'template' })}>
                <FilePlus2 size={15} /> Template
              </button>
            )}
            {canWrite && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={15} /> Mulai Inspeksi
              </button>
            )}
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="stats-grid">
        <StatCard label="Inspeksi (30 hari)" value={summary?.totals.inspections || 0} hint={`${summary?.totals.completed || 0} selesai`} icon={ClipboardCheck} />
        <StatCard label="Pass Rate" value={summary?.totals.passRate != null ? `${summary.totals.passRate}%` : '—'} hint="Dari inspeksi selesai" icon={CheckCircle2} />
        <StatCard label="Draft" value={summary?.totals.drafts || 0} hint="Belum diselesaikan" icon={ClipboardCheck} />
        <StatCard label="Defect Terbuka" value={summary?.totals.openDefects || 0} hint={`${summary?.totals.criticalOpen || 0} kritis`} icon={AlertTriangle} />
      </div>

      {summary?.totals.criticalOpen > 0 && (
        <div className="callout callout-warn" role="status">
          <AlertTriangle size={18} />
          <div>
            <b>{summary.totals.criticalOpen} defect kritis belum selesai.</b>
            <p>Kendaraan terkait otomatis diblokir dari dispatch sampai defect ditutup.</p>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari kendaraan, driver, atau template..." />
          <div className="toolbar-selects">
            <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
              <option value="">Semua tipe</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">Semua status</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DataTable columns={inspectionColumns} rows={filtered} loading={loading} empty="Belum ada inspeksi." pageSize={12} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Defect & Perbaikan</h2>
            <p>Semua temuan inspeksi dan laporan manual. Defect kritis memblokir penugasan.</p>
          </div>
        </div>
        <DataTable columns={defectColumns} rows={defects} loading={loading} empty="Tidak ada defect." pageSize={10} />
      </section>

      {modal?.type === 'create' && (
        <Modal
          title="Mulai Inspeksi"
          subtitle="Draft inspeksi akan dibuat dengan checklist template terpilih."
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="inspection-create" className="btn btn-primary" disabled={busy}>
                {busy ? 'Membuat...' : 'Buat Draft'}
              </button>
            </>
          }
        >
          <form id="inspection-create" onSubmit={submitCreate}>
            <div className="form-grid">
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
              <Field label="Tipe Inspeksi">
                <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Template">
                <select value={form.templateId} onChange={(event) => setForm({ ...form, templateId: event.target.value })}>
                  <option value="">Otomatis sesuai tipe</option>
                  {templates
                    .filter((template) => template.active)
                    .map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({template.category})
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Driver (opsional)">
                <select value={form.driverId} onChange={(event) => setForm({ ...form, driverId: event.target.value })}>
                  <option value="">— Tanpa driver —</option>
                  {drivers.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Trip terkait (opsional)">
                <select value={form.tripId} onChange={(event) => setForm({ ...form, tripId: event.target.value })}>
                  <option value="">— Tanpa trip —</option>
                  {trips.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.booking?.code || trip.id} · {trip.vehicle?.plateNumber || ''} ({trip.status})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Odometer (km)">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.odometerKm}
                  placeholder={selectedVehicle?.odometerKm != null ? String(selectedVehicle.odometerKm) : 'Opsional'}
                  onChange={(event) => setForm({ ...form, odometerKm: event.target.value })}
                />
              </Field>
              <Field label="Catatan">
                <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Opsional" />
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {modal?.type === 'detail' && detail && (
        <Modal
          size="lg"
          title={`Inspeksi ${TYPE_LABELS[detail.type] || detail.type} · ${detail.vehicle?.plateNumber || ''}`}
          subtitle={`${detail.template?.name || 'Tanpa template'} · ${detail.driver?.name || 'Tanpa driver'} · ${fmtDateTime(detail.createdAt)}`}
          onClose={() => setModal(null)}
          footer={
            <>
              {detail.status === 'DRAFT' && (
                <button type="button" className="btn btn-danger btn-sm" onClick={discardDraft}>
                  <Trash2 size={14} /> Hapus Draft
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Tutup
              </button>
              {detail.status === 'DRAFT' && canWrite && (
                <>
                  <button type="button" className="btn btn-secondary" onClick={saveProgress} disabled={detailBusy}>
                    Simpan Progres
                  </button>
                  <button type="button" className="btn btn-primary" onClick={completeInspection} disabled={detailBusy}>
                    {detailBusy ? 'Memproses...' : 'Selesaikan Inspeksi'}
                  </button>
                </>
              )}
            </>
          }
        >
          <div className="callout">
            <Badge value={STATUS_LABELS[detail.status] || detail.status} tone={STATUS_TONES[detail.status]} />
            <div>
              <p>
                {detail.status === 'DRAFT'
                  ? 'Centang item yang lulus. Item yang tidak dicentang otomatis menjadi defect saat inspeksi diselesaikan.'
                  : `Diselesaikan ${fmtDateTime(detail.completedAt)} oleh ${detail.completedBy?.name || '—'}.`}
              </p>
            </div>
          </div>

          <div className="inspection-items">
            {detailItems.map((item) => (
              <div className={`inspection-item ${item.checked ? 'is-checked' : ''}`} key={item.key}>
                <label className="inspection-check">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    disabled={detail.status !== 'DRAFT'}
                    onChange={(event) => toggleItem(item.key, event.target.checked)}
                  />
                  <span>{item.label}</span>
                </label>
                {item.critical && <Badge value="Kritis" tone="red" />}
                {detail.status === 'DRAFT' ? (
                  <input
                    className="inspection-note"
                    placeholder="Catatan temuan (opsional)"
                    value={item.note}
                    onChange={(event) => setItemNote(item.key, event.target.value)}
                  />
                ) : (
                  item.note && <small className="muted-text">{item.note}</small>
                )}
              </div>
            ))}
          </div>

          {detail.defects?.length > 0 && (
            <>
              <h3 className="section-title">Defect dari inspeksi ini</h3>
              <div className="insight-grid">
                {detail.defects.map((defect) => (
                  <div className="insight-card" key={defect.id}>
                    <b>{defect.title}</b>
                    <p>{defect.description || '—'}</p>
                    <div className="badge-row">
                      <Badge value={SEVERITY_LABELS[defect.severity]} tone={SEVERITY_TONES[defect.severity]} />
                      <Badge value={DEFECT_STATUS_LABELS[defect.status]} tone={DEFECT_STATUS_TONES[defect.status]} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Modal>
      )}

      {modal?.type === 'template' && (
        <Modal
          title="Template Inspeksi"
          subtitle="Template aktif dipakai saat membuat inspeksi baru."
          onClose={() => setModal(null)}
          size="lg"
          footer={
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
              Tutup
            </button>
          }
        >
          <div className="insight-grid">
            {templates.map((template) => (
              <div className="insight-card" key={template.id}>
                <b>{template.name}</b>
                <p>
                  {template.category} · {(template.items || []).length} item · {template.active ? 'Aktif' : 'Nonaktif'}
                </p>
              </div>
            ))}
          </div>
          {canTemplate && (
            <form onSubmit={submitTemplate} className="template-form">
              <h3 className="section-title">Template Baru</h3>
              <div className="form-grid">
                <Field label="Nama template">
                  <input required minLength={3} value={templateForm.name} onChange={(event) => setTemplateForm({ ...templateForm, name: event.target.value })} />
                </Field>
                <Field label="Kategori">
                  <select value={templateForm.category} onChange={(event) => setTemplateForm({ ...templateForm, category: event.target.value })}>
                    <option value="PRE_TRIP">Pra-Trip</option>
                    <option value="POST_TRIP">Pasca-Trip</option>
                    <option value="RELEASE">Release</option>
                    <option value="GENERAL">Umum</option>
                  </select>
                </Field>
                <Field label="Item checklist" className="span-2" hint="Satu item per baris. Tambahkan |kritis di akhir untuk item kritis.">
                  <textarea
                    rows={5}
                    required
                    value={templateForm.items}
                    onChange={(event) => setTemplateForm({ ...templateForm, items: event.target.value })}
                    placeholder={'Kondisi ban|kritis\nLampu rem|kritis\nKebersihan kabin'}
                  />
                </Field>
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                Simpan Template
              </button>
            </form>
          )}
        </Modal>
      )}

      {resolveForm.id && (
        <Modal
          title="Selesaikan Defect"
          subtitle="Catatan penyelesaian wajib diisi dan akan diaudit."
          onClose={() => setResolveForm({ id: null, note: '' })}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setResolveForm({ id: null, note: '' })}>
                Batal
              </button>
              <button type="submit" form="resolve-defect" className="btn btn-primary">
                Tandai Selesai
              </button>
            </>
          }
        >
          <form id="resolve-defect" onSubmit={submitResolve}>
            <Field label="Catatan penyelesaian">
              <textarea
                rows={3}
                required
                minLength={3}
                value={resolveForm.note}
                onChange={(event) => setResolveForm({ ...resolveForm, note: event.target.value })}
                placeholder="Contoh: Kampas rem diganti, uji jalan 5 km aman."
              />
            </Field>
          </form>
        </Modal>
      )}
    </>
  );
}

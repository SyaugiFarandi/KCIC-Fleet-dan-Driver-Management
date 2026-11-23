import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, Handshake, Pencil, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, apiPatch, apiPost } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { fmtDate, fmtMoney, toDateInput } from '../format.js';
import {
  Badge,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  SearchBox,
  StatCard,
  useToast,
} from '../ui.jsx';

const METRIC_OPTIONS = [
  ['ON_TIME_DEPARTURE', 'Ketepatan Keberangkatan', '%'],
  ['TRIP_COMPLETION', 'Penyelesaian Trip', '%'],
  ['AVAILABILITY', 'Ketersediaan Armada', '%'],
  ['RESPONSE_TIME', 'Waktu Respons', 'menit'],
];
const METRIC_LABELS = Object.fromEntries(METRIC_OPTIONS.map(([value, label]) => [value, label]));
const CONTRACT_STATUS_TONES = { ACTIVE: 'green', EXPIRED: 'red', TERMINATED: 'gray' };
const SCORE_LABELS = { MEETS: 'Memenuhi', AT_RISK: 'Berisiko', BREACH: 'Pelanggaran' };
const SCORE_TONES = { MEETS: 'green', AT_RISK: 'amber', BREACH: 'red' };
const EXCEPTION_LABELS = {
  METRIC_BREACH: 'Target tidak tercapai',
  NO_DATA: 'Tanpa data',
  MISSING_DEFINITIONS: 'Definisi kosong',
  EXPIRING: 'Segera berakhir',
  EXPIRED_ACTIVE: 'Kedaluwarsa tapi aktif',
  VENDOR_INACTIVE: 'Vendor nonaktif',
};

const isoDate = (offsetDays) => {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return toDateInput(date);
};

const emptyForm = () => ({
  vendorId: '',
  contractNumber: '',
  serviceScope: '',
  startDate: isoDate(0),
  endDate: isoDate(365),
  monthlyValue: '',
  status: 'ACTIVE',
  documentRef: '',
  notes: '',
  definitions: [{ metric: 'ON_TIME_DEPARTURE', target: 95, unit: '%', notes: '' }],
});

function actualLabel(metric) {
  if (metric.value == null) return '—';
  return metric.metric === 'RESPONSE_TIME' ? `${metric.value} ${metric.unit}` : `${metric.value}${metric.unit}`;
}

function evidenceLine(metric, item) {
  if (metric.metric === 'ON_TIME_DEPARTURE') {
    return `${item.bookingCode || '—'} · ${item.plateNumber || '—'} · telat ${item.lateMinutes} menit · ${item.onTime ? 'tepat waktu' : 'melewati toleransi'}`;
  }
  if (metric.metric === 'TRIP_COMPLETION') return `${item.bookingCode || '—'} · ${item.plateNumber || '—'} · ${item.status}`;
  if (metric.metric === 'AVAILABILITY') return `${item.plateNumber} · ${item.status}`;
  return `${item.bookingCode || '—'} · ${item.plateNumber || '—'} · ${item.minutes} menit`;
}

export default function VendorSla() {
  const { user } = useAuth();
  const toast = useToast();
  const canManage = can(user.role, 'vendors:sla');

  const [data, setData] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [range, setRange] = useState({ from: isoDate(-90), to: isoDate(0) });
  const [pendingRange, setPendingRange] = useState({ from: isoDate(-90), to: isoDate(0) });
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (nextRange = range) => {
    setLoading(true);
    try {
      const [overview, vendorList] = await Promise.all([
        api('/sla/overview', { query: nextRange }),
        api('/vendors', { query: { pageSize: 200 } }),
      ]);
      setData(overview);
      setVendors(vendorList.items || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contracts = useMemo(() => {
    const list = data?.contracts || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((contract) =>
      [contract.vendor?.name, contract.contractNumber, contract.serviceScope].join(' ').toLowerCase().includes(q)
    );
  }, [data, search]);

  const exceptions = useMemo(
    () =>
      (data?.contracts || []).flatMap((contract) =>
        contract.exceptions
          .filter((exception) => exception.type !== 'NO_DATA')
          .map((exception) => ({ ...exception, contractNumber: contract.contractNumber, vendor: contract.vendor?.name }))
      ),
    [data]
  );

  const applyRange = () => {
    if (!pendingRange.from || !pendingRange.to) {
      toast.error('Lengkapi tanggal evaluasi.');
      return;
    }
    if (pendingRange.from > pendingRange.to) {
      toast.error('Tanggal awal harus sebelum tanggal akhir.');
      return;
    }
    setRange(pendingRange);
    load(pendingRange);
  };

  const openCreate = () => {
    setForm(emptyForm());
    setModal({ type: 'create' });
  };

  const openEdit = (contract) => {
    setForm({
      vendorId: contract.vendor.id,
      contractNumber: contract.contractNumber,
      serviceScope: contract.serviceScope || '',
      startDate: toDateInput(contract.startDate),
      endDate: toDateInput(contract.endDate),
      monthlyValue: contract.monthlyValue == null ? '' : String(contract.monthlyValue),
      status: contract.status,
      documentRef: contract.documentRef || '',
      notes: contract.notes || '',
      definitions: contract.metrics.map((metric) => ({
        metric: metric.metric,
        target: metric.target,
        unit: metric.unit || '%',
        notes: metric.notes || '',
      })),
    });
    setModal({ type: 'edit', contract });
  };

  const updateDefinition = (index, patch) => {
    setForm((current) => ({
      ...current,
      definitions: current.definitions.map((definition, itemIndex) =>
        itemIndex === index ? { ...definition, ...patch } : definition
      ),
    }));
  };

  const addDefinition = () => {
    const used = new Set(form.definitions.map((definition) => definition.metric));
    const next = METRIC_OPTIONS.find(([value]) => !used.has(value));
    if (!next) {
      toast.error('Semua metrik SLA sudah ditambahkan.');
      return;
    }
    setForm((current) => ({
      ...current,
      definitions: [...current.definitions, { metric: next[0], target: next[0] === 'RESPONSE_TIME' ? 30 : 95, unit: next[2], notes: '' }],
    }));
  };

  const removeDefinition = (index) => {
    setForm((current) => ({ ...current, definitions: current.definitions.filter((_, itemIndex) => itemIndex !== index) }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (form.endDate <= form.startDate) {
      toast.error('Tanggal akhir harus setelah tanggal mulai.');
      return;
    }
    const definitions = form.definitions.map((definition) => ({
      metric: definition.metric,
      target: Number(definition.target),
      unit: definition.unit || (definition.metric === 'RESPONSE_TIME' ? 'menit' : '%'),
      notes: definition.notes.trim() || null,
    }));
    if (definitions.some((definition) => !Number.isFinite(definition.target) || definition.target < 0)) {
      toast.error('Target metrik harus berupa angka tidak negatif.');
      return;
    }
    const payload = {
      contractNumber: form.contractNumber.trim(),
      serviceScope: form.serviceScope.trim() || null,
      startDate: form.startDate,
      endDate: form.endDate,
      monthlyValue: form.monthlyValue === '' ? null : Number(form.monthlyValue),
      status: form.status,
      documentRef: form.documentRef.trim() || null,
      notes: form.notes.trim() || null,
      definitions,
    };
    setBusy(true);
    try {
      if (modal.type === 'create') {
        await apiPost('/sla/contracts', { ...payload, vendorId: form.vendorId });
        toast.success('Kontrak vendor dibuat.');
      } else {
        await apiPatch(`/sla/contracts/${modal.contract.id}`, payload);
        toast.success('Kontrak vendor diperbarui.');
      }
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Vendor governance"
        title="SLA & Kontrak Vendor"
        subtitle="Skor SLA dihitung dari data operasional pada periode evaluasi. Target, biaya, dan dokumen hanya berasal dari data kontrak."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => load()} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            {canManage && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={15} /> Tambah Kontrak
              </button>
            )}
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="stats-grid">
        <StatCard label="Kontrak Aktif" value={data?.summary.active ?? '—'} hint={`${data?.summary.contracts ?? 0} kontrak tercatat`} icon={Handshake} />
        <StatCard label="Memenuhi SLA" value={data?.summary.meets ?? '—'} hint="Semua metrik mencapai target" icon={ShieldCheck} />
        <StatCard label="Berisiko" value={data?.summary.atRisk ?? '—'} hint="Ada metrik tanpa data / kontrak segera berakhir" icon={AlertTriangle} />
        <StatCard label="Pelanggaran SLA" value={data?.summary.breach ?? '—'} hint={`${data?.summary.breaches ?? 0} metrik di bawah target`} icon={FileText} />
      </div>

      {exceptions.length > 0 && (
        <div className="callout callout-warn" role="status">
          <AlertTriangle size={18} />
          <div>
            <b>{exceptions.length} exception SLA perlu ditinjau.</b>
            <ul className="exception-list">
              {exceptions.slice(0, 4).map((exception, index) => (
                <li key={`${exception.contractNumber}-${exception.type}-${index}`}>
                  {EXCEPTION_LABELS[exception.type] || exception.type} · {exception.vendor} ({exception.contractNumber}) — {exception.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Cari vendor, nomor kontrak, atau lingkup..." />
          <div className="sla-range">
            <label>
              <span>Dari</span>
              <input type="date" value={pendingRange.from} onChange={(event) => setPendingRange({ ...pendingRange, from: event.target.value })} />
            </label>
            <label>
              <span>Sampai</span>
              <input type="date" value={pendingRange.to} onChange={(event) => setPendingRange({ ...pendingRange, to: event.target.value })} />
            </label>
            <button type="button" className="btn btn-secondary btn-sm" onClick={applyRange}>
              Terapkan
            </button>
          </div>
        </div>
        <p className="muted-text sla-note">
          Periode evaluasi: {fmtDate(data?.range.from)} – {fmtDate(data?.range.to)} · {data?.summary.evaluatedTrips ?? 0} trip dianalisis ·{' '}
          toleransi on-time {data?.onTimeToleranceMinutes ?? 15} menit
        </p>
      </div>

      {!loading && contracts.length === 0 && (
        <div className="panel">
          <div className="empty-state">
            <b>Tidak ada kontrak yang cocok.</b>
            <p>Ubah kata kunci atau tambahkan kontrak vendor baru.</p>
          </div>
        </div>
      )}

      <div className="sla-grid">
        {contracts.map((contract) => (
          <section className="panel sla-card" key={contract.id}>
            <div className="sla-card-head">
              <div>
                <b>{contract.vendor?.name}</b>
                <p className="muted-text">
                  {contract.contractNumber} · {contract.serviceScope || 'Lingkup belum dicatat'}
                </p>
              </div>
              <div className="badge-row">
                <Badge value={contract.status} tone={CONTRACT_STATUS_TONES[contract.status]} />
                <Badge value={SCORE_LABELS[contract.scoreStatus]} tone={SCORE_TONES[contract.scoreStatus]} />
              </div>
            </div>

            <div className="sla-meta">
              <span>{fmtDate(contract.startDate)} – {fmtDate(contract.endDate)}</span>
              <span className={contract.expiringSoon ? 'text-warn' : ''}>
                {contract.daysToEnd < 0 ? `Lewat ${Math.abs(contract.daysToEnd)} hari` : `${contract.daysToEnd} hari lagi`}
              </span>
              <span>{contract.monthlyValue != null ? fmtMoney(contract.monthlyValue) : 'Biaya tidak dicantumkan'}</span>
              <span>{contract.documentRef || 'Dokumen belum dicatat'}</span>
            </div>

            {contract.metrics.length === 0 ? (
              <p className="muted-text">Belum ada definisi metrik SLA untuk kontrak ini.</p>
            ) : (
              <table className="sla-metrics">
                <thead>
                  <tr>
                    <th>Metrik</th>
                    <th>Target</th>
                    <th>Aktual</th>
                    <th>Bukti</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.metrics.map((metric) => (
                    <tr key={metric.id}>
                      <td>
                        <div className="cell-stack">
                          <b>{metric.label}</b>
                          <small>{metric.summary}</small>
                        </div>
                      </td>
                      <td>
                        {metric.target}
                        {metric.unit}
                      </td>
                      <td>{actualLabel(metric)}</td>
                      <td>
                        {metric.evidence.length > 0 ? (
                          <details>
                            <summary>{metric.evidenceCount} bukti</summary>
                            <ul className="sla-evidence">
                              {metric.evidence.map((item, index) => (
                                <li key={index}>{evidenceLine(metric, item)}</li>
                              ))}
                            </ul>
                          </details>
                        ) : (
                          <span className="muted-text">—</span>
                        )}
                      </td>
                      <td>
                        <Badge
                          value={metric.achieved === true ? 'Tercapai' : metric.achieved === false ? 'Tidak tercapai' : 'Tanpa data'}
                          tone={metric.achieved === true ? 'green' : metric.achieved === false ? 'red' : 'gray'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="sla-card-foot">
              <small className="muted-text">
                {contract.evidenceSummary.trips} trip · {contract.evidenceSummary.activeTrips} aktif · {contract.evidenceSummary.vehicles} kendaraan vendor
              </small>
              {canManage && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(contract)}>
                  <Pencil size={13} /> Ubah
                </button>
              )}
            </div>
          </section>
        ))}
      </div>

      {data?.rules && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Aturan Evaluasi</h2>
              <p>Perhitungan transparan dan dapat diaudit; bukan penilaian otomatis terhadap kontrak.</p>
            </div>
          </div>
          <ul className="rules-list">
            {data.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </section>
      )}

      {(modal?.type === 'create' || modal?.type === 'edit') && (
        <Modal
          size="lg"
          title={modal.type === 'create' ? 'Tambah Kontrak Vendor' : 'Ubah Kontrak Vendor'}
          subtitle="Nilai kontrak kosong dibiarkan kosong. Jangan mengisi angka yang tidak tercantum dalam dokumen."
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="sla-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Simpan'}
              </button>
            </>
          }
        >
          <form id="sla-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Vendor">
                <select
                  required
                  value={form.vendorId}
                  disabled={modal.type === 'edit'}
                  onChange={(event) => setForm({ ...form, vendorId: event.target.value })}
                >
                  <option value="">— Pilih vendor —</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Nomor kontrak">
                <input required minLength={3} value={form.contractNumber} onChange={(event) => setForm({ ...form, contractNumber: event.target.value })} />
              </Field>
              <Field label="Mulai">
                <input required type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} />
              </Field>
              <Field label="Berakhir">
                <input required type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} />
              </Field>
              <Field label="Nilai bulanan (Rp)" hint="Kosongkan bila tidak tercantum di kontrak.">
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={form.monthlyValue}
                  onChange={(event) => setForm({ ...form, monthlyValue: event.target.value })}
                />
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                  <option value="ACTIVE">Aktif</option>
                  <option value="EXPIRED">Kedaluwarsa</option>
                  <option value="TERMINATED">Dihentikan</option>
                </select>
              </Field>
              <Field label="Lingkup layanan" className="span-2">
                <input value={form.serviceScope} onChange={(event) => setForm({ ...form, serviceScope: event.target.value })} placeholder="Contoh: penyediaan kendaraan dan driver" />
              </Field>
              <Field label="Referensi dokumen" className="span-2" hint="Contoh nomor arsip internal; tidak diisi otomatis.">
                <input value={form.documentRef} onChange={(event) => setForm({ ...form, documentRef: event.target.value })} />
              </Field>
              <Field label="Catatan" className="span-2">
                <textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
              </Field>
            </div>

            <div className="sla-definitions">
              <div className="sla-definitions-head">
                <h3 className="section-title">Definisi Metrik SLA</h3>
                <button type="button" className="btn btn-secondary btn-sm" onClick={addDefinition}>
                  <Plus size={13} /> Tambah Metrik
                </button>
              </div>
              {form.definitions.length === 0 && <p className="muted-text">Kontrak tanpa metrik akan ditandai berisiko.</p>}
              {form.definitions.map((definition, index) => (
                <div className="sla-definition-row" key={definition.metric}>
                  <select
                    value={definition.metric}
                    onChange={(event) => {
                      const option = METRIC_OPTIONS.find(([value]) => value === event.target.value);
                      updateDefinition(index, { metric: event.target.value, unit: option?.[2] || '%' });
                    }}
                  >
                    {METRIC_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    required
                    aria-label={`Target ${METRIC_LABELS[definition.metric]}`}
                    value={definition.target}
                    onChange={(event) => updateDefinition(index, { target: event.target.value })}
                  />
                  <span className="sla-unit">{definition.unit}</span>
                  <input
                    aria-label={`Catatan ${METRIC_LABELS[definition.metric]}`}
                    value={definition.notes}
                    placeholder="Catatan (opsional)"
                    onChange={(event) => updateDefinition(index, { notes: event.target.value })}
                  />
                  <button type="button" className="icon-btn icon-bad" title="Hapus metrik" onClick={() => removeDefinition(index)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

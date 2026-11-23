import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrainCircuit, DatabaseZap, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { api, apiGet } from '../api.js';
import { fmtDate, fmtMoney, toDateInput } from '../format.js';
import { Badge, ErrorBanner, PageHeader, Spinner, useToast } from '../ui.jsx';

const GROUPS = [
  ['fleet', 'Armada'],
  ['operations', 'Operasi'],
  ['cost', 'Biaya'],
  ['compliance', 'Kepatuhan'],
];

const STATUS_META = {
  GOOD: { tone: 'green', label: 'Sehat' },
  WARN: { tone: 'amber', label: 'Perhatian' },
  BAD: { tone: 'red', label: 'Kritis' },
  NEUTRAL: { tone: 'gray', label: 'Info' },
};

const SEVERITY_LABEL = { HIGH: 'Tinggi', MEDIUM: 'Sedang', LOW: 'Rendah' };

const defaultRange = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: toDateInput(from), to: toDateInput(to) };
};

function formatValue(kpi) {
  if (kpi.value === null || kpi.value === undefined) return '—';
  if (kpi.unit === '%') return `${kpi.value}%`;
  if (kpi.unit === 'IDR') return fmtMoney(kpi.value);
  if (kpi.unit === 'mnt') return `${kpi.value} mnt`;
  return `${kpi.value} ${kpi.unit}`;
}

export default function Intelligence() {
  const toast = useToast();
  const [range, setRange] = useState(defaultRange);
  const [kpiData, setKpiData] = useState(null);
  const [quality, setQuality] = useState(null);
  const [widgets, setWidgets] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (nextRange) => {
    setLoading(true);
    try {
      const [kpis, dq] = await Promise.all([
        apiGet('/intelligence/kpis', { from: nextRange.from, to: nextRange.to }),
        apiGet('/intelligence/data-quality', { from: nextRange.from, to: nextRange.to }),
      ]);
      setKpiData(kpis);
      setQuality(dq);
      setWidgets(kpis.preferences.widgets);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allKpis = useMemo(() => {
    if (!kpiData) return [];
    return GROUPS.flatMap(([key]) => kpiData.groups[key] || []);
  }, [kpiData]);

  const toggleWidget = (id) => {
    setDirty(true);
    setWidgets((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 6) {
        toast.error('Maksimal 6 widget dashboard.');
        return current;
      }
      return [...current, id];
    });
  };

  const applyRange = () => {
    if (!range.from || !range.to) {
      toast.error('Isi tanggal awal dan akhir.');
      return;
    }
    if (range.from > range.to) {
      toast.error('Tanggal awal harus sebelum tanggal akhir.');
      return;
    }
    load(range);
  };

  const saveWidgets = async () => {
    setSaving(true);
    try {
      const result = await api('/intelligence/widgets', { method: 'PUT', body: { widgets } });
      setWidgets(result.widgets);
      setDirty(false);
      toast.success('Widget dashboard disimpan.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Fleet intelligence"
        title="Fleet Intelligence & KPI"
        subtitle="Perpustakaan KPI dengan formula transparan, pemantauan kualitas data, dan widget dashboard pilihan Anda."
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => load(range)} disabled={loading}>
            <RefreshCw size={15} /> {loading ? 'Menghitung...' : 'Refresh'}
          </button>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="panel intel-notice">
        <Sparkles size={18} />
        <div>
          <b>Data DEMO, aturan eksplisit.</b>
          <p>
            Seluruh KPI dihitung dari database demo lokal memakai formula yang ditampilkan. Tidak ada model machine learning, prediksi vendor,
            atau benchmark resmi KCIC. Ambang status (Sehat/Perhatian/Kritis) adalah aturan demo yang dapat disesuaikan.
          </p>
        </div>
      </div>

      <div className="panel report-toolbar">
        <div className="report-range">
          <label>
            <span>Dari tanggal</span>
            <input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} />
          </label>
          <label>
            <span>Sampai tanggal</span>
            <input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} />
          </label>
          <button type="button" className="btn btn-primary btn-sm" onClick={applyRange} disabled={loading}>
            Terapkan
          </button>
        </div>
        {kpiData && <p className="report-range-note">Periode: {fmtDate(kpiData.range.from)} — {fmtDate(kpiData.range.to)}</p>}
      </div>

      {loading && !kpiData ? (
        <div className="panel table-state">
          <Spinner /> Menghitung KPI...
        </div>
      ) : kpiData ? (
        <>
          {GROUPS.map(([key, label]) => {
            const items = kpiData.groups[key] || [];
            if (!items.length) return null;
            return (
              <section className="panel report-section" key={key}>
                <h3 className="panel-title">KPI {label}</h3>
                <div className="intel-grid">
                  {items.map((kpi) => {
                    const meta = STATUS_META[kpi.status];
                    return (
                      <article className="intel-card" key={kpi.id}>
                        <div className="intel-card-top">
                          <span>{kpi.label}</span>
                          <Badge value={kpi.status} tone={meta.tone} label={meta.label} />
                        </div>
                        <strong className="intel-value">{formatValue(kpi)}</strong>
                        <small className="intel-target">Target demo: {kpi.target}</small>
                        <details className="intel-formula">
                          <summary>Formula &amp; catatan</summary>
                          <p>{kpi.formula}</p>
                          <p className="muted">{kpi.note}</p>
                        </details>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <section className="panel report-section">
            <div className="panel-head">
              <div>
                <h3>Widget dashboard</h3>
                <p>Pilih maksimal 6 KPI yang tampil di ringkasan Dashboard Anda. Preferensi disimpan per akun.</p>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={saveWidgets} disabled={saving || !dirty}>
                {saving ? 'Menyimpan...' : 'Simpan widget'}
              </button>
            </div>
            <div className="intel-widgets">
              {allKpis.map((kpi) => (
                <label key={kpi.id} className={`intel-widget-chip ${widgets.includes(kpi.id) ? 'intel-widget-active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={widgets.includes(kpi.id)}
                    onChange={() => toggleWidget(kpi.id)}
                  />
                  <span>{kpi.label}</span>
                </label>
              ))}
            </div>
            {!widgets.length && <p className="panel-empty">Belum ada widget dipilih; dashboard tidak menampilkan panel intelijen.</p>}
            <p className="intel-hint">
              <Link to="/">Buka Dashboard</Link> untuk melihat widget yang dipilih.
            </p>
          </section>

          <section className="panel report-section">
            <div className="panel-head">
              <div>
                <h3>Kualitas data</h3>
                <p>Pemeriksaan aturan terhadap kelengkapan dan konsistensi data demo.</p>
              </div>
              {quality && (
                <Badge
                  value={quality.score >= 80 ? 'GOOD' : quality.score >= 55 ? 'WARN' : 'BAD'}
                  tone={quality.score >= 80 ? 'green' : quality.score >= 55 ? 'amber' : 'red'}
                  label={`Skor ${quality.score}%`}
                />
              )}
            </div>
            {!quality ? (
              <div className="table-state">
                <Spinner /> Memeriksa data...
              </div>
            ) : (
              <>
                <div className="dq-summary">
                  <div className="dq-bar" role="img" aria-label={`Skor kualitas data ${quality.score} persen`}>
                    <i style={{ width: `${quality.score}%` }} />
                  </div>
                  <p>
                    <b>{quality.passed}</b> dari <b>{quality.total}</b> pemeriksaan lolos. Skor berbobot: temuan Tinggi paling menurunkan skor.
                  </p>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Pemeriksaan</th>
                        <th>Status</th>
                        <th>Tingkat</th>
                        <th>Temuan</th>
                        <th>Sampel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quality.checks.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <div className="cell-stack">
                              <b>{item.label}</b>
                              <small className="muted">{item.detail}</small>
                            </div>
                          </td>
                          <td>
                            <Badge
                              value={item.status}
                              tone={item.status === 'PASS' ? 'green' : item.status === 'FAIL' ? 'red' : 'amber'}
                              label={item.status === 'PASS' ? 'Lolos' : item.status === 'FAIL' ? 'Gagal' : 'Perhatian'}
                            />
                          </td>
                          <td>{SEVERITY_LABEL[item.severity]}</td>
                          <td>
                            {item.count}
                            {item.total !== null ? ` / ${item.total}` : ''}
                          </td>
                          <td>
                            {item.sample.length ? (
                              <span className="dq-samples">{item.sample.join(', ')}</span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="intel-hint">{quality.disclaimer}</p>
              </>
            )}
          </section>

          <div className="panel intel-links">
            <span>
              <DatabaseZap size={16} /> Butuh angka periode lain atau ekspor?
            </span>
            <Link className="link-btn" to="/reports">Buka Laporan &amp; Ekspor</Link>
            <span className="muted">
              <ShieldAlert size={14} /> KPI hanya baca; perubahan data tetap melalui modul operasional dengan audit log.
            </span>
          </div>
        </>
      ) : (
        <div className="panel table-state">
          <BrainCircuit size={20} /> KPI tidak tersedia.
        </div>
      )}
    </>
  );
}

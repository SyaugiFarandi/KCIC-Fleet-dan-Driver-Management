import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Fuel as FuelIcon, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, apiPatch, apiPost, downloadFile } from '../api.js';
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
  useToast,
} from '../ui.jsx';

const PAYMENT_LABELS = {
  FUEL_CARD: 'Fuel Card',
  VENDOR_CARD: 'Kartu Vendor',
  CASH: 'Tunai',
  TRANSFER: 'Transfer',
};

const ANOMALY_LABELS = {
  NONE: 'Normal',
  FLAGGED: 'Perlu Review',
  APPROVED: 'Disetujui',
};

const anomalyTone = (value) => (value === 'FLAGGED' ? 'amber' : value === 'APPROVED' ? 'green' : 'gray');

const emptyForm = (prices) => ({
  vehicleId: '',
  driverId: '',
  fuelType: prices[0]?.fuelType || 'BIOSOLAR',
  liters: '',
  odometerKm: '',
  paymentMethod: 'FUEL_CARD',
  station: '',
  transactionAt: toDateTimeLocal(new Date()),
});

export default function Fuel() {
  const { user } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [prices, setPrices] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', anomalyStatus: '', paymentMethod: '', from: '', to: '' });
  const [range, setRange] = useState({ from: '', to: '' });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(() => emptyForm([]));
  const [review, setReview] = useState({ decision: 'APPROVE', note: '' });
  const [priceEdits, setPriceEdits] = useState({});
  const [busy, setBusy] = useState(false);

  const canWrite = can(user.role, 'fuel:write');
  const canReview = can(user.role, 'fuel:review');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, summaryData, priceData, vehicleList, driverList] = await Promise.all([
        api('/fuel', { query: { pageSize: 200, from: range.from, to: range.to } }),
        api('/fuel/summary', { query: { from: range.from, to: range.to } }),
        api('/fuel/prices'),
        api('/vehicles', { query: { pageSize: 200 } }),
        api('/drivers', { query: { pageSize: 200 } }),
      ]);
      setItems(list.items || []);
      setSummary(summaryData);
      setPrices(priceData.items || []);
      setVehicles((vehicleList.items || []).filter((vehicle) => vehicle.status !== 'INACTIVE'));
      setDrivers(driverList.items || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter((item) => {
      if (filters.anomalyStatus && item.anomalyStatus !== filters.anomalyStatus) return false;
      if (filters.paymentMethod && item.paymentMethod !== filters.paymentMethod) return false;
      if (!q) return true;
      return [item.vehicle?.plateNumber, item.driver?.name, item.station, item.cardRef].join(' ').toLowerCase().includes(q);
    });
  }, [items, filters]);

  const selectedPrice = prices.find((price) => price.fuelType === form.fuelType);
  const estimatedCost = Number(form.liters || 0) * Number(selectedPrice?.pricePerLiter || 0);

  const openCreate = () => {
    const initial = emptyForm(prices);
    setForm(initial);
    setModal({ type: 'create' });
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiPost('/fuel', {
        vehicleId: form.vehicleId,
        driverId: form.driverId || null,
        fuelType: form.fuelType,
        transactionAt: new Date(form.transactionAt).toISOString(),
        liters: Number(form.liters),
        odometerKm: form.odometerKm === '' ? null : Number(form.odometerKm),
        paymentMethod: form.paymentMethod,
        station: form.station.trim() || null,
      });
      toast.success('Transaksi bahan bakar dicatat. Anomali otomatis diperiksa.');
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitReview = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiPatch(`/fuel/${modal.item.id}/review`, { decision: review.decision, note: review.note.trim() || undefined });
      toast.success(review.decision === 'APPROVE' ? 'Anomali disetujui sebagai transaksi valid.' : 'Anomali ditandai sebagai alarm palsu.');
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const savePrice = async (price) => {
    const value = Number(priceEdits[price.fuelType]);
    if (!value || value <= 0) {
      toast.error('Harga harus lebih dari 0.');
      return;
    }
    try {
      await apiPatch(`/fuel/prices/${price.fuelType}`, { pricePerLiter: value });
      toast.success(`Harga ${price.fuelType} diperbarui.`);
      setPriceEdits((current) => ({ ...current, [price.fuelType]: '' }));
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const exportFuel = async (format) => {
    try {
      await downloadFile(`/reports/export.${format}`, { dataset: 'fuel', from: range.from, to: range.to });
      toast.success(`Laporan bahan bakar (${format.toUpperCase()}) diunduh.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    { key: 'transactionAt', label: 'Waktu', render: (item) => fmtDateTime(item.transactionAt) },
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
    {
      key: 'fuel',
      label: 'BBM',
      render: (item) => (
        <div className="cell-stack">
          <b>
            {item.liters} L · {item.fuelType}
          </b>
          <small>{fmtMoney(item.pricePerLiter)}/L</small>
        </div>
      ),
    },
    { key: 'totalCost', label: 'Total', render: (item) => fmtMoney(item.totalCost) },
    { key: 'odometerKm', label: 'Odometer', render: (item) => (item.odometerKm != null ? `${item.odometerKm} km` : '—') },
    { key: 'paymentMethod', label: 'Pembayaran', render: (item) => PAYMENT_LABELS[item.paymentMethod] || item.paymentMethod },
    { key: 'station', label: 'SPBU', render: (item) => item.station || '—' },
    {
      key: 'anomalyStatus',
      label: 'Anomali',
      render: (item) => <Badge value={ANOMALY_LABELS[item.anomalyStatus] || item.anomalyStatus} tone={anomalyTone(item.anomalyStatus)} />,
    },
    ...(canReview
      ? [
          {
            key: 'actions',
            label: 'Aksi',
            render: (item) =>
              item.anomalyStatus === 'FLAGGED' ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setReview({ decision: 'APPROVE', note: '' });
                    setModal({ type: 'review', item });
                  }}
                >
                  <ShieldCheck size={14} /> Review
                </button>
              ) : (
                <span className="muted-text">{item.reviewedBy?.name ? `oleh ${item.reviewedBy.name}` : '—'}</span>
              ),
          },
        ]
      : []),
  ];

  const efficiencyColumns = [
    { key: 'label', label: 'Kendaraan' },
    { key: 'transactions', label: 'Transaksi' },
    { key: 'liters', label: 'Liter', render: (item) => `${Number(item.liters).toFixed(1)} L` },
    { key: 'cost', label: 'Biaya', render: (item) => fmtMoney(item.cost) },
    { key: 'distanceKm', label: 'Jarak', render: (item) => (item.distanceKm != null ? `${item.distanceKm} km` : '—') },
    {
      key: 'kmPerLiter',
      label: 'km/L',
      render: (item) =>
        item.kmPerLiter != null ? (
          <b>{item.kmPerLiter.toFixed(2)}</b>
        ) : (
          <span className="muted-text">Butuh ≥ 2 odometer</span>
        ),
    },
    { key: 'costPerKm', label: 'Biaya/km', render: (item) => (item.costPerKm != null ? fmtMoney(item.costPerKm) : '—') },
  ];

  const daily = summary?.daily?.slice(-14) || [];
  const maxDaily = Math.max(1, ...daily.map((entry) => entry.cost));

  return (
    <>
      <PageHeader
        eyebrow="Manajemen bahan bakar"
        title="Bahan Bakar"
        subtitle="Pencatatan konsumsi, efisiensi km/L, harga referensi, dan review anomali. Data bersumber dari seed/simulasi DEMO."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => exportFuel('csv')}>
              <Download size={15} /> CSV
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => exportFuel('xls')}>
              <Download size={15} /> Excel
            </button>
            {canWrite && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={15} /> Catat Transaksi
              </button>
            )}
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="filter-strip panel">
        <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari kendaraan, driver, SPBU..." />
        <select value={filters.anomalyStatus} onChange={(event) => setFilters({ ...filters, anomalyStatus: event.target.value })}>
          <option value="">Semua status</option>
          <option value="NONE">Normal</option>
          <option value="FLAGGED">Perlu Review</option>
          <option value="APPROVED">Disetujui</option>
        </select>
        <select value={filters.paymentMethod} onChange={(event) => setFilters({ ...filters, paymentMethod: event.target.value })}>
          <option value="">Semua pembayaran</option>
          {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="inline-field">
          <span>Dari</span>
          <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        </label>
        <label className="inline-field">
          <span>Sampai</span>
          <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        </label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRange({ from: filters.from, to: filters.to })}>
          Terapkan Periode
        </button>
      </div>

      <div className="stats-grid">
        <StatCard label="Total Biaya" value={fmtMoney(summary?.totals.cost || 0)} hint={`${summary?.totals.transactions || 0} transaksi`} icon={FuelIcon} />
        <StatCard label="Volume" value={`${Number(summary?.totals.liters || 0).toFixed(1)} L`} hint="Akumulasi periode" icon={FuelIcon} />
        <StatCard label="Rata-rata Harga" value={`${fmtMoney(summary?.totals.avgPricePerLiter || 0)}/L`} hint="Seluruh jenis BBM" icon={FuelIcon} />
        <StatCard
          label="Anomali"
          value={summary?.totals.flagged || 0}
          hint={`${summary?.totals.approved || 0} sudah disetujui`}
          icon={AlertTriangle}
          onClick={() => setFilters({ ...filters, anomalyStatus: 'FLAGGED' })}
        />
      </div>

      {(summary?.totals.flagged || 0) > 0 && (
        <div className="callout callout-warn" role="status">
          <AlertTriangle size={18} />
          <div>
            <b>{summary.totals.flagged} transaksi perlu review.</b>
            <p>Anomali terdeteksi dari selisih harga &gt; 15%, volume &gt; 100 L, atau odometer tidak bertambah.</p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFilters({ ...filters, anomalyStatus: 'FLAGGED' })}>
            Lihat anomali
          </button>
        </div>
      )}

      <div className="split-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Efisiensi per Kendaraan</h2>
              <p>km/L dihitung dari selisih odometer antar transaksi pada periode terpilih.</p>
            </div>
          </div>
          <DataTable
            columns={efficiencyColumns}
            rows={summary?.byVehicle || []}
            loading={loading}
            pageSize={8}
            empty="Belum ada transaksi pada periode ini."
          />
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Biaya Harian</h2>
              <p>14 hari terakhir pada periode terpilih.</p>
            </div>
          </div>
          {daily.length ? (
            <div className="mini-chart" role="img" aria-label="Grafik biaya bahan bakar harian">
              {daily.map((entry) => (
                <div className="mini-chart-col" key={entry.date} title={`${entry.date}: ${fmtMoney(entry.cost)}`}>
                  <span className="mini-chart-value">{Math.round(entry.cost / 1000)}k</span>
                  <div className="mini-chart-bar" style={{ height: `${Math.max(4, (entry.cost / maxDaily) * 100)}%` }} />
                  <small>{entry.date.slice(8, 10)}/{entry.date.slice(5, 7)}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="panel-empty">Belum ada data harian.</p>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Transaksi Bahan Bakar</h2>
            <p>{filtered.length} dari {items.length} transaksi sesuai filter.</p>
          </div>
        </div>
        <DataTable columns={columns} rows={filtered} loading={loading} empty="Tidak ada transaksi sesuai filter." pageSize={15} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Harga Referensi</h2>
            <p>Harga demo untuk perhitungan biaya dan deteksi anomali. Bukan harga resmi.</p>
          </div>
        </div>
        <div className="price-grid">
          {prices.map((price) => (
            <div className="price-card" key={price.fuelType}>
              <div>
                <b>{price.fuelType}</b>
                <p>{fmtMoney(price.pricePerLiter)} / liter</p>
                <small className="muted-text">Efektif {fmtDateTime(price.effectiveFrom)}</small>
              </div>
              {canWrite && (
                <div className="price-edit">
                  <input
                    type="number"
                    min="1"
                    step="100"
                    placeholder="Harga baru"
                    value={priceEdits[price.fuelType] || ''}
                    onChange={(event) => setPriceEdits({ ...priceEdits, [price.fuelType]: event.target.value })}
                    aria-label={`Harga baru ${price.fuelType}`}
                  />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => savePrice(price)}>
                    Simpan
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {modal?.type === 'create' && (
        <Modal
          title="Catat Transaksi Bahan Bakar"
          subtitle="Sistem memeriksa anomali otomatis setelah transaksi disimpan."
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="fuel-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Simpan Transaksi'}
              </button>
            </>
          }
        >
          <form id="fuel-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Kendaraan" className="span-2">
                <select required value={form.vehicleId} onChange={(event) => setForm({ ...form, vehicleId: event.target.value })}>
                  <option value="">— Pilih kendaraan —</option>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.plateNumber} · {vehicle.brand} {vehicle.model}
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
              <Field label="Waktu Transaksi">
                <input
                  required
                  type="datetime-local"
                  value={form.transactionAt}
                  onChange={(event) => setForm({ ...form, transactionAt: event.target.value })}
                />
              </Field>
              <Field label="Jenis BBM">
                <select value={form.fuelType} onChange={(event) => setForm({ ...form, fuelType: event.target.value })}>
                  {prices.map((price) => (
                    <option key={price.fuelType} value={price.fuelType}>
                      {price.fuelType} · {fmtMoney(price.pricePerLiter)}/L
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Volume (liter)">
                <input
                  required
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={form.liters}
                  onChange={(event) => setForm({ ...form, liters: event.target.value })}
                />
              </Field>
              <Field label="Odometer (km)" hint="Opsional, dipakai untuk efisiensi km/L dan deteksi odometer mundur.">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.odometerKm}
                  onChange={(event) => setForm({ ...form, odometerKm: event.target.value })}
                />
              </Field>
              <Field label="Metode Pembayaran">
                <select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}>
                  {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="SPBU">
                <input value={form.station} onChange={(event) => setForm({ ...form, station: event.target.value })} placeholder="Contoh: SPBU DEMO 31.101" />
              </Field>
              <div className="form-total span-2">
                <span>Estimasi biaya</span>
                <b>{fmtMoney(estimatedCost)}</b>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {modal?.type === 'review' && (
        <Modal
          title="Review Anomali Bahan Bakar"
          subtitle={`${modal.item.vehicle?.plateNumber} · ${modal.item.liters} L ${modal.item.fuelType}`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="review-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Simpan Review'}
              </button>
            </>
          }
        >
          <form id="review-form" onSubmit={submitReview}>
            <div className="callout callout-warn">
              <AlertTriangle size={17} />
              <p>{modal.item.anomalyNote || 'Transaksi ini ditandai oleh heuristik sistem.'}</p>
            </div>
            <Field label="Keputusan">
              <select value={review.decision} onChange={(event) => setReview({ ...review, decision: event.target.value })}>
                <option value="APPROVE">Valid — anomali disetujui</option>
                <option value="CLEAR">Alarm palsu — bersihkan tanda anomali</option>
              </select>
            </Field>
            <Field label="Catatan review (opsional)">
              <textarea rows={3} value={review.note} onChange={(event) => setReview({ ...review, note: event.target.value })} />
            </Field>
          </form>
        </Modal>
      )}
    </>
  );
}

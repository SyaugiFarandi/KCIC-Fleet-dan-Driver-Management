import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  CarFront,
  Download,
  Fuel,
  Printer,
  RefreshCw,
  Route as RouteIcon,
  Users,
  Wrench,
} from 'lucide-react';
import { getToken } from '../api.js';
import { fmtDate, fmtMoney, statusLabel, toDateInput } from '../format.js';
import { Badge, ErrorBanner, PageHeader, Spinner, StatCard, useToast } from '../ui.jsx';

const DATASETS = [
  ['bookings', 'Booking'],
  ['trips', 'Perjalanan'],
  ['vehicles', 'Kendaraan'],
  ['maintenance', 'Maintenance'],
  ['department', 'Rekap Departemen'],
];

const BOOKING_STATUS_ORDER = ['PENDING', 'APPROVED', 'ASSIGNED', 'COMPLETED', 'REJECTED', 'CANCELLED'];
const TRIP_STATUS_ORDER = ['SCHEDULED', 'DRIVER_ACCEPTED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

const defaultRange = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: toDateInput(from), to: toDateInput(to) };
};

export default function Reports() {
  const toast = useToast();
  const [range, setRange] = useState(defaultRange);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dataset, setDataset] = useState('bookings');
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async (nextRange = range) => {
    setLoading(true);
    try {
      const report = await fetchReport(nextRange);
      setData(report);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyRange = () => {
    if (!range.from || !range.to) {
      toast.error('Isi tanggal awal dan akhir laporan.');
      return;
    }
    if (range.from > range.to) {
      toast.error('Tanggal awal harus sebelum tanggal akhir.');
      return;
    }
    load(range);
  };

  const download = async () => {
    setDownloading(true);
    try {
      const query = new URLSearchParams({ dataset, from: range.from, to: range.to });
      const response = await fetch(`/api/reports/export.csv?${query.toString()}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!response.ok) {
        let message = `Ekspor gagal (HTTP ${response.status})`;
        try {
          const payload = await response.json();
          if (payload?.error) message = payload.error;
        } catch {
          /* keep default message */
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || `laporan-${dataset}-${range.from}.csv`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('File CSV berhasil diunduh.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const bookingTotal = useMemo(
    () => (data ? BOOKING_STATUS_ORDER.reduce((sum, status) => sum + (data.bookingStatus[status] || 0), 0) : 0),
    [data]
  );

  return (
    <>
      <PageHeader
        eyebrow="FLEET ANALYTICS"
        title="Laporan & Ekspor"
        subtitle="Ringkasan pemanfaatan armada, biaya maintenance, rekap booking per departemen, dan ekspor CSV."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
              <Printer size={15} /> Cetak / PDF
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => load(range)} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

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
        <div className="report-export">
          <select value={dataset} onChange={(event) => setDataset(event.target.value)}>
            {DATASETS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" onClick={download} disabled={downloading}>
            <Download size={14} /> {downloading ? 'Mengunduh...' : 'Ekspor CSV'}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="panel table-state">
          <Spinner /> Menghitung laporan...
        </div>
      ) : data ? (
        <div className="report-print">
          <p className="report-range-note">
            Periode laporan: <b>{fmtDate(data.range.from)}</b> — <b>{fmtDate(data.range.to)}</b> · Data dummy demo (bukan data resmi KCIC).
          </p>

          <div className="stats-grid">
            <StatCard label="Total Booking" value={data.totals.bookings} hint={`${data.totals.passengers} penumpang`} icon={CalendarCheck} />
            <StatCard label="Trip Selesai" value={data.totals.completedTrips} hint={`${data.totals.activeTrips} trip aktif`} icon={RouteIcon} />
            <StatCard label="Tingkat Persetujuan" value={data.totals.approvalRate === null ? '—' : `${data.totals.approvalRate}%`} hint="Dari booking yang diputuskan" icon={Users} />
            <StatCard label="Utilisasi Armada" value={`${data.totals.utilizationRate}%`} hint={`${data.totals.fleetSize} kendaraan terdaftar`} icon={CarFront} />
            <StatCard label="Biaya Maintenance" value={fmtMoney(data.totals.maintenanceCost)} hint={`${data.totals.maintenanceItems} pekerjaan`} icon={Wrench} />
            <StatCard label="Trip Dibatalkan" value={data.totals.cancelledTrips} hint="Selama periode laporan" icon={Fuel} />
          </div>

          <div className="report-grid">
            <section className="panel">
              <h3 className="panel-title">Distribusi Status Booking</h3>
              {bookingTotal === 0 ? (
                <p className="panel-empty">Tidak ada booking pada periode ini.</p>
              ) : (
                <ul className="report-bars">
                  {BOOKING_STATUS_ORDER.map((status) => {
                    const value = data.bookingStatus[status] || 0;
                    const percent = Math.round((value / bookingTotal) * 100);
                    return (
                      <li key={status}>
                        <div className="report-bar-head">
                          <span>{statusLabel(status)}</span>
                          <b>{value} ({percent}%)</b>
                        </div>
                        <div className="report-bar-track">
                          <i className={`report-bar-fill report-bar-${status.toLowerCase()}`} style={{ width: `${percent}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="panel">
              <h3 className="panel-title">Distribusi Status Trip</h3>
              {data.totals.completedTrips + data.totals.activeTrips + data.totals.cancelledTrips === 0 ? (
                <p className="panel-empty">Belum ada trip pada periode ini.</p>
              ) : (
                <div className="report-chip-grid">
                  {TRIP_STATUS_ORDER.map((status) => (
                    <div key={status} className="report-chip">
                      <Badge value={status} />
                      <b>{data.tripStatus[status] || 0}</b>
                    </div>
                  ))}
                </div>
              )}
              <div className="section-divider">
                <h4>Rekap per Departemen</h4>
              </div>
              {data.bookingByDepartment.length === 0 ? (
                <p className="panel-empty">Tidak ada data departemen.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Departemen</th>
                        <th>Total</th>
                        <th>Disetujui</th>
                        <th>Selesai</th>
                        <th>Ditolak</th>
                        <th>Pax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bookingByDepartment.map((row) => (
                        <tr key={row.department}>
                          <td><b>{row.department}</b></td>
                          <td>{row.total}</td>
                          <td>{row.approved}</td>
                          <td>{row.completed}</td>
                          <td>{row.rejected}</td>
                          <td>{row.passengers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <section className="panel report-section">
            <h3 className="panel-title">Pemanfaatan &amp; Biaya per Kendaraan</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kendaraan</th>
                    <th>Kepemilikan</th>
                    <th>Total Trip</th>
                    <th>Selesai</th>
                    <th>Jarak (km)</th>
                    <th>Pax</th>
                    <th>Biaya Maintenance</th>
                    <th>Biaya / Trip</th>
                    <th>STNK</th>
                    <th>Asuransi</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perVehicle.map((vehicle) => (
                    <tr key={vehicle.id}>
                      <td>
                        <div className="cell-stack">
                          <b>{vehicle.plateNumber}</b>
                          <small>{vehicle.brand} {vehicle.model}</small>
                        </div>
                      </td>
                      <td>{statusLabel(vehicle.ownership)}</td>
                      <td>{vehicle.trips}</td>
                      <td>{vehicle.completedTrips}</td>
                      <td>{vehicle.distanceKm}</td>
                      <td>{vehicle.passengers}</td>
                      <td>{fmtMoney(vehicle.maintenanceCost)}</td>
                      <td>{vehicle.costPerTrip === null ? '—' : fmtMoney(vehicle.costPerTrip)}</td>
                      <td>{fmtDate(vehicle.stnkExpiry)}</td>
                      <td>{fmtDate(vehicle.insuranceExpiry)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel report-section">
            <h3 className="panel-title">Daftar Maintenance</h3>
            {data.maintenance.length === 0 ? (
              <p className="panel-empty">Tidak ada maintenance terjadwal pada periode ini.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Kendaraan</th>
                      <th>Pekerjaan</th>
                      <th>Status</th>
                      <th>Dijadwalkan</th>
                      <th>Selesai</th>
                      <th>Biaya</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.maintenance.map((item) => (
                      <tr key={item.id}>
                        <td>{item.vehicle}</td>
                        <td>{item.title}</td>
                        <td><Badge value={item.status} /></td>
                        <td>{fmtDate(item.scheduledAt)}</td>
                        <td>{item.completedAt ? fmtDate(item.completedAt) : '—'}</td>
                        <td>{fmtMoney(item.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel report-section">
            <h3 className="panel-title">Daftar Perjalanan</h3>
            {data.trips.length === 0 ? (
              <p className="panel-empty">Tidak ada perjalanan pada periode ini.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Booking</th>
                      <th>Rute</th>
                      <th>Kendaraan</th>
                      <th>Driver</th>
                      <th>Berangkat</th>
                      <th>Pax</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trips.map((trip) => (
                      <tr key={trip.id}>
                        <td><b>{trip.bookingCode}</b></td>
                        <td>{trip.origin} → {trip.destination}</td>
                        <td>{trip.vehicle}</td>
                        <td>{trip.driver}</td>
                        <td>{fmtDate(trip.departureAt)}</td>
                        <td>{trip.passengers}</td>
                        <td><Badge value={trip.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="panel table-state">Laporan tidak tersedia.</div>
      )}
    </>
  );
}

async function fetchReport(range) {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  const token = getToken();
  const response = await fetch(`/api/reports/summary?${query.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    let message = `Gagal memuat laporan (HTTP ${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return response.json();
}

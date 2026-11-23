import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Car, Check, ClipboardList, Clock, Route as RouteIcon, Users, Wrench, X } from 'lucide-react';
import { api, apiPatch } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { fmtDateTime } from '../format.js';
import { Badge, ErrorBanner, Field, Modal, PageHeader, Spinner, StatCard, useConfirm, useToast } from '../ui.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api('/dashboard'));
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

  const decide = async (booking, decision, reason) => {
    setBusyId(booking.id);
    try {
      await apiPatch(`/bookings/${booking.id}/decision`, { decision, ...(reason ? { reason } : {}) });
      toast.success(decision === 'APPROVED' ? `Booking ${booking.code} disetujui.` : `Booking ${booking.code} ditolak.`);
      setRejectTarget(null);
      setRejectReason('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId('');
    }
  };

  const approve = async (booking) => {
    const ok = await confirm({
      title: 'Setujui booking?',
      message: `Booking ${booking.code} (${booking.origin} → ${booking.destination}) akan disetujui.`,
      confirmLabel: 'Setujui',
    });
    if (ok) decide(booking, 'APPROVED');
  };

  const submitReject = async (event) => {
    event.preventDefault();
    if (rejectReason.trim().length < 3) {
      toast.error('Alasan penolakan minimal 3 karakter.');
      return;
    }
    await decide(rejectTarget, 'REJECTED', rejectReason.trim());
  };

  if (loading && !data) {
    return (
      <div className="page-loading">
        <Spinner size={24} /> Memuat dashboard...
      </div>
    );
  }

  const kpis = data?.kpis || {};

  return (
    <>
      <PageHeader
        eyebrow="Pusat operasi armada"
        title="Ringkasan operasional"
        subtitle={
          data?.scope === 'OPERATIONS'
            ? 'Ringkasan operasional armada, driver, booking, dan perjalanan dari database.'
            : 'Ringkasan aktivitas personal Anda di platform transportasi.'
        }
        actions={
          <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
            <Clock size={15} /> {loading ? 'Memuat...' : 'Refresh'}
          </button>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {data?.scope === 'OPERATIONS' && (
        <>
          <div className="stats-grid">
            <StatCard label="Total Kendaraan" value={kpis.vehicles} hint={`${kpis.vehiclesAvailable} tersedia · ${kpis.vehiclesAssigned} ditugaskan`} icon={Car} onClick={() => navigate('/vehicles')} />
            <StatCard label="Driver Aktif" value={kpis.driversActive} hint={`${kpis.driversAvailable} siap ditugaskan`} icon={Users} onClick={() => navigate('/drivers')} />
            <StatCard label="Total Booking" value={kpis.bookings} hint={`${kpis.pendingBookings} menunggu approval`} icon={ClipboardList} onClick={() => navigate('/bookings')} />
            <StatCard label="Menunggu Approval" value={kpis.pendingBookings} hint="Perlu keputusan" icon={CalendarDays} onClick={() => navigate('/bookings')} />
            <StatCard label="Perjalanan Aktif" value={kpis.activeTrips} hint={`${kpis.tripsToday} trip hari ini`} icon={RouteIcon} onClick={() => navigate('/trips')} />
            <StatCard label="Dalam Maintenance" value={kpis.maintenanceActive} hint={`${kpis.maintenancePlanned} direncanakan`} icon={Wrench} onClick={() => navigate('/maintenance')} />
          </div>

          <div className="dashboard-grid">
            <section className="panel panel-span-2">
              <div className="panel-head">
                <div>
                  <h3>Menunggu Persetujuan</h3>
                  <p>Booking yang memerlukan keputusan approver</p>
                </div>
                <button type="button" className="link-btn" onClick={() => navigate('/bookings')}>
                  Lihat semua
                </button>
              </div>
              {data.pendingApprovals?.length ? (
                <div className="approval-list">
                  {data.pendingApprovals.map((booking) => (
                    <div className="approval-item" key={booking.id}>
                      <div className="approval-main">
                        <b>{booking.code}</b>
                        <span>
                          {booking.origin} → {booking.destination}
                        </span>
                        <small>
                          {booking.requester?.name} · {booking.passengerCount} pax · {fmtDateTime(booking.departureAt)}
                        </small>
                      </div>
                      <div className="approval-actions">
                        {can(user.role, 'bookings:decide') && (
                          <>
                            <button
                              type="button"
                              className="icon-btn icon-good"
                              title="Setujui"
                              disabled={busyId === booking.id}
                              onClick={() => approve(booking)}
                            >
                              <Check size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn icon-bad"
                              title="Tolak"
                              disabled={busyId === booking.id}
                              onClick={() => {
                                setRejectTarget(booking);
                                setRejectReason('');
                              }}
                            >
                              <X size={16} />
                            </button>
                          </>
                        )}
                        <Badge value={booking.status} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="panel-empty">Tidak ada booking yang menunggu persetujuan.</p>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h3>Status Armada</h3>
                  <p>Distribusi status kendaraan</p>
                </div>
              </div>
              <div className="status-list">
                {[
                  ['Tersedia', data.statuses?.vehicles?.AVAILABLE || 0, 'green'],
                  ['Ditugaskan', data.statuses?.vehicles?.ASSIGNED || 0, 'blue'],
                  ['Perawatan', data.statuses?.vehicles?.MAINTENANCE || 0, 'red'],
                  ['Nonaktif', data.statuses?.vehicles?.INACTIVE || 0, 'gray'],
                ].map(([label, value, tone]) => (
                  <div className="status-row" key={label}>
                    <span className={`status-dot dot-${tone}`} />
                    <span>{label}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
              <div className="status-divider" />
              <div className="status-list">
                {[
                  ['Booking menunggu', data.statuses?.bookings?.PENDING || 0],
                  ['Booking ditugaskan', data.statuses?.bookings?.ASSIGNED || 0],
                  ['Trip berjalan', (data.statuses?.trips?.IN_PROGRESS || 0) + (data.statuses?.trips?.PICKED_UP || 0)],
                  ['Maintenance berjalan', data.statuses?.maintenance?.IN_PROGRESS || 0],
                ].map(([label, value]) => (
                  <div className="status-row" key={label}>
                    <span>{label}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h3>Perjalanan Aktif</h3>
                <p>Kendaraan dan driver yang sedang bertugas</p>
              </div>
              <button type="button" className="link-btn" onClick={() => navigate('/trips')}>
                Kelola trip
              </button>
            </div>
            {data.activeTrips?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Booking</th>
                      <th>Rute</th>
                      <th>Keberangkatan</th>
                      <th>Kendaraan</th>
                      <th>Driver</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activeTrips.map((trip) => (
                      <tr key={trip.id}>
                        <td>
                          <b>{trip.booking.code}</b>
                        </td>
                        <td>
                          {trip.booking.origin} → {trip.booking.destination}
                        </td>
                        <td>{fmtDateTime(trip.booking.departureAt)}</td>
                        <td>{trip.vehicle?.plateNumber || '—'}</td>
                        <td>{trip.driver?.name || '—'}</td>
                        <td>
                          <Badge value={trip.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel-empty">Belum ada perjalanan aktif.</p>
            )}
          </section>

          <div className="dashboard-grid">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h3>Maintenance Mendatang</h3>
                  <p>Jadwal perawatan terdekat</p>
                </div>
                <button type="button" className="link-btn" onClick={() => navigate('/maintenance')}>
                  Lihat semua
                </button>
              </div>
              {data.upcomingMaintenance?.length ? (
                <ul className="simple-list">
                  {data.upcomingMaintenance.map((item) => (
                    <li key={item.id}>
                      <div>
                        <b>{item.vehicle?.plateNumber}</b>
                        <span>{item.title}</span>
                        <small>{fmtDateTime(item.scheduledAt)}</small>
                      </div>
                      <Badge value={item.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="panel-empty">Tidak ada maintenance terjadwal.</p>
              )}
            </section>

            {data.recentAudit?.length > 0 && (
              <section className="panel panel-span-2">
                <div className="panel-head">
                  <div>
                    <h3>Aktivitas Terbaru</h3>
                    <p>Jejak audit perubahan data</p>
                  </div>
                  <button type="button" className="link-btn" onClick={() => navigate('/audit')}>
                    Buka audit log
                  </button>
                </div>
                <ul className="simple-list">
                  {data.recentAudit.map((entry) => (
                    <li key={entry.id}>
                      <div>
                        <b>{entry.action}</b>
                        <span>{entry.detail || entry.entity}</span>
                        <small>
                          {entry.user?.name || 'Sistem'} · {fmtDateTime(entry.createdAt)}
                        </small>
                      </div>
                      <Badge value={entry.entity} tone="gray" label={entry.entity} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}

      {data?.scope === 'PERSONAL' && user.role === 'DRIVER' && (
        <>
          <div className="stats-grid">
            <StatCard label="Trip Aktif" value={kpis.myActiveTrips} hint="Sedang berjalan / dijemput" icon={RouteIcon} onClick={() => navigate('/trips')} />
            <StatCard label="Trip Terjadwal" value={kpis.myScheduledTrips} hint="Menunggu Anda terima" icon={CalendarDays} onClick={() => navigate('/trips')} />
            <StatCard label="Trip Selesai" value={kpis.myCompletedTrips} hint="Total riwayat" icon={Check} onClick={() => navigate('/trips')} />
            <StatCard label="Penugasan Mendatang" value={kpis.myUpcomingTrips} hint="Trip aktif & terjadwal" icon={Clock} onClick={() => navigate('/trips')} />
          </div>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h3>Perjalanan Saya</h3>
                <p>Penugasan aktif dan terjadwal</p>
              </div>
              <button type="button" className="link-btn" onClick={() => navigate('/trips')}>
                Kelola status trip
              </button>
            </div>
            {data.myTrips?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Booking</th>
                      <th>Rute</th>
                      <th>Keberangkatan</th>
                      <th>Kendaraan</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.myTrips.map((trip) => (
                      <tr key={trip.id}>
                        <td>
                          <b>{trip.booking.code}</b>
                        </td>
                        <td>
                          {trip.booking.origin} → {trip.booking.destination}
                        </td>
                        <td>{fmtDateTime(trip.booking.departureAt)}</td>
                        <td>{trip.vehicle?.plateNumber || '—'}</td>
                        <td>
                          <Badge value={trip.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel-empty">Belum ada penugasan untuk Anda.</p>
            )}
          </section>
        </>
      )}

      {data?.scope === 'PERSONAL' && user.role !== 'DRIVER' && (
        <>
          <div className="stats-grid">
            <StatCard label="Booking Saya" value={kpis.myBookings} hint="Seluruh permintaan" icon={ClipboardList} onClick={() => navigate('/bookings')} />
            <StatCard label="Menunggu" value={kpis.myPendingBookings} hint="Belum diputuskan" icon={Clock} onClick={() => navigate('/bookings')} />
            <StatCard label="Disetujui" value={kpis.myApprovedBookings} hint="Menunggu penugasan" icon={Check} onClick={() => navigate('/bookings')} />
            <StatCard label="Ditugaskan" value={kpis.myAssignedBookings} hint="Kendaraan & driver tersedia" icon={RouteIcon} onClick={() => navigate('/bookings')} />
            <StatCard label="Selesai" value={kpis.myCompletedBookings} hint="Riwayat perjalanan" icon={CalendarDays} onClick={() => navigate('/bookings')} />
          </div>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h3>Booking Aktif Saya</h3>
                <p>Permintaan yang belum selesai</p>
              </div>
              <button type="button" className="link-btn" onClick={() => navigate('/bookings')}>
                Buat / kelola booking
              </button>
            </div>
            {data.myBookings?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Kode</th>
                      <th>Tujuan</th>
                      <th>Keberangkatan</th>
                      <th>Penugasan</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.myBookings.map((booking) => (
                      <tr key={booking.id}>
                        <td>
                          <b>{booking.code}</b>
                        </td>
                        <td>
                          {booking.origin} → {booking.destination}
                        </td>
                        <td>{fmtDateTime(booking.departureAt)}</td>
                        <td>{booking.trip ? `${booking.trip.vehicle?.plateNumber} · ${booking.trip.driver?.name}` : 'Belum ditugaskan'}</td>
                        <td>
                          <Badge value={booking.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel-empty">Anda belum memiliki booking aktif.</p>
            )}
          </section>
        </>
      )}

      {rejectTarget && (
        <Modal
          title={`Tolak booking ${rejectTarget.code}`}
          subtitle="Alasan penolakan akan terlihat oleh pemohon."
          onClose={() => setRejectTarget(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setRejectTarget(null)}>
                Batal
              </button>
              <button type="button" className="btn btn-danger" onClick={submitReject} disabled={busyId === rejectTarget.id}>
                Tolak Booking
              </button>
            </>
          }
        >
          <form onSubmit={submitReject}>
            <Field label="Alasan penolakan" hint="Minimal 3 karakter.">
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Contoh: Jadwal bertabrakan dengan agenda operasional."
                required
              />
            </Field>
          </form>
        </Modal>
      )}
    </>
  );
}

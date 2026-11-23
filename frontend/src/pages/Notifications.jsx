import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, CheckCheck, Mail, RefreshCw, Send } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../api.js';
import { fmtDateTime } from '../format.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { EmptyState, ErrorBanner, PageHeader, SearchBox, Spinner, useToast } from '../ui.jsx';

const TYPE_TONES = {
  BOOKING: 'blue',
  TRIP: 'purple',
  GPS_ALERT: 'red',
  DOCUMENT: 'amber',
  MAINTENANCE_DUE: 'amber',
};

const TYPE_TABS = [
  ['ALL', 'Semua'],
  ['BOOKING', 'Booking'],
  ['TRIP', 'Perjalanan'],
  ['GPS_ALERT', 'GPS Alert'],
  ['DOCUMENT', 'Dokumen'],
  ['MAINTENANCE_DUE', 'Maintenance'],
];

const DELIVERY_TONES = { SENT: 'green', FAILED: 'red', SKIPPED: 'gray', PENDING: 'amber' };
const DELIVERY_LABELS = { SENT: 'Terkirim', FAILED: 'Gagal', SKIPPED: 'Dilewati', PENDING: 'Diproses' };
const CHANNEL_LABELS = { EMAIL: 'Email', TELEGRAM: 'Telegram' };

export default function Notifications() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canAudit = can(user?.role, 'audit:read');

  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ type: 'ALL', unreadOnly: false, q: '' });
  const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [deliveryHint, setDeliveryHint] = useState('');

  useEffect(() => {
    if (!canAudit) return undefined;
    let cancelled = false;
    Promise.all([
      apiGet('/notifications/channels'),
      apiGet('/notifications/deliveries', { pageSize: 10 }),
    ])
      .then(([channelData, deliveryData]) => {
        if (cancelled) return;
        setChannels(channelData.channels || []);
        setDeliveries(deliveryData.items || []);
      })
      .catch((err) => {
        if (!cancelled) setDeliveryHint(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [canAudit]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet('/notifications', {
        pageSize: 100,
        type: filters.type === 'ALL' ? '' : filters.type,
        unreadOnly: filters.unreadOnly ? 'true' : '',
      });
      setItems(data.items || []);
      setUnreadCount(data.unreadCount || 0);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const map = { ALL: items.length };
    items.forEach((item) => {
      map[item.type] = (map[item.type] || 0) + 1;
    });
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.title} ${item.message}`.toLowerCase().includes(q));
  }, [items, filters.q]);

  const markRead = async (item) => {
    if (item.readAt) {
      if (item.link) navigate(item.link);
      return;
    }
    try {
      await apiPatch(`/notifications/${item.id}/read`, {});
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry)));
      setUnreadCount((current) => Math.max(0, current - 1));
      if (item.link) navigate(item.link);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const markAll = async () => {
    setBusy(true);
    try {
      await apiPost('/notifications/read-all');
      toast.success('Semua notifikasi ditandai sudah dibaca.');
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
        eyebrow="Kotak masuk"
        title="Pusat Notifikasi"
        subtitle="Keputusan booking, penugasan perjalanan, peringatan GPS, masa berlaku dokumen, dan maintenance mendatang."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button type="button" className="btn btn-primary" onClick={markAll} disabled={busy || unreadCount === 0}>
              <CheckCheck size={15} /> Tandai semua dibaca
            </button>
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {canAudit && (
        <section className="panel notif-channels">
          <div className="notif-channels-head">
            <div>
              <h3><Mail size={15} /> Channel notifikasi eksternal</h3>
              <p className="muted">
                Notifikasi in-app selalu aktif. Email dan Telegram hanya mengirim bila diaktifkan operator
                dengan kredensial valid; tidak ada pengiriman keluar pada mode demo.
              </p>
            </div>
            <div className="notif-channel-cards">
              {channels.map((channel) => {
                const active = channel.enabled && channel.configured;
                return (
                  <div key={channel.channel} className={`notif-channel ${active ? 'notif-channel-on' : ''}`.trim()}>
                    <div className="notif-channel-top">
                      <b>{CHANNEL_LABELS[channel.channel] || channel.channel}</b>
                      <span className={`badge badge-${active ? 'green' : channel.enabled ? 'red' : 'gray'}`}>
                        {channel.enabled ? (channel.configured ? 'Aktif' : 'Konfigurasi kurang') : 'Nonaktif'}
                      </span>
                    </div>
                    <small>
                      {channel.problem || (channel.enabled ? `Siap mengirim via ${channel.transport}` : 'Tidak mengirim ke luar aplikasi.')}
                    </small>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="section-divider">
            <h4><Send size={14} /> Riwayat pengiriman terakhir</h4>
          </div>
          {deliveries.length === 0 ? (
            <p className="panel-empty">
              {deliveryHint || 'Belum ada pengiriman eksternal. Riwayat akan muncul setelah channel diaktifkan dan ada notifikasi baru.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Channel</th>
                    <th>Status</th>
                    <th>Tujuan</th>
                    <th>Percobaan</th>
                    <th>Notifikasi</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((row) => (
                    <tr key={row.id}>
                      <td>{fmtDateTime(row.createdAt)}</td>
                      <td>{CHANNEL_LABELS[row.channel] || row.channel}</td>
                      <td>
                        <span className={`badge badge-${DELIVERY_TONES[row.status] || 'gray'}`}>
                          {DELIVERY_LABELS[row.status] || row.status}
                        </span>
                      </td>
                      <td>{row.target || '—'}</td>
                      <td>{row.attempts}/3</td>
                      <td>{row.notification?.title || '—'}</td>
                      <td className="muted">{row.detail || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari judul atau isi notifikasi..." />
          <div className="toolbar-selects">
            <button
              type="button"
              className={`btn btn-sm ${filters.unreadOnly ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilters({ ...filters, unreadOnly: !filters.unreadOnly })}
            >
              <BellRing size={13} /> Belum dibaca ({unreadCount})
            </button>
          </div>
        </div>

        <div className="filter-tabs notif-tabs">
          {TYPE_TABS.map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={`filter-tab ${filters.type === value ? 'filter-tab-active' : ''}`}
              onClick={() => setFilters({ ...filters, type: value })}
            >
              {label}
              <span>{counts[value] || 0}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="table-state">
            <Spinner /> Memuat notifikasi...
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="Tidak ada notifikasi">Notifikasi baru akan muncul di sini saat ada aktivitas.</EmptyState>
        ) : (
          <ul className="notif-page-list">
            {filtered.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`notif-page-item ${item.readAt ? '' : 'notif-unread'}`.trim()}
                  onClick={() => markRead(item)}
                >
                  <div className="notif-page-main">
                    <span className={`badge badge-${TYPE_TONES[item.type] || 'gray'}`}>
                      {TYPE_TABS.find(([value]) => value === item.type)?.[1] || item.type}
                    </span>
                    <b>{item.title}</b>
                    <p>{item.message}</p>
                  </div>
                  <div className="notif-page-meta">
                    <small>{fmtDateTime(item.createdAt)}</small>
                    {!item.readAt && <span className="notif-dot" aria-label="Belum dibaca" />}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

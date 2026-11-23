import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, CheckCheck, RefreshCw } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../api.js';
import { fmtDateTime } from '../format.js';
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

export default function Notifications() {
  const toast = useToast();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ type: 'ALL', unreadOnly: false, q: '' });
  const [busy, setBusy] = useState(false);

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
        eyebrow="INBOX"
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

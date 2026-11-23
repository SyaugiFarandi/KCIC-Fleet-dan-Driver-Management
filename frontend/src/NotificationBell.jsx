import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from './api.js';
import { fmtDateTime } from './format.js';

const TYPE_TONES = {
  BOOKING: 'blue',
  TRIP: 'purple',
  GPS_ALERT: 'red',
  DOCUMENT: 'amber',
  MAINTENANCE_DUE: 'amber',
};

const TYPE_LABELS = {
  BOOKING: 'Booking',
  TRIP: 'Perjalanan',
  GPS_ALERT: 'GPS Alert',
  DOCUMENT: 'Dokumen',
  MAINTENANCE_DUE: 'Maintenance',
};

export default function NotificationBell() {
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet('/notifications', { pageSize: 8 });
      setItems(data.items || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {
      /* bell stays silent if the API is unreachable */
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      if (!document.hidden) load();
    }, 60_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const openItem = async (item) => {
    setOpen(false);
    if (!item.readAt) {
      try {
        await apiPatch(`/notifications/${item.id}/read`, {});
      } catch {
        /* ignore */
      }
    }
    load();
    if (item.link) navigate(item.link);
  };

  const readAll = async () => {
    setBusy(true);
    try {
      await apiPost('/notifications/read-all');
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notif-bell" ref={containerRef}>
      <button
        type="button"
        className={`icon-btn notif-bell-btn ${open ? 'notif-bell-open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-label={`Notifikasi (${unreadCount} belum dibaca)`}
        title="Notifikasi"
      >
        <Bell size={17} />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-head">
            <b>Notifikasi</b>
            <button type="button" className="link-btn" onClick={readAll} disabled={busy || unreadCount === 0}>
              <CheckCheck size={13} /> Tandai semua dibaca
            </button>
          </div>
          {items.length === 0 ? (
            <p className="notif-empty">Belum ada notifikasi.</p>
          ) : (
            <ul className="notif-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`notif-item ${item.readAt ? '' : 'notif-unread'}`.trim()}
                    onClick={() => openItem(item)}
                  >
                    <span className={`badge badge-${TYPE_TONES[item.type] || 'gray'}`}>{TYPE_LABELS[item.type] || item.type}</span>
                    <span className="notif-item-title">{item.title}</span>
                    <small>{item.message}</small>
                    <small className="notif-time">{fmtDateTime(item.createdAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="notif-dropdown-foot">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setOpen(false);
                navigate('/notifications');
              }}
            >
              Lihat semua notifikasi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

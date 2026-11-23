import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, Search, X } from 'lucide-react';
import { fmtDateTime, statusLabel, statusTone } from './format.js';

export function Spinner({ size = 18 }) {
  return <Loader2 size={size} className="spin" aria-hidden="true" />;
}

export function Badge({ value, label, tone }) {
  if (value === undefined || value === null || value === '') return <span className="muted">—</span>;
  return <span className={`badge badge-${tone || statusTone(value)}`}>{label || statusLabel(value)}</span>;
}

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, onClick }) {
  const content = (
    <>
      <div className="stat-top">
        <span>{label}</span>
        {Icon && <Icon size={18} />}
      </div>
      <strong>{value ?? '—'}</strong>
      {hint && <small>{hint}</small>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="stat-card stat-card-link" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="stat-card">{content}</div>;
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`.trim()}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message;
  const details = typeof error === 'string' ? [] : error.details || [];
  return (
    <div className="error-banner" role="alert">
      <AlertCircle size={18} />
      <div>
        <b>{message}</b>
        {details.length > 0 && (
          <ul>
            {details.map((detail, index) => (
              <li key={index}>{detail}</li>
            ))}
          </ul>
        )}
      </div>
      {onDismiss && (
        <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Tutup peringatan">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Cari data...' }) {
  return (
    <div className="search-box">
      <Search size={15} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function DataTable({ columns, rows, loading, empty = 'Belum ada data untuk ditampilkan.' }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length}>
                <div className="table-state">
                  <Spinner /> Memuat data...
                </div>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <div className="table-state">{empty}</div>
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={row.id ?? index}>
                {columns.map((column) => (
                  <td key={column.key}>{column.render ? column.render(row) : row[column.key] ?? '—'}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({ title = 'Tidak ada data', children }) {
  return (
    <div className="empty-state">
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, footer, size }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className={`modal ${size === 'lg' ? 'modal-lg' : ''}`.trim()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {onClose && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Tutup">
              <X size={17} />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (message, tone = 'success') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((current) => [...current, { id, message, tone }]);
      window.setTimeout(() => remove(id), 4500);
    },
    [remove]
  );

  const toast = useMemo(
    () => ({
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error'),
      info: (message) => push(message, 'info'),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`}>
            {item.tone === 'success' ? <CheckCircle2 size={17} /> : item.tone === 'error' ? <AlertCircle size={17} /> : <Info size={17} />}
            <span>{item.message}</span>
            <button type="button" onClick={() => remove(item.id)} aria-label="Tutup notifikasi">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolverRef.current = resolve;
        setRequest(typeof options === 'string' ? { message: options } : options);
      }),
    []
  );

  const close = (result) => {
    setRequest(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(result);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <Modal
          title={request.title || 'Konfirmasi'}
          onClose={() => close(false)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
                Batal
              </button>
              <button
                type="button"
                className={`btn ${request.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => close(true)}
              >
                {request.confirmLabel || 'Lanjutkan'}
              </button>
            </>
          }
        >
          <p className="confirm-text">{request.message}</p>
          {request.detail && <p className="muted">{request.detail}</p>}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used inside ConfirmProvider');
  return context;
}

export function Timeline({ events }) {
  if (!events?.length) return <p className="muted">Belum ada riwayat aktivitas.</p>;
  return (
    <ol className="timeline">
      {events.map((event) => (
        <li key={event.id}>
          <span className="timeline-dot" />
          <div>
            <b>{statusLabel(event.status)}</b>
            <small>{event.note || '—'}</small>
            <small className="timeline-meta">
              {event.actor?.name || 'Sistem'} · {fmtDateTime(event.createdAt)}
            </small>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function DetailItem({ label, children, className = '' }) {
  return (
    <div className={`detail-item ${className}`.trim()}>
      <span>{label}</span>
      <div>{children ?? '—'}</div>
    </div>
  );
}

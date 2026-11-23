import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, Search, SlidersHorizontal, WifiOff, X } from 'lucide-react';
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

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`field ${error ? 'field-invalid' : ''} ${className}`.trim()}>
      <span>{label}</span>
      {children}
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
      {!error && hint && <small>{hint}</small>}
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

export function DataTable({
  columns,
  rows,
  loading,
  empty = 'Belum ada data untuk ditampilkan.',
  emptyAction,
  skeletonRows = 5,
  pageSize = 0,
  selectable = false,
  selectedIds,
  onSelect,
  rowKey = (row, index) => row.id ?? index,
}) {
  const [page, setPage] = useState(0);
  const total = rows.length;
  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const visibleRows = pageSize > 0 ? rows.slice(safePage * pageSize, safePage * pageSize + pageSize) : rows;
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  const pageKeys = visibleRows.map((row, index) => String(rowKey(row, safePage * pageSize + index)));
  const allSelected = pageKeys.length > 0 && pageKeys.every((key) => selected.has(key));
  const columnCount = columns.length + (selectable ? 1 : 0);

  const toggleAll = () => {
    if (!onSelect) return;
    const next = new Set(selected);
    if (allSelected) pageKeys.forEach((key) => next.delete(key));
    else pageKeys.forEach((key) => next.add(key));
    onSelect(next);
  };

  const toggleOne = (key) => {
    if (!onSelect) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelect(next);
  };

  return (
    <div className="data-table">
      <div className="table-wrap" role="region" aria-label="Tabel data" tabIndex={0}>
        <table>
          <thead>
            <tr>
              {selectable && (
                <th className="cell-select">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Pilih semua baris di halaman ini"
                    disabled={loading || visibleRows.length === 0}
                  />
                </th>
              )}
              {columns.map((column) => (
                <th key={column.key} className={column.className}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: skeletonRows }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`} className="skeleton-row" aria-hidden="true">
                  {selectable && <td className="cell-select" />}
                  {columns.map((column, columnIndex) => (
                    <td key={column.key}>
                      <span className={`skeleton skeleton-text ${columnIndex === 0 ? 'skeleton-text-wide' : ''}`.trim()} />
                    </td>
                  ))}
                </tr>
              ))
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columnCount}>
                  <div className="table-state">
                    <span>{empty}</span>
                    {emptyAction && <div className="table-state-action">{emptyAction}</div>}
                  </div>
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => {
                const key = String(rowKey(row, safePage * pageSize + index));
                return (
                  <tr key={key} className={selected.has(key) ? 'row-selected' : undefined}>
                    {selectable && (
                      <td className="cell-select">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggleOne(key)}
                          aria-label="Pilih baris"
                        />
                      </td>
                    )}
                    {columns.map((column) => (
                      <td key={column.key} className={column.className}>
                        {column.render ? column.render(row) : row[column.key] ?? '—'}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {pageSize > 0 && !loading && total > pageSize && (
        <div className="table-pager">
          <span>
            Menampilkan {safePage * pageSize + 1}–{Math.min(total, (safePage + 1) * pageSize)} dari {total}
          </span>
          <div className="table-pager-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={safePage === 0}
              aria-label="Halaman sebelumnya"
            >
              <ChevronLeft size={14} /> Sebelumnya
            </button>
            <span className="table-pager-page">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              disabled={safePage >= pageCount - 1}
              aria-label="Halaman berikutnya"
            >
              Berikutnya <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ColumnPicker({ columns, hidden, onChange, storageLabel = 'kolom' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div className="column-picker" ref={ref}>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <SlidersHorizontal size={14} /> Kolom
      </button>
      {open && (
        <div className="column-picker-menu" role="group" aria-label={`Atur ${storageLabel} tabel`}>
          {columns.map((column) => (
            <label key={column.key} className="column-picker-item">
              <input
                type="checkbox"
                checked={!hidden[column.key]}
                onChange={() => onChange({ ...hidden, [column.key]: !hidden[column.key] })}
              />
              <span>{column.label}</span>
            </label>
          ))}
        </div>
      )}
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
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    const previousFocus = document.activeElement;
    const getFocusable = () =>
      Array.from(
        panel?.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      );
    const initial =
      panel?.querySelector('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])') ||
      getFocusable()[0] ||
      panel;
    initial?.focus();

    const onKey = (event) => {
      if (event.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = getFocusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        className={`modal ${size === 'lg' ? 'modal-lg' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-head">
          <div>
            <h3 id={titleId}>{title}</h3>
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
    (message, tone = 'success', options = {}) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const action = options.action
        ? {
            label: options.action.label || 'Urungkan',
            run: () => {
              remove(id);
              options.action.onClick?.();
            },
          }
        : null;
      setToasts((current) => [...current.slice(-3), { id, message, tone, action }]);
      window.setTimeout(() => remove(id), options.duration ?? (action ? 8000 : 4500));
    },
    [remove]
  );

  const toast = useMemo(
    () => ({
      success: (message, options) => push(message, 'success', options),
      error: (message, options) => push(message, 'error', options),
      info: (message, options) => push(message, 'info', options),
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
            {item.action && (
              <button type="button" className="toast-action" onClick={item.action.run}>
                {item.action.label}
              </button>
            )}
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

export function useLocalStorageState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? (typeof initialValue === 'function' ? initialValue() : initialValue) : JSON.parse(stored);
    } catch {
      return typeof initialValue === 'function' ? initialValue() : initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked */
    }
  }, [key, value]);

  return [value, setValue];
}

export function useUnsavedGuard(dirty) {
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  const [justBack, setJustBack] = useState(false);
  const wasOffline = useRef(!online);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return undefined;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      setJustBack(true);
      const timer = window.setTimeout(() => setJustBack(false), 3500);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [online]);

  if (online && !justBack) return null;
  return (
    <div className={`network-banner ${online ? 'network-banner-ok' : ''}`.trim()} role="status" aria-live="polite">
      <WifiOff size={15} />
      {online ? 'Koneksi kembali tersedia.' : 'Anda sedang offline. Data terakhir yang dimuat tetap bisa dilihat, aksi tulis akan gagal sampai koneksi pulih.'}
    </div>
  );
}

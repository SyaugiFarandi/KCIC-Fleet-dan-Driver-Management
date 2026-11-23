import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { fmtDateTime } from '../format.js';
import { Badge, DataTable, ErrorBanner, PageHeader, SearchBox } from '../ui.jsx';

export default function Audit() {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ actions: [], entities: [] });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', action: '', entity: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('/audit', { query: { pageSize: 200 } });
      setItems(result.items || []);
      setTotal(result.total || 0);
      setMeta(result.filters || { actions: [], entities: [] });
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

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter((entry) => {
      if (filters.action && entry.action !== filters.action) return false;
      if (filters.entity && entry.entity !== filters.entity) return false;
      if (!q) return true;
      return [entry.detail, entry.entityId, entry.user?.name, entry.user?.email, entry.action]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [items, filters]);

  const columns = [
    { key: 'createdAt', label: 'Waktu', render: (entry) => fmtDateTime(entry.createdAt) },
    {
      key: 'user',
      label: 'Pengguna',
      render: (entry) => (
        <div className="cell-stack">
          <b>{entry.user?.name || 'Sistem'}</b>
          <small>{entry.user?.email || '—'}</small>
        </div>
      ),
    },
    { key: 'action', label: 'Aksi', render: (entry) => <b>{entry.action}</b> },
    { key: 'entity', label: 'Entitas', render: (entry) => <Badge value={entry.entity} tone="gray" label={entry.entity} /> },
    { key: 'detail', label: 'Detail', render: (entry) => entry.detail || '—' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="SECURITY & TRACEABILITY"
        title="Audit Aktivitas"
        subtitle={`Jejak perubahan data dan aktivitas login. Menampilkan ${items.length} dari ${total} catatan terbaru.`}
        actions={
          <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari detail, pengguna, entitas..." />
          <div className="toolbar-selects">
            <select value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })}>
              <option value="">Semua aksi</option>
              {meta.actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
            <select value={filters.entity} onChange={(event) => setFilters({ ...filters, entity: event.target.value })}>
              <option value="">Semua entitas</option>
              {meta.entities.map((entity) => (
                <option key={entity} value={entity}>
                  {entity}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DataTable columns={columns} rows={filtered} loading={loading} empty="Tidak ada aktivitas audit sesuai filter." />
      </div>
    </>
  );
}

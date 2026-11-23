import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, apiDelete, apiPatch, apiPost } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ROLE_LABELS, roleLabel } from '../permissions.js';
import { Badge, DataTable, ErrorBanner, Field, Modal, PageHeader, SearchBox, useConfirm, useToast } from '../ui.jsx';

const emptyForm = () => ({
  name: '',
  email: '',
  password: '',
  role: 'CREW_EMPLOYEE',
  department: '',
  phone: '',
  active: true,
});

export default function Users() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', role: '', active: '' });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('/users', { query: { pageSize: 200 } });
      setItems(result.items || []);
      setRoles(result.roles || []);
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
    return items.filter((item) => {
      if (filters.role && item.role !== filters.role) return false;
      if (filters.active && String(item.active) !== filters.active) return false;
      if (!q) return true;
      return [item.name, item.email, item.department, item.phone].join(' ').toLowerCase().includes(q);
    });
  }, [items, filters]);

  const openCreate = () => {
    setForm(emptyForm());
    setModal({ type: 'create' });
  };

  const openEdit = (target) => {
    setForm({
      name: target.name,
      email: target.email,
      password: '',
      role: target.role,
      department: target.department || '',
      phone: target.phone || '',
      active: target.active,
    });
    setModal({ type: 'edit', target });
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (modal.type === 'create') {
        await apiPost('/users', {
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
          department: form.department.trim() || null,
          phone: form.phone.trim() || null,
        });
        toast.success('Pengguna dibuat.');
      } else {
        await apiPatch(`/users/${modal.target.id}`, {
          name: form.name.trim(),
          role: form.role,
          department: form.department.trim() || null,
          phone: form.phone.trim() || null,
          active: Boolean(form.active),
          ...(form.password ? { password: form.password } : {}),
        });
        toast.success('Data pengguna diperbarui.');
      }
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target) => {
    const ok = await confirm({
      title: 'Hapus pengguna?',
      message: `Akun ${target.email} akan dihapus permanen. Akun dengan riwayat aktivitas tidak dapat dihapus.`,
      confirmLabel: 'Hapus',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiDelete(`/users/${target.id}`);
      toast.success('Pengguna dihapus.');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    { key: 'name', label: 'Nama', render: (item) => <b>{item.name}</b> },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role', render: (item) => <Badge value={item.role} tone="purple" label={roleLabel(item.role)} /> },
    { key: 'department', label: 'Departemen', render: (item) => item.department || '—' },
    { key: 'phone', label: 'Telepon', render: (item) => item.phone || '—' },
    {
      key: 'active',
      label: 'Status',
      render: (item) => <Badge value={item.active ? 'ACTIVE' : 'INACTIVE'} label={item.active ? 'Aktif' : 'Nonaktif'} />,
    },
    {
      key: 'actions',
      label: 'Aksi',
      render: (item) => (
        <div className="row-actions">
          <button type="button" className="icon-btn" title="Ubah" onClick={() => openEdit(item)}>
            <Pencil size={15} />
          </button>
          <button
            type="button"
            className="icon-btn icon-bad"
            title={item.id === user.id ? 'Tidak dapat menghapus akun sendiri' : 'Hapus'}
            disabled={item.id === user.id}
            onClick={() => remove(item)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  const editingSelf = modal?.type === 'edit' && modal.target.id === user.id;

  return (
    <>
      <PageHeader
        eyebrow="Kontrol akses"
        title="Pengguna & Role"
        subtitle="Kelola akun, role, dan status aktif pengguna. Hak akses per role juga ditegakkan di API."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={15} /> Tambah Pengguna
            </button>
          </>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="panel">
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Cari nama, email, departemen..." />
          <div className="toolbar-selects">
            <select value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}>
              <option value="">Semua role</option>
              {roles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <select value={filters.active} onChange={(event) => setFilters({ ...filters, active: event.target.value })}>
              <option value="">Semua status</option>
              <option value="true">Aktif</option>
              <option value="false">Nonaktif</option>
            </select>
          </div>
        </div>
        <DataTable columns={columns} rows={filtered} loading={loading} empty="Tidak ada pengguna sesuai filter." />
      </div>

      {modal && (
        <Modal
          title={modal.type === 'create' ? 'Tambah Pengguna' : `Ubah ${modal.target.name}`}
          subtitle={modal.type === 'create' ? 'Password minimal 8 karakter.' : 'Kosongkan password jika tidak ingin mengubahnya.'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Batal
              </button>
              <button type="submit" form="user-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Simpan'}
              </button>
            </>
          }
        >
          <form id="user-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Nama Lengkap">
                <input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <Field label="Email">
                <input
                  required
                  type="email"
                  value={form.email}
                  disabled={modal.type === 'edit'}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </Field>
              <Field label={modal.type === 'create' ? 'Password' : 'Password Baru (opsional)'}>
                <input
                  required={modal.type === 'create'}
                  minLength={8}
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
              </Field>
              <Field label="Role" hint={editingSelf ? 'Anda tidak dapat menurunkan role akun sendiri.' : undefined}>
                <select value={form.role} disabled={editingSelf} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                  {roles.length
                    ? roles.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))
                    : Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                </select>
              </Field>
              <Field label="Departemen">
                <input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} />
              </Field>
              <Field label="Telepon">
                <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              </Field>
              {modal.type === 'edit' && (
                <Field label="Status" hint={editingSelf ? 'Anda tidak dapat menonaktifkan akun sendiri.' : undefined}>
                  <div className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={form.active}
                      disabled={editingSelf}
                      onChange={(event) => setForm({ ...form, active: event.target.checked })}
                    />
                    <span>Akun aktif</span>
                  </div>
                </Field>
              )}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

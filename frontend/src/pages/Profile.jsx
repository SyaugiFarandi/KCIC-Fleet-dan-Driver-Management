import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { roleLabel } from '../permissions.js';
import { ErrorBanner, Field, PageHeader, useToast } from '../ui.jsx';

export default function Profile() {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    if (form.newPassword.length < 8) {
      setError({ message: 'Password baru minimal 8 karakter.' });
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError({ message: 'Konfirmasi password tidak cocok.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', {
        method: 'PATCH',
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      });
      toast.success('Password berhasil diubah.');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Akun" title="Profil Saya" subtitle="Informasi akun dan pengaturan keamanan." />

      <div className="profile-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Informasi Akun</h3>
              <p>Data akun yang sedang digunakan</p>
            </div>
          </div>
          <div className="profile-card">
            <div className="avatar avatar-lg">{user.name?.[0]?.toUpperCase() || 'U'}</div>
            <div>
              <h4>{user.name}</h4>
              <p>{user.email}</p>
              <span className="role-chip">{roleLabel(user.role)}</span>
            </div>
          </div>
          <dl className="profile-details">
            <div>
              <dt>Departemen</dt>
              <dd>{user.department || '—'}</dd>
            </div>
            <div>
              <dt>Telepon</dt>
              <dd>{user.phone || '—'}</dd>
            </div>
            <div>
              <dt>ID Pengguna</dt>
              <dd>{user.id}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{user.active ? 'Aktif' : 'Nonaktif'}</dd>
            </div>
          </dl>
          <div className="info-note">
            <ShieldCheck size={17} />
            <p>Hak akses ditentukan oleh role dan diperiksa di backend pada setiap permintaan API.</p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Ubah Password</h3>
              <p>Gunakan password baru minimal 8 karakter</p>
            </div>
            <KeyRound size={19} className="panel-icon" />
          </div>
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
          <form onSubmit={submit}>
            <Field label="Password Saat Ini">
              <input
                required
                type="password"
                autoComplete="current-password"
                value={form.currentPassword}
                onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
              />
            </Field>
            <Field label="Password Baru">
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={form.newPassword}
                onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
              />
            </Field>
            <Field label="Konfirmasi Password Baru">
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
              />
            </Field>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Menyimpan...' : 'Simpan Password'}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}

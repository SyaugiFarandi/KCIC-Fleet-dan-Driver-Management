import { useState } from 'react';
import { BellRing, KeyRound, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { roleLabel } from '../permissions.js';
import { ErrorBanner, Field, PageHeader, useToast } from '../ui.jsx';

const NOTIFICATION_OPTIONS = [
  ['BOOKING', 'Booking', 'Persetujuan, penolakan, pembatalan, dan seri booking.'],
  ['TRIP', 'Perjalanan', 'Penugasan, perubahan driver/kendaraan, dan status trip.'],
  ['GPS_ALERT', 'Peringatan GPS', 'Overspeed, deviasi rute, geofence, dan perangkat offline.'],
  ['DOCUMENT', 'Dokumen', 'STNK, asuransi, dan SIM yang mendekati kedaluwarsa.'],
  ['MAINTENANCE_DUE', 'Jadwal perawatan', 'Perawatan terjadwal dalam tiga hari ke depan.'],
];

export default function Profile() {
  const { user, updatePreferences } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [types, setTypes] = useState(() => user.notificationTypes || NOTIFICATION_OPTIONS.map(([value]) => value));
  const [prefsBusy, setPrefsBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const errors = {};
    if (!form.currentPassword) errors.currentPassword = 'Password saat ini wajib diisi.';
    if (form.newPassword.length < 8) errors.newPassword = 'Password baru minimal 8 karakter.';
    if (form.newPassword !== form.confirmPassword) errors.confirmPassword = 'Konfirmasi password tidak cocok.';
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

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

  const toggleType = (value) => {
    setTypes((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  };

  const savePreferences = async () => {
    setPrefsBusy(true);
    try {
      await updatePreferences(types);
      toast.success('Preferensi notifikasi disimpan.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPrefsBusy(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Akun" title="Profil Saya" subtitle="Informasi akun, keamanan sesi, dan preferensi notifikasi." />

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
            <p>Hak akses ditentukan oleh role dan diperiksa di backend pada setiap permintaan API. Sesi login disimpan sebagai cookie httpOnly.</p>
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
          <form onSubmit={submit} noValidate>
            <Field label="Password Saat Ini" error={fieldErrors.currentPassword}>
              <input
                required
                type="password"
                autoComplete="current-password"
                value={form.currentPassword}
                onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
              />
            </Field>
            <Field label="Password Baru" error={fieldErrors.newPassword} hint={fieldErrors.newPassword ? undefined : 'Minimal 8 karakter.'}>
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={form.newPassword}
                onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
              />
            </Field>
            <Field label="Konfirmasi Password Baru" error={fieldErrors.confirmPassword}>
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

      <section className="panel prefs-panel">
        <div className="panel-head">
          <div>
            <h3>Preferensi Notifikasi</h3>
            <p>Pilih jenis notifikasi yang ingin ditampilkan pada lonceng dan halaman Notifikasi.</p>
          </div>
          <BellRing size={19} className="panel-icon" />
        </div>
        <div className="prefs-grid">
          {NOTIFICATION_OPTIONS.map(([value, label, hint]) => (
            <label key={value} className="prefs-item">
              <input type="checkbox" checked={types.includes(value)} onChange={() => toggleType(value)} />
              <div>
                <b>{label}</b>
                <small>{hint}</small>
              </div>
            </label>
          ))}
        </div>
        <div className="prefs-actions">
          <span className="muted">{types.length === 0 ? 'Semua jenis dimatikan: lonceng tidak akan menampilkan notifikasi.' : `${types.length} dari ${NOTIFICATION_OPTIONS.length} jenis aktif.`}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={savePreferences} disabled={prefsBusy}>
            {prefsBusy ? 'Menyimpan...' : 'Simpan Preferensi'}
          </button>
        </div>
      </section>
    </>
  );
}

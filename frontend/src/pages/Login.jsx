import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarCheck, Eye, EyeOff, ShieldCheck, Truck, Users } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { ErrorBanner, Spinner } from '../ui.jsx';

const DEMO_ACCOUNTS = [
  { label: 'System Admin', email: 'admin@demo.local', desc: 'Akses penuh, pengguna & audit' },
  { label: 'Fleet Manager', email: 'fleet@demo.local', desc: 'Armada, driver, approval booking' },
  { label: 'Dispatcher', email: 'dispatch@demo.local', desc: 'Penugasan & status perjalanan' },
  { label: 'Crew Employee', email: 'employee@demo.local', desc: 'Membuat booking transportasi' },
  { label: 'Driver', email: 'driver@demo.local', desc: 'Perjalanan yang ditugaskan' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const loggedIn = await login(form.email.trim(), form.password);
      navigate(loggedIn.role === 'DRIVER' ? '/driver' : '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const fill = (email) => {
    setForm({ email, password: 'Demo123!' });
    setShowPassword(false);
    setError(null);
  };

  return (
    <div className="login-page">
      <section className="login-brand">
        <div className="login-brand-inner">
          <div className="brand">
            <div className="brand-mark brand-mark-lg">W</div>
            <div className="brand-text">
              <b>WHOOSH</b>
              <small>Fleet management</small>
            </div>
          </div>
          <p className="eyebrow">Demo operasi armada KCIC</p>
          <h1>
            Fleet &amp; Driver
            <br />
            Management
          </h1>
          <p className="login-lead">
            Aplikasi demo pengelolaan armada, driver, booking transportasi, penugasan perjalanan, dan perawatan kendaraan
            dalam satu platform.
          </p>
          <ul className="login-points">
            <li>
              <CalendarCheck size={17} /> Booking → approval → dispatch → trip → selesai
            </li>
            <li>
              <Truck size={17} /> Cek bentrok jadwal kendaraan &amp; driver saat penugasan
            </li>
            <li>
              <Users size={17} /> Hak akses per role diterapkan di API backend
            </li>
            <li>
              <ShieldCheck size={17} /> Audit log untuk setiap perubahan data
            </li>
          </ul>
          <p className="login-note">Lingkungan demonstrasi. Seluruh data adalah data dummy, bukan data resmi KCIC.</p>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <p className="eyebrow">Masuk ke workspace</p>
          <h2>Selamat datang kembali</h2>
          <p className="muted">Gunakan akun demo di bawah atau masukkan kredensial Anda.</p>

          <ErrorBanner error={error} onDismiss={() => setError(null)} />

          <form onSubmit={submit} className="login-form">
            <label className="field">
              <span>Email</span>
              <input
                required
                autoFocus
                type="email"
                autoComplete="username"
                placeholder="admin@demo.local"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
            <div className="field">
              <label className="field-label" htmlFor="login-password">Kata sandi</label>
              <span className="password-wrap">
                <input
                  id="login-password"
                  required
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Demo123!"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? <Spinner size={16} /> : <ArrowRight size={16} />}
              {busy ? 'Memproses...' : 'Masuk ke dashboard'}
            </button>
          </form>

          <div className="demo-accounts">
            <p className="demo-accounts-title">Akun demo (kata sandi: Demo123!)</p>
            <div className="demo-account-grid">
              {DEMO_ACCOUNTS.map((account) => (
                <button type="button" key={account.email} className="demo-account" onClick={() => fill(account.email)}>
                  <b>{account.label}</b>
                  <small>{account.email}</small>
                  <span>{account.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

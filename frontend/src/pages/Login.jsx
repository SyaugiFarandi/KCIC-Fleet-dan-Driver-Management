import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarCheck,
  ClipboardCheck,
  Eye,
  EyeOff,
  Mail,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { ErrorBanner, Spinner } from '../ui.jsx';

const DEMO_ACCOUNTS = [
  { label: 'System Admin', initials: 'SA', email: 'admin@demo.local', desc: 'Akses penuh, pengguna & audit' },
  { label: 'Fleet Manager', initials: 'FM', email: 'fleet@demo.local', desc: 'Armada, driver, approval booking' },
  { label: 'Dispatcher', initials: 'DI', email: 'dispatch@demo.local', desc: 'Penugasan & status perjalanan' },
  { label: 'Crew Employee', initials: 'CE', email: 'employee@demo.local', desc: 'Membuat booking transportasi' },
  { label: 'Driver', initials: 'DR', email: 'driver@demo.local', desc: 'Perjalanan yang ditugaskan' },
];

const CAPABILITIES = [
  { icon: CalendarCheck, title: 'Booking & dispatch', text: 'Permintaan, approval, penugasan kendaraan dan driver.' },
  { icon: Radio, title: 'Monitoring GPS', text: 'Posisi simulasi, replay perjalanan, dan geofence DEMO.' },
  { icon: ClipboardCheck, title: 'Inspeksi & BBM', text: 'Checklist kendaraan, defect, dan pencatatan bahan bakar.' },
  { icon: ShieldCheck, title: 'RBAC & audit', text: 'Hak akses per role di API dan jejak audit perubahan.' },
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
      <section className="login-brand" aria-label="Tentang aplikasi">
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
            Satu alur kerja untuk
            <br />
            armada dan driver.
          </h1>
          <p className="login-lead">
            Booking transportasi, penugasan kendaraan, eksekusi perjalanan, inspeksi, dan bahan bakar — terhubung dalam
            satu platform dengan hak akses yang dijaga di backend.
          </p>

          <ul className="login-capabilities">
            {CAPABILITIES.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <span className="login-capability-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span>
                  <b>{title}</b>
                  <small>{text}</small>
                </span>
              </li>
            ))}
          </ul>

          <div className="login-demo-note">
            <span className="login-demo-tag">DEMO</span>
            <p>
              Lingkungan demonstrasi dengan data sintetis. Bukan data operasional resmi KCIC; GPS memakai simulator
              lokal.
            </p>
          </div>
        </div>
      </section>

      <section className="login-panel" aria-label="Form masuk">
        <div className="login-card">
          <div className="login-card-head">
            <div className="login-mobile-brand" aria-hidden="true">
              <span className="brand-mark">W</span>
              <b>WHOOSH</b>
            </div>
            <p className="eyebrow">Masuk ke workspace</p>
            <h2>Selamat datang kembali</h2>
            <p className="muted">Masukkan kredensial akun, atau pilih salah satu akun demo di bawah.</p>
          </div>

          <ErrorBanner error={error} onDismiss={() => setError(null)} />

          <form onSubmit={submit} className="login-form" noValidate={false}>
            <div className="field">
              <label className="field-label" htmlFor="login-email">Email</label>
              <span className="login-input">
                <Mail size={16} aria-hidden="true" />
                <input
                  id="login-email"
                  required
                  autoFocus
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  placeholder="nama@demo.local"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="login-password">Kata sandi</label>
              <span className="login-input">
                <ShieldCheck size={16} aria-hidden="true" />
                <input
                  id="login-password"
                  required
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Kata sandi akun"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  aria-pressed={showPassword}
                  aria-controls="login-password"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </div>

            <button type="submit" className="btn btn-primary btn-block login-submit" disabled={busy}>
              {busy ? <Spinner size={16} /> : <ArrowRight size={16} />}
              {busy ? 'Memproses...' : 'Masuk ke dashboard'}
            </button>
          </form>

          <div className="demo-accounts">
            <div className="demo-accounts-head">
              <p className="demo-accounts-title">Akun demo</p>
              <span className="demo-password-chip">Sandi: Demo123!</span>
            </div>
            <p className="demo-accounts-hint">Pilih akun untuk mengisi formulir otomatis.</p>
            <div className="demo-account-grid">
              {DEMO_ACCOUNTS.map((account) => (
                <button type="button" key={account.email} className="demo-account" onClick={() => fill(account.email)}>
                  <span className="demo-account-avatar" aria-hidden="true">{account.initials}</span>
                  <span className="demo-account-text">
                    <b>{account.label}</b>
                    <small>{account.email}</small>
                    <span>{account.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

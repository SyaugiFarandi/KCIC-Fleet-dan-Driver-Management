import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  BarChart3,
  Bell,
  Car,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Moon,
  Route as RouteIcon,
  Satellite,
  Search,
  ShieldCheck,
  Sun,
  Truck,
  UserCircle,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import CommandPalette, { ShortcutsOverlay } from './CommandPalette.jsx';
import NotificationBell from './NotificationBell.jsx';
import { AuthProvider, useAuth } from './auth.jsx';
import { can, isStaff, roleLabel } from './permissions.js';
import { ConfirmProvider, OfflineBanner, Spinner, ToastProvider } from './ui.jsx';

const Login = lazy(() => import('./pages/Login.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Bookings = lazy(() => import('./pages/Bookings.jsx'));
const Trips = lazy(() => import('./pages/Trips.jsx'));
const GpsMonitoring = lazy(() => import('./pages/GpsMonitoring.jsx'));
const Vehicles = lazy(() => import('./pages/Vehicles.jsx'));
const Drivers = lazy(() => import('./pages/Drivers.jsx'));
const Vendors = lazy(() => import('./pages/Vendors.jsx'));
const RoutesPage = lazy(() => import('./pages/RoutesPage.jsx'));
const Maintenance = lazy(() => import('./pages/Maintenance.jsx'));
const Audit = lazy(() => import('./pages/Audit.jsx'));
const UsersPage = lazy(() => import('./pages/Users.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

const NAV_SECTIONS = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, visible: () => true },
      { to: '/bookings', label: 'Booking', icon: ClipboardList, visible: () => true },
      { to: '/trips', label: 'Perjalanan', icon: RouteIcon, visible: (role) => isStaff(role) || role === 'DRIVER' },
      { to: '/gps', label: 'GPS Monitoring', icon: Satellite, visible: (role) => can(role, 'gps:read') },
      { to: '/vehicles', label: 'Kendaraan', icon: Car, visible: (role) => can(role, 'vehicles:read') },
      { to: '/drivers', label: 'Driver', icon: Users, visible: (role) => can(role, 'drivers:read') },
      { to: '/vendors', label: 'Vendor', icon: Truck, visible: (role) => can(role, 'vendors:read') },
      { to: '/routes', label: 'Rute', icon: MapPin, visible: (role) => can(role, 'routes:read') },
      { to: '/maintenance', label: 'Maintenance', icon: Wrench, visible: (role) => can(role, 'maintenance:read') },
      { to: '/reports', label: 'Laporan', icon: BarChart3, visible: (role) => can(role, 'reports:read') },
    ],
  },
  {
    label: 'Governance',
    items: [
      { to: '/audit', label: 'Audit Log', icon: FileText, visible: (role) => can(role, 'audit:read') },
      { to: '/users', label: 'Pengguna', icon: ShieldCheck, visible: (role) => can(role, 'users:manage') },
      { to: '/notifications', label: 'Notifikasi', icon: Bell, visible: () => true },
      { to: '/profile', label: 'Profil', icon: UserCircle, visible: () => true },
    ],
  },
];

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('fleet_theme') || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('fleet_theme', theme);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? 'dark' : 'light');
  }, [theme]);
  const toggle = useCallback(() => setTheme((value) => (value === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
}

function FullPageLoader() {
  return (
    <div className="full-loading">
      <div className="brand-mark">W</div>
      <Spinner size={26} />
      <p>Menyiapkan sesi...</p>
    </div>
  );
}

function PageFallback() {
  return (
    <div className="panel page-skeleton" role="status" aria-live="polite">
      <span className="skeleton skeleton-title" />
      <span className="skeleton skeleton-text" />
      <span className="skeleton skeleton-text" />
      <span className="skeleton skeleton-block" />
    </div>
  );
}

function LazyPage({ children }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

function Guard({ allow, children }) {
  const { user } = useAuth();
  if (typeof allow === 'function' && !allow(user?.role)) return <NoAccess />;
  return children;
}

function NoAccess() {
  return (
    <section className="panel fallback-panel">
      <span className="fallback-code">403</span>
      <h3>Akses ditolak</h3>
      <p className="muted">
        Role Anda tidak memiliki izin untuk membuka halaman ini. Pembatasan yang sama juga ditegakkan di API backend, bukan hanya di antarmuka.
      </p>
      <NavLink className="btn btn-primary" to="/">
        Kembali ke Dashboard
      </NavLink>
    </section>
  );
}

function SessionExpiredModal() {
  const { sessionExpired, dismissSessionExpired } = useAuth();
  const navigate = useNavigate();
  if (!sessionExpired) return null;
  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal session-modal" role="alertdialog" aria-modal="true" aria-labelledby="session-title">
        <div className="modal-head">
          <div>
            <h3 id="session-title">Sesi Anda telah berakhir</h3>
            <p>Demi keamanan, sesi login berakhir otomatis. Silakan masuk kembali untuk melanjutkan.</p>
          </div>
        </div>
        <div className="modal-body">
          <p className="muted">
            Sesi disimpan sebagai cookie httpOnly, sehingga token tidak dapat dibaca JavaScript. Data yang belum tersimpan perlu diisi ulang.
          </p>
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              dismissSessionExpired();
              navigate('/login', { replace: true });
            }}
          >
            Masuk lagi
          </button>
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  const { user, logout, bootstrapping } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  useEffect(() => {
    const onKey = (event) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.key === '?' && !typing) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        toggleTheme();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleTheme]);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('shortcuts') === '1') setShortcutsOpen(true);
  }, [location.search]);

  const activeItem = useMemo(() => {
    const items = NAV_SECTIONS.flatMap((section) => section.items);
    return (
      items.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))) ||
      items[0]
    );
  }, [location.pathname]);

  if (bootstrapping) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.visible(user.role)),
  })).filter((section) => section.items.length > 0);

  const bottomItems = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/bookings', label: 'Booking', icon: ClipboardList },
    ...(isStaff(user.role) || user.role === 'DRIVER' ? [{ to: '/trips', label: 'Trip', icon: RouteIcon }] : []),
    ...(can(user.role, 'gps:read') ? [{ to: '/gps', label: 'GPS', icon: Satellite }] : []),
    { to: '/notifications', label: 'Notifikasi', icon: Bell },
    { to: '/profile', label: 'Profil', icon: UserCircle },
  ].slice(0, 5);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Lewati ke konten utama
      </a>
      {sidebarOpen && (
        <button type="button" className="sidebar-backdrop" aria-label="Tutup menu" onClick={() => setSidebarOpen(false)} />
      )}
      <aside id="app-sidebar" className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">W</div>
          <div className="brand-text">
            <b>WHOOSH</b>
            <small>Fleet management</small>
          </div>
          <button type="button" className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Tutup menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Navigasi utama">
          {sections.map((section) => (
            <div className="nav-section" key={section.label}>
              <p className="nav-caption">{section.label}</p>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav ${isActive ? 'nav-active' : ''}`}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="demo-tag">Lingkungan demo, data dummy</div>
          <div className="sidebar-user">
            <div className="avatar">{user.name?.[0]?.toUpperCase() || 'U'}</div>
            <div className="sidebar-user-text">
              <b>{user.name}</b>
              <small>{roleLabel(user.role)}</small>
            </div>
            <button type="button" title="Keluar" aria-label="Keluar dari akun" onClick={handleLogout}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-btn mobile-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="Buka menu"
              aria-expanded={sidebarOpen}
              aria-controls="app-sidebar"
            >
              <Menu size={20} />
            </button>
            <div className="crumb">
              <span>Fleet Ops</span>
              <b>{activeItem?.label || 'Dashboard'}</b>
            </div>
          </div>
          <div className="topbar-right">
            <button type="button" className="palette-trigger" onClick={() => setPaletteOpen(true)} aria-label="Buka pencarian dan aksi (Ctrl K)">
              <Search size={15} />
              <span>Cari atau aksi…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <NotificationBell />
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Gunakan tema terang' : 'Gunakan tema gelap'}
              title="Ubah tema (Alt + D)"
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <span className="env-pill">
              <i /> Demo
            </span>
            <span className="role-chip">{roleLabel(user.role)}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleLogout}>
              <LogOut size={15} /> Keluar
            </button>
          </div>
        </header>

        <OfflineBanner />

        <main className="content" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>

        <nav className="bottom-nav" aria-label="Navigasi bawah">
          {bottomItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `bottom-nav-item ${isActive ? 'bottom-nav-active' : ''}`}>
              <item.icon size={19} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} role={user.role} onToggleTheme={toggleTheme} theme={theme} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function LoginRoute() {
  const { user, bootstrapping } = useAuth();
  if (bootstrapping) return <FullPageLoader />;
  if (user) return <Navigate to="/" replace />;
  return (
    <LazyPage>
      <Login />
    </LazyPage>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <SessionExpiredModal />
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              <Route element={<AppShell />}>
                <Route index element={<LazyPage><Dashboard /></LazyPage>} />
                <Route path="bookings" element={<LazyPage><Bookings /></LazyPage>} />
                <Route
                  path="trips"
                  element={
                    <Guard allow={(role) => isStaff(role) || role === 'DRIVER'}>
                      <LazyPage><Trips /></LazyPage>
                    </Guard>
                  }
                />
                <Route
                  path="gps"
                  element={
                    <Guard allow={(role) => can(role, 'gps:read')}>
                      <LazyPage><GpsMonitoring /></LazyPage>
                    </Guard>
                  }
                />
                <Route
                  path="vehicles"
                  element={
                    <Guard allow={(role) => can(role, 'vehicles:read')}>
                      <LazyPage><Vehicles /></LazyPage>
                    </Guard>
                  }
                />
                <Route
                  path="drivers"
                  element={
                    <Guard allow={(role) => can(role, 'drivers:read')}>
                      <LazyPage><Drivers /></LazyPage>
                    </Guard>
                  }
                />
                <Route
                  path="vendors"
                  element={
                    <Guard allow={(role) => can(role, 'vendors:read')}>
                      <LazyPage><Vendors /></LazyPage>
                    </Guard>
                  }
                />
                <Route
                  path="routes"
                  element={
                    <Guard allow={(role) => can(role, 'routes:read')}>
                      <LazyPage><RoutesPage /></LazyPage>
                    </Guard>
                  }
                />
                <Route
                  path="maintenance"
                  element={
                    <Guard allow={(role) => can(role, 'maintenance:read')}>
                      <LazyPage><Maintenance /></LazyPage>
                    </Guard>
                  }
                />
                <Route
                  path="audit"
                  element={
                    <Guard allow={(role) => can(role, 'audit:read')}>
                      <LazyPage><Audit /></LazyPage>
                    </Guard>
                  }
                />
                <Route
                  path="reports"
                  element={
                    <Guard allow={(role) => can(role, 'reports:read')}>
                      <LazyPage><Reports /></LazyPage>
                    </Guard>
                  }
                />
                <Route
                  path="users"
                  element={
                    <Guard allow={(role) => can(role, 'users:manage')}>
                      <LazyPage><UsersPage /></LazyPage>
                    </Guard>
                  }
                />
                <Route path="notifications" element={<LazyPage><Notifications /></LazyPage>} />
                <Route path="profile" element={<LazyPage><Profile /></LazyPage>} />
                <Route path="*" element={<LazyPage><NotFound /></LazyPage>} />
              </Route>
            </Routes>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

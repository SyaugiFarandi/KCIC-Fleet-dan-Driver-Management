import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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
  Route as RouteIcon,
  Satellite,
  ShieldCheck,
  Truck,
  UserCircle,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import NotificationBell from './NotificationBell.jsx';
import { AuthProvider, useAuth } from './auth.jsx';
import { can, isStaff, roleLabel } from './permissions.js';
import { ConfirmProvider, Spinner, ToastProvider } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Bookings from './pages/Bookings.jsx';
import Trips from './pages/Trips.jsx';
import GpsMonitoring from './pages/GpsMonitoring.jsx';
import Vehicles from './pages/Vehicles.jsx';
import Drivers from './pages/Drivers.jsx';
import Vendors from './pages/Vendors.jsx';
import RoutesPage from './pages/RoutesPage.jsx';
import Maintenance from './pages/Maintenance.jsx';
import Audit from './pages/Audit.jsx';
import UsersPage from './pages/Users.jsx';
import Profile from './pages/Profile.jsx';
import Reports from './pages/Reports.jsx';
import Notifications from './pages/Notifications.jsx';

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

function FullPageLoader() {
  return (
    <div className="full-loading">
      <div className="brand-mark">W</div>
      <Spinner size={26} />
      <p>Menyiapkan sesi...</p>
    </div>
  );
}

function Guard({ allow, children }) {
  const { user } = useAuth();
  if (typeof allow === 'function' && !allow(user?.role)) return <NoAccess />;
  return children;
}

function NoAccess() {
  return (
    <div className="panel">
      <h3>Akses ditolak</h3>
      <p className="muted">Role Anda tidak memiliki izin untuk membuka halaman ini. Pembatasan juga ditegakkan di API backend.</p>
      <NavLink className="btn btn-primary" to="/">
        Kembali ke Dashboard
      </NavLink>
    </div>
  );
}

function AppShell() {
  const { user, logout, bootstrapping } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
            <NotificationBell />
            <span className="env-pill">
              <i /> Demo
            </span>
            <span className="role-chip">{roleLabel(user.role)}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleLogout}>
              <LogOut size={15} /> Keluar
            </button>
          </div>
        </header>

        <main className="content" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function LoginRoute() {
  const { user, bootstrapping } = useAuth();
  if (bootstrapping) return <FullPageLoader />;
  if (user) return <Navigate to="/" replace />;
  return <Login />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              <Route element={<AppShell />}>
                <Route index element={<Dashboard />} />
                <Route path="bookings" element={<Bookings />} />
                <Route
                  path="trips"
                  element={
                    <Guard allow={(role) => isStaff(role) || role === 'DRIVER'}>
                      <Trips />
                    </Guard>
                  }
                />
                <Route
                  path="gps"
                  element={
                    <Guard allow={(role) => can(role, 'gps:read')}>
                      <GpsMonitoring />
                    </Guard>
                  }
                />
                <Route
                  path="vehicles"
                  element={
                    <Guard allow={(role) => can(role, 'vehicles:read')}>
                      <Vehicles />
                    </Guard>
                  }
                />
                <Route
                  path="drivers"
                  element={
                    <Guard allow={(role) => can(role, 'drivers:read')}>
                      <Drivers />
                    </Guard>
                  }
                />
                <Route
                  path="vendors"
                  element={
                    <Guard allow={(role) => can(role, 'vendors:read')}>
                      <Vendors />
                    </Guard>
                  }
                />
                <Route
                  path="routes"
                  element={
                    <Guard allow={(role) => can(role, 'routes:read')}>
                      <RoutesPage />
                    </Guard>
                  }
                />
                <Route
                  path="maintenance"
                  element={
                    <Guard allow={(role) => can(role, 'maintenance:read')}>
                      <Maintenance />
                    </Guard>
                  }
                />
                <Route
                  path="audit"
                  element={
                    <Guard allow={(role) => can(role, 'audit:read')}>
                      <Audit />
                    </Guard>
                  }
                />
                <Route
                  path="reports"
                  element={
                    <Guard allow={(role) => can(role, 'reports:read')}>
                      <Reports />
                    </Guard>
                  }
                />
                <Route
                  path="users"
                  element={
                    <Guard allow={(role) => can(role, 'users:manage')}>
                      <UsersPage />
                    </Guard>
                  }
                />
                <Route path="notifications" element={<Notifications />} />
                <Route path="profile" element={<Profile />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  Car,
  ClipboardList,
  Command,
  FileText,
  Keyboard,
  LayoutDashboard,
  MapPin,
  Moon,
  Plus,
  Route as RouteIcon,
  Satellite,
  Search,
  ShieldCheck,
  Sun,
  Truck,
  UserCircle,
  Users,
  Wrench,
} from 'lucide-react';
import { can, isStaff } from './permissions.js';

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', keywords: 'home ringkasan kpi', icon: LayoutDashboard, end: true, visible: () => true },
  { to: '/bookings', label: 'Booking', keywords: 'permintaan transport approval', icon: ClipboardList, visible: () => true },
  { to: '/trips', label: 'Perjalanan', keywords: 'trip driver status', icon: RouteIcon, visible: (role) => isStaff(role) || role === 'DRIVER' },
  { to: '/gps', label: 'GPS Monitoring', keywords: 'peta lokasi telemetry armada', icon: Satellite, visible: (role) => can(role, 'gps:read') },
  { to: '/vehicles', label: 'Kendaraan', keywords: 'mobil armada plat stnk', icon: Car, visible: (role) => can(role, 'vehicles:read') },
  { to: '/drivers', label: 'Driver', keywords: 'pengemudi sim', icon: Users, visible: (role) => can(role, 'drivers:read') },
  { to: '/vendors', label: 'Vendor', keywords: 'mitra sewa', icon: Truck, visible: (role) => can(role, 'vendors:read') },
  { to: '/routes', label: 'Rute', keywords: 'jalur tujuan asal', icon: MapPin, visible: (role) => can(role, 'routes:read') },
  { to: '/maintenance', label: 'Maintenance', keywords: 'servis perawatan bengkel', icon: Wrench, visible: (role) => can(role, 'maintenance:read') },
  { to: '/reports', label: 'Laporan', keywords: 'ekspor csv excel analitik', icon: BarChart3, visible: (role) => can(role, 'reports:read') },
  { to: '/audit', label: 'Audit Log', keywords: 'jejak aktivitas', icon: FileText, visible: (role) => can(role, 'audit:read') },
  { to: '/users', label: 'Pengguna', keywords: 'user akun hak akses', icon: ShieldCheck, visible: (role) => can(role, 'users:manage') },
  { to: '/notifications', label: 'Notifikasi', keywords: 'pesan peringatan', icon: Bell, visible: () => true },
  { to: '/profile', label: 'Profil', keywords: 'akun password preferensi', icon: UserCircle, visible: () => true },
];

export default function CommandPalette({ open, onClose, role, onToggleTheme, theme }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const items = useMemo(() => {
    const nav = NAV_ITEMS.filter((item) => item.visible(role)).map((item) => ({
      id: `nav-${item.to}`,
      label: item.label,
      hint: item.to,
      keywords: item.keywords,
      icon: item.icon,
      run: () => navigate(item.to),
    }));
    const actions = [
      { id: 'new-booking', label: 'Buat booking baru', hint: 'Aksi cepat', keywords: 'permintaan transport', icon: Plus, run: () => navigate('/bookings?new=1') },
      {
        id: 'toggle-theme',
        label: theme === 'dark' ? 'Gunakan tema terang' : 'Gunakan tema gelap',
        hint: 'Tampilan',
        keywords: 'dark mode tema gelap terang',
        icon: theme === 'dark' ? Sun : Moon,
        run: () => onToggleTheme(),
      },
      { id: 'shortcuts', label: 'Lihat pintasan keyboard', hint: 'Bantuan', keywords: 'shortcut tombol keyboard help', icon: Keyboard, run: () => navigate('/?shortcuts=1') },
    ];
    const all = [...actions, ...nav];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((item) => `${item.label} ${item.keywords} ${item.hint}`.toLowerCase().includes(needle));
  }, [navigate, query, role, theme, onToggleTheme]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setIndex(0);
      return undefined;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open) return null;

  const runItem = (item) => {
    onClose();
    window.setTimeout(() => item?.run(), 10);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((value) => Math.min(items.length - 1, value + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((value) => Math.max(0, value - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      runItem(items[index]);
    }
  };

  return (
    <div className="palette-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari halaman atau aksi..."
            aria-label="Cari halaman atau aksi"
            aria-controls="palette-results"
            aria-activedescendant={items[index] ? `palette-item-${items[index].id}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="palette-results" className="palette-results" role="listbox">
          {items.length === 0 && <li className="palette-empty">Tidak ada hasil untuk “{query}”.</li>}
          {items.map((item, itemIndex) => (
            <li key={item.id} role="option" aria-selected={itemIndex === index} id={`palette-item-${item.id}`}>
              <button
                type="button"
                className={`palette-item ${itemIndex === index ? 'palette-item-active' : ''}`.trim()}
                onMouseEnter={() => setIndex(itemIndex)}
                onClick={() => runItem(item)}
              >
                <item.icon size={16} />
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </button>
            </li>
          ))}
        </ul>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigasi
          </span>
          <span>
            <kbd>Enter</kbd> buka
          </span>
          <span className="palette-foot-brand">
            <Command size={12} /> Ctrl / ⌘ + K
          </span>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS = [
  ['Ctrl / ⌘ + K', 'Buka command palette'],
  ['?', 'Buka daftar pintasan keyboard'],
  ['Esc', 'Tutup dialog atau panel'],
  ['Alt + D', 'Ubah tema terang/gelap'],
  ['Tab / Shift + Tab', 'Berpindah fokus antar kontrol'],
];

export function ShortcutsOverlay({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="palette-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="shortcut-card" role="dialog" aria-modal="true" aria-labelledby="shortcut-title">
        <div className="shortcut-head">
          <h3 id="shortcut-title">
            <Keyboard size={17} /> Pintasan keyboard
          </h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Tutup pintasan">
            <Command size={15} />
          </button>
        </div>
        <dl className="shortcut-list">
          {SHORTCUTS.map(([keys, description]) => (
            <div key={keys}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">Bagian dari audit aksesibilitas: semua aksi utama tetap dapat diakses tanpa keyboard shortcuts.</p>
      </div>
    </div>
  );
}

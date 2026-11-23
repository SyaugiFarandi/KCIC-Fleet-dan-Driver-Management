import { Link, useLocation } from 'react-router-dom';
import { Compass, Home, Search } from 'lucide-react';

export default function NotFound() {
  const location = useLocation();
  return (
    <section className="panel fallback-panel">
      <span className="fallback-code">404</span>
      <h3>Halaman tidak ditemukan</h3>
      <p className="muted">
        Alamat <code>{location.pathname}</code> tidak tersedia. Periksa kembali tautan atau gunakan pintasan <b>Ctrl / ⌘ + K</b> untuk mencari
        halaman lain.
      </p>
      <div className="fallback-actions">
        <Link className="btn btn-primary" to="/">
          <Home size={15} /> Ke Dashboard
        </Link>
        <Link className="btn btn-secondary" to="/bookings">
          <Compass size={15} /> Buka Booking
        </Link>
        <Link className="btn btn-secondary" to="/?shortcuts=1">
          <Search size={15} /> Pintasan keyboard
        </Link>
      </div>
    </section>
  );
}

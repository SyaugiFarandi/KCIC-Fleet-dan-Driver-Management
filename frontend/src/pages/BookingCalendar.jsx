import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiGet } from '../api.js';
import { fmtDate, statusTone, toDateInput } from '../format.js';
import { Badge, EmptyState, Field } from '../ui.jsx';

const MONTH_FORMAT = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });
const DAY_FORMAT = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const TIME_FORMAT = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

const pad = (value) => String(value).padStart(2, '0');
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function buildGrid(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, index) => {
    const dayNumber = index - offset + 1;
    const date = new Date(cursor.getFullYear(), cursor.getMonth(), dayNumber);
    return { date, inMonth: dayNumber >= 1 && dayNumber <= daysInMonth, key: dayKey(date) };
  });
}

const byTime = (a, b) => new Date(a.departureAt) - new Date(b.departureAt);

export default function BookingCalendar({ bookings, canCheckAvailability, onOpenBooking }) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedKey, setSelectedKey] = useState(dayKey(today));
  const [availability, setAvailability] = useState({ date: toDateInput(today), start: '08:00', end: '12:00', passengers: 1 });
  const [availabilityResult, setAvailabilityResult] = useState(null);
  const [availabilityError, setAvailabilityError] = useState(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map();
    bookings.forEach((booking) => {
      const key = dayKey(new Date(booking.departureAt));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(booking);
    });
    map.forEach((list) => list.sort(byTime));
    return map;
  }, [bookings]);

  const grid = useMemo(() => buildGrid(cursor), [cursor]);
  const selectedDate = new Date(`${selectedKey}T00:00:00`);
  const dayBookings = grouped.get(selectedKey) || [];

  const shiftMonth = (delta) => {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    setCursor(next);
    setSelectedKey(dayKey(next));
  };

  const checkAvailability = async () => {
    const from = new Date(`${availability.date}T${availability.start}`);
    const to = new Date(`${availability.date}T${availability.end}`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      setAvailabilityError('Rentang waktu tidak valid.');
      return;
    }
    setAvailabilityLoading(true);
    setAvailabilityError(null);
    try {
      const data = await apiGet('/trips/availability', {
        from: from.toISOString(),
        to: to.toISOString(),
        passengerCount: Math.max(1, Number(availability.passengers) || 1),
      });
      setAvailabilityResult(data);
    } catch (err) {
      setAvailabilityResult(null);
      setAvailabilityError(err.message);
    } finally {
      setAvailabilityLoading(false);
    }
  };

  return (
    <div className="gcal-layout">
      <section className="gcal-main">
        <div className="gcal-head">
          <div>
            <b>{MONTH_FORMAT.format(cursor)}</b>
            <small>{bookings.length} booking ditampilkan</small>
          </div>
          <div className="gcal-nav">
            <button type="button" className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="Bulan sebelumnya">
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
                setSelectedKey(dayKey(today));
              }}
            >
              Hari ini
            </button>
            <button type="button" className="icon-btn" onClick={() => shiftMonth(1)} aria-label="Bulan berikutnya">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="gcal-weekdays">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="gcal-grid">
          {grid.map((cell) => {
            const list = grouped.get(cell.key) || [];
            const isToday = cell.key === dayKey(today);
            return (
              <button
                type="button"
                key={cell.key}
                className={`gcal-day ${cell.inMonth ? '' : 'gcal-day-out'} ${cell.key === selectedKey ? 'gcal-day-selected' : ''}`.trim()}
                onClick={() => setSelectedKey(cell.key)}
              >
                <span className={`gcal-day-num ${isToday ? 'gcal-day-today' : ''}`.trim()}>{cell.date.getDate()}</span>
                <div className="gcal-day-pills">
                  {list.slice(0, 3).map((booking) => (
                    <span key={booking.id} className={`gcal-pill gcal-pill-${statusTone(booking.status)}`}>
                      <i />
                      {TIME_FORMAT.format(new Date(booking.departureAt))} {booking.code.slice(-4)}
                    </span>
                  ))}
                  {list.length > 3 && <span className="gcal-more">+{list.length - 3} lagi</span>}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="gcal-side">
        <div className="gcal-side-head">
          <CalendarDays size={16} />
          <b>{DAY_FORMAT.format(selectedDate)}</b>
        </div>

        {dayBookings.length === 0 ? (
          <EmptyState title="Tidak ada booking">Belum ada permintaan pada tanggal ini.</EmptyState>
        ) : (
          <div className="gcal-day-list">
            {dayBookings.map((booking) => (
              <button
                type="button"
                key={booking.id}
                className="gcal-booking"
                onClick={() => onOpenBooking?.(booking)}
                title="Buka detail booking"
              >
                <div className="gcal-booking-top">
                  <b>{TIME_FORMAT.format(new Date(booking.departureAt))}</b>
                  <Badge value={booking.status} />
                </div>
                <span>{booking.code}</span>
                <small>
                  {booking.origin} → {booking.destination}
                </small>
                <small>
                  {booking.passengerCount} pax · {booking.requester?.name || '—'}
                </small>
              </button>
            ))}
          </div>
        )}

        <div className="section-divider">
          <h4>Ketersediaan Armada</h4>
        </div>

        {canCheckAvailability ? (
          <div className="gcal-avail">
            <Field label="Tanggal">
              <input
                type="date"
                value={availability.date}
                onChange={(event) => setAvailability({ ...availability, date: event.target.value })}
              />
            </Field>
            <div className="gcal-avail-row">
              <Field label="Mulai">
                <input
                  type="time"
                  value={availability.start}
                  onChange={(event) => setAvailability({ ...availability, start: event.target.value })}
                />
              </Field>
              <Field label="Selesai">
                <input
                  type="time"
                  value={availability.end}
                  onChange={(event) => setAvailability({ ...availability, end: event.target.value })}
                />
              </Field>
            </div>
            <Field label="Jumlah penumpang">
              <input
                type="number"
                min="1"
                max="80"
                value={availability.passengers}
                onChange={(event) => setAvailability({ ...availability, passengers: event.target.value })}
              />
            </Field>
            <button type="button" className="btn btn-primary btn-sm" onClick={checkAvailability} disabled={availabilityLoading}>
              {availabilityLoading ? 'Menghitung...' : 'Cek ketersediaan'}
            </button>

            {availabilityError && <p className="form-hint warn">{availabilityError}</p>}

            {availabilityResult && (
              <div className="gcal-avail-result">
                <p className="muted small-note">
                  Jadwal {fmtDate(availability.date)} pukul {availability.start}–{availability.end}
                </p>
                <div className="gcal-avail-counts">
                  <span>
                    <b>{availabilityResult.vehicles?.length || 0}</b> kendaraan
                  </span>
                  <span>
                    <b>{availabilityResult.drivers?.length || 0}</b> driver
                  </span>
                </div>
                {availabilityResult.vehicles?.length > 0 && (
                  <small>{availabilityResult.vehicles.slice(0, 6).map((vehicle) => vehicle.plateNumber).join(', ')}</small>
                )}
                {availabilityResult.drivers?.length > 0 && (
                  <small>{availabilityResult.drivers.slice(0, 6).map((driver) => driver.name).join(', ')}</small>
                )}
                {(!availabilityResult.vehicles?.length || !availabilityResult.drivers?.length) && (
                  <p className="form-hint warn">Tidak ada kendaraan/driver yang memenuhi syarat pada jadwal ini.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="muted small-note">Cek ketersediaan hanya tersedia untuk peran yang berwenang menugaskan armada.</p>
        )}
      </aside>
    </div>
  );
}

const dateFormatter = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const moneyFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

export const fmtDate = (value) => (value ? dateFormatter.format(new Date(value)) : '—');
export const fmtDateTime = (value) => (value ? dateTimeFormatter.format(new Date(value)) : '—');
export const fmtMoney = (value) => moneyFormatter.format(Number(value || 0));

export function expiryState(value) {
  if (!value) return null;
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
  if (days < 0) return { days, tone: 'red', label: `Lewat ${Math.abs(days)} hari` };
  if (days === 0) return { days, tone: 'red', label: 'Habis hari ini' };
  if (days <= 30) return { days, tone: 'amber', label: `${days} hari lagi` };
  return { days, tone: 'green', label: 'Aman' };
}

const pad = (value) => String(value).padStart(2, '0');

export function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const STATUS_LABELS = {
  AVAILABLE: 'Tersedia',
  ASSIGNED: 'Ditugaskan',
  MAINTENANCE: 'Perawatan',
  INACTIVE: 'Nonaktif',
  PENDING: 'Menunggu',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
  SCHEDULED: 'Terjadwal',
  DRIVER_ACCEPTED: 'Diterima Driver',
  PICKED_UP: 'Penjemputan',
  IN_PROGRESS: 'Berjalan',
  PLANNED: 'Direncanakan',
  ACTIVE: 'Aktif',
  KCIC: 'KCIC',
  VENDOR: 'Vendor',
  INTERNAL: 'Internal',
  MOVING: 'Bergerak',
  STOPPED: 'Berhenti',
  OFFLINE: 'Offline',
};

export function statusTone(status) {
  switch (status) {
    case 'AVAILABLE':
    case 'APPROVED':
    case 'COMPLETED':
    case 'ACTIVE':
    case 'MOVING':
      return 'green';
    case 'PENDING':
    case 'PLANNED':
    case 'STOPPED':
      return 'amber';
    case 'REJECTED':
    case 'CANCELLED':
    case 'MAINTENANCE':
    case 'INACTIVE':
      return 'red';
    case 'ASSIGNED':
    case 'IN_PROGRESS':
    case 'PICKED_UP':
    case 'DRIVER_ACCEPTED':
      return 'blue';
    case 'SCHEDULED':
      return 'purple';
    default:
      return 'gray';
  }
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || String(status || '').replaceAll('_', ' ');
}

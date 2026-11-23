import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../gps.css';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Gauge,
  MapPin,
  Navigation,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Satellite,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import {
  Badge,
  DetailItem,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  SearchBox,
  Spinner,
  StatCard,
  useConfirm,
  useToast,
} from '../ui.jsx';
import { fmtDateTime, statusLabel } from '../format.js';

const CENTER = [-6.55, 107.15];

const MOTION_LABELS = { MOVING: 'Bergerak', STOPPED: 'Berhenti', OFFLINE: 'Offline' };
const MOTION_TONES = { MOVING: 'green', STOPPED: 'amber', OFFLINE: 'gray' };
const TELEMETRY_LABELS = { SIMULATED: 'Simulasi', LIVE: 'Live', STALE: 'Data lama', OFFLINE: 'Tanpa data' };
const TELEMETRY_TONES = { SIMULATED: 'blue', LIVE: 'green', STALE: 'amber', OFFLINE: 'gray' };
const GEOFENCE_CATEGORIES = { STATION: 'Stasiun', DEPOT: 'Depo', OFFICE: 'Kantor', AIRPORT: 'Bandara', ZONE: 'Zona' };
const GEOFENCE_COLORS = {
  STATION: '#1d4ed8',
  DEPOT: '#6d28d9',
  OFFICE: '#0891b2',
  AIRPORT: '#b45309',
  ZONE: '#4b5563',
};
const EVENT_TONES = {
  GEOFENCE_ENTER: 'blue',
  GEOFENCE_EXIT: 'gray',
  OVERSPEED: 'red',
  HARSH_BRAKING: 'amber',
  IDLE: 'amber',
  DEVICE_OFFLINE: 'red',
  SIGNAL_RESTORED: 'green',
  IGNITION_ON: 'gray',
  IGNITION_OFF: 'gray',
  ROUTE_DEVIATION: 'red',
};

const ETA_LABELS = { ON_TIME: 'Sesuai jadwal', DUE_SOON: 'Segera tiba', OVERDUE: 'Melewati ETA' };
const ETA_TONES = { ON_TIME: 'green', DUE_SOON: 'amber', OVERDUE: 'red' };

const timeFormatter = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function fmtTime(value) {
  return value ? timeFormatter.format(new Date(value)) : '—';
}

function relativeTime(value) {
  if (!value) return 'Belum ada data';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds} dtk lalu`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.round(minutes / 60);
  return `${hours} jam lalu`;
}

function markerIcon(item, selected) {
  const tone = String(item.motionStatus || 'OFFLINE').toLowerCase();
  return L.divIcon({
    className: 'gps-marker-icon',
    html: `<div class="gps-pin gps-pin-${tone}${selected ? ' gps-pin-selected' : ''}"><span></span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

const replayIcon = L.divIcon({
  className: 'gps-marker-icon',
  html: '<div class="gps-pin gps-pin-replay"><span></span></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 12), { duration: 0.7 });
  }, [target, map]);
  return null;
}

function FitBounds({ signal, points, geofences, showGeofences }) {
  const map = useMap();
  const applied = useRef(0);
  useEffect(() => {
    if (!signal || applied.current === signal) return;
    const coords = [
      ...points,
      ...(showGeofences ? geofences.map((fence) => [fence.centerLat, fence.centerLng]) : []),
    ];
    if (coords.length < 2) return;
    applied.current = signal;
    map.fitBounds(L.latLngBounds(coords), { padding: [36, 36], maxZoom: 11 });
  }, [signal, points, geofences, showGeofences, map]);
  return null;
}

function MapResize() {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 120);
    return () => clearTimeout(id);
  }, [map]);
  return null;
}

export default function GpsMonitoring() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canWrite = can(user?.role, 'gps:write');

  const [positions, setPositions] = useState([]);
  const [liveFeed, setLiveFeed] = useState('connecting');
  const [counts, setCounts] = useState(null);
  const [telemetryMeta, setTelemetryMeta] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ status: 'ALL', ownership: 'ALL', driverId: '', q: '' });
  const [options, setOptions] = useState({ vehicles: [], drivers: [], eventTypes: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState('detail');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [geofences, setGeofences] = useState([]);
  const [showGeofences, setShowGeofences] = useState(true);
  const [focus, setFocus] = useState(null);
  const [fitSignal, setFitSignal] = useState(1);
  const [replayTripId, setReplayTripId] = useState('');
  const [replay, setReplay] = useState(null);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [eventsModal, setEventsModal] = useState(false);
  const [eventFilter, setEventFilter] = useState('ALL');
  const [eventAck, setEventAck] = useState('ALL');
  const [globalEvents, setGlobalEvents] = useState({ items: [], total: 0, labels: {}, unacknowledged: 0 });
  const [eventsLoading, setEventsLoading] = useState(false);
  const [acknowledging, setAcknowledging] = useState(null);
  const [geoModal, setGeoModal] = useState(false);
  const [geoForm, setGeoForm] = useState(null);
  const [deviceModal, setDeviceModal] = useState(false);
  const [deviceForm, setDeviceForm] = useState(null);
  const [devices, setDevices] = useState([]);

  const selected = positions.find((item) => item.id === selectedId) || null;
  const eventLabels = useMemo(
    () => Object.fromEntries((options.eventTypes || []).map((type) => [type.value, type.label])),
    [options.eventTypes]
  );

  const loadPositions = useCallback(
    async (silent = false) => {
      try {
        const data = await apiGet('/gps/positions', {
          status: filters.status === 'ALL' ? '' : filters.status,
          ownership: filters.ownership === 'ALL' ? '' : filters.ownership,
          driverId: filters.driverId,
          q: filters.q,
        });
        setPositions(data.items);
        setCounts(data.counts);
        setTelemetryMeta(data.telemetry || null);
        setGeneratedAt(data.generatedAt);
        setError(null);
      } catch (err) {
        if (!silent) setError(err);
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  const loadGeofences = useCallback(async () => {
    try {
      const data = await apiGet('/gps/geofences');
      setGeofences(data.items);
    } catch (err) {
      toast.error(err.message);
    }
  }, [toast]);

  const loadOptions = useCallback(async () => {
    try {
      const data = await apiGet('/gps/options');
      setOptions(data);
    } catch (err) {
      toast.error(err.message);
    }
  }, [toast]);

  const loadDevices = useCallback(async () => {
    try {
      const data = await apiGet('/gps/devices');
      setDevices(data.items);
    } catch (err) {
      toast.error(err.message);
    }
  }, [toast]);

  const loadDetail = useCallback(
    async (id, silent = false) => {
      if (!silent) setDetailLoading(true);
      try {
        const data = await apiGet(`/gps/vehicles/${id}`);
        setDetail(data);
      } catch (err) {
        toast.error(err.message);
      } finally {
        setDetailLoading(false);
      }
    },
    [toast]
  );

  const loadReplay = useCallback(
    async (tripId) => {
      try {
        const data = await apiGet(`/gps/trips/${tripId}/replay`);
        setReplay(data);
        setReplayIndex(0);
        setReplayPlaying(data.points.length > 1);
      } catch (err) {
        toast.error(err.message);
      }
    },
    [toast]
  );

  const loadEvents = useCallback(
    async (type = eventFilter) => {
      setEventsLoading(true);
      try {
        const data = await apiGet('/gps/events', {
          type: type === 'ALL' ? '' : type,
          pageSize: 100,
          acknowledged: eventAck === 'ALL' ? '' : eventAck,
        });
        setGlobalEvents({
          items: data.items,
          total: data.total,
          labels: data.labels || {},
          unacknowledged: data.unacknowledged ?? 0,
        });
      } catch (err) {
        toast.error(err.message);
      } finally {
        setEventsLoading(false);
      }
    },
    [eventFilter, eventAck, toast]
  );

  useEffect(() => {
    loadPositions();
    let source = null;
    let pollTimer = null;

    const applyPayload = (data) => {
      setPositions(data.items);
      setCounts(data.counts);
      setTelemetryMeta(data.telemetry || null);
      setGeneratedAt(data.generatedAt);
      setError(null);
      setLoading(false);
    };

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        if (!document.hidden) loadPositions(true);
      }, 8000);
    };

    if (typeof EventSource === 'undefined') {
      setLiveFeed('polling');
      startPolling();
      return stopPolling;
    }

    const params = new URLSearchParams({
      status: filters.status === 'ALL' ? '' : filters.status,
      ownership: filters.ownership === 'ALL' ? '' : filters.ownership,
      driverId: filters.driverId || '',
      q: filters.q || '',
    });

    source = new EventSource(`/api/gps/stream?${params.toString()}`, { withCredentials: true });
    source.addEventListener('positions', (event) => {
      try {
        applyPayload(JSON.parse(event.data));
        setLiveFeed('live');
        stopPolling();
      } catch {
        /* ignore malformed frame */
      }
    });
    source.addEventListener('error', () => {
      setLiveFeed('polling');
      startPolling();
    });

    return () => {
      source?.close();
      stopPolling();
    };
  }, [loadPositions, filters]);

  useEffect(() => {
    loadOptions();
    loadGeofences();
    loadDevices();
  }, [loadOptions, loadGeofences, loadDevices]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (selectedId && generatedAt) loadDetail(selectedId, true);
  }, [generatedAt, selectedId, loadDetail]);

  useEffect(() => {
    if (tab !== 'history' || !selectedId) return;
    setHistoryLoading(true);
    apiGet(`/gps/vehicles/${selectedId}/history`, { limit: 200 })
      .then((data) => setHistory(data.items))
      .catch((err) => toast.error(err.message))
      .finally(() => setHistoryLoading(false));
  }, [tab, selectedId, toast]);

  useEffect(() => {
    if (tab === 'replay' && replayTripId) loadReplay(replayTripId);
  }, [tab, replayTripId, loadReplay]);

  useEffect(() => {
    if (eventsModal) loadEvents();
  }, [eventsModal, eventFilter, loadEvents]);

  useEffect(() => {
    if (detail?.trips?.length && !replayTripId) setReplayTripId(detail.trips[0].id);
  }, [detail, replayTripId]);

  useEffect(() => {
    if (!replayPlaying || !replay?.points?.length) return;
    const timer = setInterval(() => {
      setReplayIndex((current) => {
        if (current + 1 >= replay.points.length) {
          setReplayPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 450);
    return () => clearInterval(timer);
  }, [replayPlaying, replay]);

  const selectVehicle = (id) => {
    setSelectedId(id);
    setTab('detail');
    setHistory([]);
    setReplay(null);
    setReplayTripId('');
    setReplayPlaying(false);
    setReplayIndex(0);
    const item = positions.find((entry) => entry.id === id);
    if (item?.location) setFocus({ lat: item.location.lat, lng: item.location.lng, key: Date.now() });
  };

  const markers = useMemo(
    () => positions.filter((item) => item.location).map((item) => [item.location.lat, item.location.lng]),
    [positions]
  );

  const replayPoint = replay?.points?.[replayIndex] || null;

  const openGeoForm = (fence = null) => {
    setGeoForm(
      fence
        ? {
            id: fence.id,
            name: fence.name,
            category: fence.category,
            centerLat: fence.centerLat,
            centerLng: fence.centerLng,
            radiusM: fence.radiusM,
            active: fence.active,
            notes: fence.notes || '',
          }
        : { name: '', category: 'STATION', centerLat: -6.2422, centerLng: 106.8866, radiusM: 500, active: true, notes: '' }
    );
  };

  const saveGeofence = async () => {
    if (!geoForm?.name?.trim()) {
      toast.error('Nama geofence wajib diisi');
      return;
    }
    const payload = {
      name: geoForm.name.trim(),
      category: geoForm.category,
      centerLat: Number(geoForm.centerLat),
      centerLng: Number(geoForm.centerLng),
      radiusM: Number(geoForm.radiusM),
      active: Boolean(geoForm.active),
      notes: geoForm.notes || null,
    };
    try {
      if (geoForm.id) await apiPatch(`/gps/geofences/${geoForm.id}`, payload);
      else await apiPost('/gps/geofences', payload);
      toast.success(geoForm.id ? 'Geofence diperbarui' : 'Geofence ditambahkan');
      setGeoForm(null);
      await loadGeofences();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteGeofence = async (fence) => {
    const ok = await confirm({
      title: 'Hapus geofence',
      message: `Hapus geofence "${fence.name}"? Event historis tetap tersimpan tanpa relasi geofence.`,
      confirmLabel: 'Hapus',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiDelete(`/gps/geofences/${fence.id}`);
      toast.success('Geofence dihapus');
      await loadGeofences();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openDeviceForm = (device = null) => {
    setDeviceForm(
      device
        ? {
            id: device.id,
            imei: device.imei,
            vehicleId: device.vehicleId,
            status: device.status,
            provider: device.provider,
            simNumber: device.simNumber || '',
            installedAt: device.installedAt ? device.installedAt.slice(0, 10) : '',
          }
        : { imei: '', vehicleId: '', status: 'ACTIVE', provider: 'DEMO_SIMULATOR', simNumber: '', installedAt: '' }
    );
  };

  const saveDevice = async () => {
    if (!deviceForm?.imei?.trim() || !deviceForm?.vehicleId) {
      toast.error('IMEI dan kendaraan wajib dipilih');
      return;
    }
    const payload = {
      imei: deviceForm.imei.trim(),
      vehicleId: deviceForm.vehicleId,
      status: deviceForm.status,
      simNumber: deviceForm.simNumber || null,
      ...(deviceForm.installedAt ? { installedAt: deviceForm.installedAt } : {}),
    };
    try {
      if (deviceForm.id) await apiPatch(`/gps/devices/${deviceForm.id}`, payload);
      else await apiPost('/gps/devices', payload);
      toast.success(deviceForm.id ? 'Perangkat GPS diperbarui' : 'Perangkat GPS ditambahkan');
      setDeviceForm(null);
      await Promise.all([loadDevices(), loadOptions(), loadPositions(true)]);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteDevice = async (device) => {
    const ok = await confirm({
      title: 'Hapus perangkat GPS',
      message: `Hapus perangkat ${device.imei} dari kendaraan ${device.vehicle?.plateNumber}? Riwayat koordinat tetap disimpan.`,
      confirmLabel: 'Hapus',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiDelete(`/gps/devices/${device.id}`);
      toast.success('Perangkat GPS dihapus');
      await Promise.all([loadDevices(), loadOptions(), loadPositions(true)]);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const acknowledgeEvent = async (event) => {
    setAcknowledging(event.id);
    try {
      await apiPatch(`/gps/events/${event.id}/acknowledge`, {});
      toast.success('Event GPS dikonfirmasi.');
      await loadEvents();
      if (selectedId) await loadDetail(selectedId, true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAcknowledging(null);
    }
  };

  const setStatusFilter = (status) => setFilters((current) => ({ ...current, status }));

  return (
    <>
      <PageHeader
        eyebrow="Peta armada langsung"
        title="GPS Fleet Monitoring"
        subtitle="Pantau posisi armada, riwayat perjalanan, geofence, dan event GPS dalam satu peta."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => loadPositions()}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEventsModal(true)}>
              <ShieldAlert size={15} /> Event GPS
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setGeoModal(true)}>
              <MapPin size={15} /> Geofence
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setDeviceModal(true)}>
              <Cpu size={15} /> Perangkat GPS
            </button>
          </>
        }
      />

      <div className="gps-demo-banner" role="note">
        <AlertTriangle size={17} />
        <div>
          <b>Simulator GPS demo</b> — Koordinat dihasilkan simulator lokal dan diperbarui berkala (±15 detik).
          Data ini bukan pelacakan GPS aktual dan tidak boleh dianggap sebagai lokasi resmi kendaraan.
          <div className="gps-telemetry-meta">
            <span>Mode: <b>{telemetryMeta?.provider === 'DEVICE_WEBHOOK' ? 'perangkat GPS (webhook)' : 'simulator demo'}</b></span>
            <span>Ingest perangkat: <b>{telemetryMeta?.ingestEnabled ? 'aktif' : 'nonaktif'}</b></span>
            {telemetryMeta && (
              <span>Stale &gt; {telemetryMeta.staleAfterSeconds} dtk · offline &gt; {telemetryMeta.offlineAfterSeconds} dtk</span>
            )}
            <span>{counts?.live ?? 0} live · {counts?.simulated ?? 0} simulasi · {counts?.stale ?? 0} data lama</span>
          </div>
        </div>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="stats-grid gps-kpis">
        <StatCard label="Total Kendaraan" value={counts?.total ?? '—'} hint={`${counts?.withDevice ?? 0} dengan perangkat GPS`} icon={Satellite} onClick={() => setStatusFilter('ALL')} />
        <StatCard label="Bergerak" value={counts?.moving ?? '—'} hint="Kecepatan ≥ 3 km/jam" icon={Navigation} onClick={() => setStatusFilter('MOVING')} />
        <StatCard label="Berhenti" value={counts?.stopped ?? '—'} hint="Mesin hidup / parkir aktif" icon={Pause} onClick={() => setStatusFilter('STOPPED')} />
        <StatCard label="Offline" value={counts?.offline ?? '—'} hint="Tanpa ping > 2 menit" icon={Radio} onClick={() => setStatusFilter('OFFLINE')} />
        <StatCard
          label="Deviasi Rute"
          value={counts?.deviations ?? '—'}
          hint="> 1,5 km dari koridor (30 mnt terakhir)"
          icon={AlertTriangle}
        />
      </div>

      <div className="gps-toolbar">
        <SearchBox
          value={filters.q}
          onChange={(value) => setFilters((current) => ({ ...current, q: value }))}
          placeholder="Cari plat, tujuan, driver, vendor..."
        />
        <div className="gps-toolbar-selects">
          <select value={filters.status} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="ALL">Semua status</option>
            <option value="MOVING">Bergerak</option>
            <option value="STOPPED">Berhenti</option>
            <option value="OFFLINE">Offline</option>
          </select>
          <select
            value={filters.ownership}
            onChange={(event) => setFilters((current) => ({ ...current, ownership: event.target.value }))}
          >
            <option value="ALL">Semua kepemilikan</option>
            <option value="KCIC">KCIC</option>
            <option value="VENDOR">Vendor</option>
          </select>
          <select
            value={filters.driverId}
            onChange={(event) => setFilters((current) => ({ ...current, driverId: event.target.value }))}
          >
            <option value="">Semua driver</option>
            {options.drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`btn ${showGeofences ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setShowGeofences((value) => !value)}
          >
            <MapPin size={14} /> Geofence
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFitSignal((value) => value + 1)}>
            <SlidersHorizontal size={14} /> Fit peta
          </button>
        </div>
      </div>

      <div className="gps-layout">
        <section className="gps-map-panel">
          <div className="gps-map">
            <MapContainer center={CENTER} zoom={10} scrollWheelZoom className="gps-leaflet">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapResize />
              <FitBounds signal={fitSignal} points={markers} geofences={geofences} showGeofences={showGeofences} />
              <FlyTo target={focus} />

              {showGeofences &&
                geofences.map((fence) => (
                  <Circle
                    key={fence.id}
                    center={[fence.centerLat, fence.centerLng]}
                    radius={fence.radiusM}
                    pathOptions={{
                      color: GEOFENCE_COLORS[fence.category] || '#4b5563',
                      fillOpacity: 0.06,
                      weight: fence.active ? 1.6 : 1,
                      dashArray: fence.active ? null : '4 5',
                    }}
                  >
                    <Popup>
                      <b>{fence.name}</b>
                      <br />
                      {GEOFENCE_CATEGORIES[fence.category] || fence.category} · {fence.radiusM} m
                      {!fence.active && ' (nonaktif)'}
                    </Popup>
                  </Circle>
                ))}

              {positions
                .filter((item) => item.location)
                .map((item) => (
                  <Marker
                    key={item.id}
                    position={[item.location.lat, item.location.lng]}
                    icon={markerIcon(item, item.id === selectedId)}
                    eventHandlers={{ click: () => selectVehicle(item.id) }}
                  >
                    <Popup>
                      <div className="gps-popup">
                        <b>{item.plateNumber}</b>
                        <span className={`gps-popup-status gps-popup-${item.motionStatus.toLowerCase()}`}>
                          {MOTION_LABELS[item.motionStatus]}
                        </span>
                        <small>{item.brand} {item.model}</small>
                        <small>{item.driver ? `Driver: ${item.driver.name}` : 'Tidak ada driver aktif'}</small>
                        <small>{item.destination ? `Tujuan: ${item.destination}` : 'Tidak ada trip aktif'}</small>
                        <small>Update: {relativeTime(item.lastUpdateAt)}</small>
                      </div>
                    </Popup>
                  </Marker>
                ))}

              {replay?.points?.length > 1 && (
                <Polyline
                  positions={replay.points.map((point) => [point.lat, point.lng])}
                  pathOptions={{ color: '#831d27', weight: 3, opacity: 0.55, dashArray: '6 6' }}
                />
              )}
              {replayPoint && <Marker position={[replayPoint.lat, replayPoint.lng]} icon={replayIcon} />}
            </MapContainer>

            {loading && (
              <div className="gps-map-loading">
                <Spinner size={22} /> Memuat posisi kendaraan...
              </div>
            )}

            <div className="gps-legend">
              <span><i className="gps-dot gps-dot-moving" /> Bergerak</span>
              <span><i className="gps-dot gps-dot-stopped" /> Berhenti</span>
              <span><i className="gps-dot gps-dot-offline" /> Offline</span>
              <span className="gps-legend-meta">
                <Clock size={12} /> {generatedAt ? `diperbarui ${fmtTime(generatedAt)}` : '—'} ·{' '}
                {liveFeed === 'live' ? 'stream langsung' : liveFeed === 'polling' ? 'polling 8 dtk' : 'menghubungkan...'}
              </span>
            </div>
          </div>
        </section>

        <aside className="gps-side">
          <div className="gps-side-head">
            <div>
              <b>Armada</b>
              <small>{positions.length} kendaraan tampil</small>
            </div>
            <span className="gps-side-count">{positions.filter((item) => item.motionStatus === 'MOVING').length} bergerak</span>
          </div>
          <div className="gps-vehicle-list">
            {positions.length === 0 && !loading && (
              <EmptyState title="Tidak ada kendaraan">Sesuaikan filter untuk melihat armada lain.</EmptyState>
            )}
            {positions.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`gps-vehicle-item ${item.id === selectedId ? 'gps-vehicle-active' : ''}`}
                onClick={() => selectVehicle(item.id)}
              >
                <span className={`gps-dot gps-dot-${item.motionStatus.toLowerCase()}`} />
                <div className="gps-vehicle-main">
                  <div className="gps-vehicle-row">
                    <b>{item.plateNumber}</b>
                    <span className={`gps-telemetry gps-telemetry-${String(item.telemetryStatus || 'OFFLINE').toLowerCase()}`}>
                      {TELEMETRY_LABELS[item.telemetryStatus] || item.telemetryStatus}
                    </span>
                    <span>{item.motionStatus === 'MOVING' ? `${Math.round(item.location?.speedKph || 0)} km/j` : MOTION_LABELS[item.motionStatus]}</span>
                  </div>
                  <small>{item.brand} {item.model} · {statusLabel(item.ownership)}</small>
                  <small className="gps-vehicle-dest">{item.destination ? `→ ${item.destination}` : 'Tidak ada trip aktif'}</small>
                  <small>{item.driver?.name || 'Tanpa driver'} · {relativeTime(item.lastUpdateAt)}</small>
                  {item.etaAt && (
                    <small className={`gps-eta gps-eta-${String(item.etaStatus || '').toLowerCase()}`}>
                      <Clock size={11} /> ETA {fmtTime(item.etaAt)} · {ETA_LABELS[item.etaStatus] || item.etaStatus}
                    </small>
                  )}
                  {item.deviation && (
                    <small className="gps-deviation">
                      <AlertTriangle size={11} /> Deviasi rute {relativeTime(item.deviation.occurredAt)}
                    </small>
                  )}
                </div>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {(selected || detailLoading) && (
        <section className="panel gps-detail-card">
          <div className="gps-detail-head">
            <div>
              <p className="eyebrow">Detail kendaraan</p>
              <h2>{detail?.vehicle?.plateNumber || selected?.plateNumber || 'Memuat...'}</h2>
              <p className="muted">
                {detail?.vehicle
                  ? `${detail.vehicle.brand} ${detail.vehicle.model} · ${detail.vehicle.category} · ${statusLabel(detail.vehicle.ownership)}`
                  : selected
                    ? `${selected.brand} ${selected.model} · ${statusLabel(selected.ownership)}`
                    : ''}
              </p>
            </div>
            <div className="gps-detail-actions">
              {selected && <Badge value={selected.motionStatus} label={MOTION_LABELS[selected.motionStatus]} tone={MOTION_TONES[selected.motionStatus]} />}
              {selected && (
                <Badge
                  value={selected.telemetryStatus}
                  label={`Telemetri: ${TELEMETRY_LABELS[selected.telemetryStatus] || selected.telemetryStatus}`}
                  tone={TELEMETRY_TONES[selected.telemetryStatus]}
                />
              )}
              <button type="button" className="icon-btn" onClick={() => setSelectedId(null)} aria-label="Tutup detail">
                ×
              </button>
            </div>
          </div>

          {selected?.deviation && (
            <div className="gps-alert-banner" role="status">
              <AlertTriangle size={15} />
              <span>
                <b>Deviasi rute terdeteksi:</b> {selected.deviation.message} · {fmtDateTime(selected.deviation.occurredAt)}
                {selected.deviation.acknowledgedAt ? ' · sudah dikonfirmasi' : ' · belum dikonfirmasi'} (data simulasi DEMO)
              </span>
            </div>
          )}

          {detailLoading && !detail ? (
            <div className="table-state"><Spinner /> Memuat detail kendaraan...</div>
          ) : detail ? (
            <>
              <div className="gps-tabs">
                {[
                  ['detail', 'Detail'],
                  ['history', 'Riwayat Koordinat'],
                  ['replay', 'Trip Replay'],
                  ['events', 'Event Kendaraan'],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={`gps-tab ${tab === value ? 'gps-tab-active' : ''}`}
                    onClick={() => setTab(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'detail' && (
                <div className="detail-grid gps-detail-grid">
                  <DetailItem label="Nomor polisi">{detail.vehicle.plateNumber}</DetailItem>
                  <DetailItem label="Kendaraan">{detail.vehicle.brand} {detail.vehicle.model}</DetailItem>
                  <DetailItem label="Kepemilikan">{statusLabel(detail.vehicle.ownership)}{detail.vehicle.vendor ? ` · ${detail.vehicle.vendor.name}` : ''}</DetailItem>
                  <DetailItem label="Status armada"><Badge value={detail.vehicle.status} /></DetailItem>
                  <DetailItem label="Kecepatan saat ini">{detail.location ? `${Math.round(detail.location.speedKph)} km/jam` : '—'}</DetailItem>
                  <DetailItem label="Posisi terakhir">{detail.location ? `${detail.location.lat.toFixed(5)}, ${detail.location.lng.toFixed(5)}` : '—'}</DetailItem>
                  <DetailItem label="Tujuan">{detail.activeTrip?.booking?.destination || 'Tidak ada trip aktif'}</DetailItem>
                  <DetailItem label="ETA tujuan">
                    {detail.eta ? (
                      <div className="gps-eta-detail">
                        <span>{fmtDateTime(detail.eta.etaAt)}</span>
                        <Badge value={detail.eta.status} label={ETA_LABELS[detail.eta.status]} tone={ETA_TONES[detail.eta.status]} />
                        <small className="muted">{detail.eta.remainingMinutes} menit tersisa</small>
                      </div>
                    ) : (
                      'Tidak ada trip aktif'
                    )}
                  </DetailItem>
                  <DetailItem label="Driver">{detail.activeTrip?.driver?.name || 'Tidak ada driver aktif'}</DetailItem>
                  <DetailItem label="Pemohon">{detail.activeTrip?.booking?.requester?.name || '—'}</DetailItem>
                  <DetailItem label="Waktu update terakhir">{detail.location ? fmtDateTime(detail.location.recordedAt) : '—'}</DetailItem>
                  <DetailItem label="Perangkat GPS">
                    {detail.device ? (
                      <>
                        {detail.device.imei} · <Badge value={detail.device.status} /> · {detail.device.provider}
                      </>
                    ) : (
                      'Belum terpasang'
                    )}
                  </DetailItem>
                  <DetailItem label="Ping perangkat terakhir">{detail.device?.lastPingAt ? fmtDateTime(detail.device.lastPingAt) : '—'}</DetailItem>
                  <DetailItem label="Posisi & kecepatan" className="span-2">
                    <span className="gps-demo-note">
                      <AlertTriangle size={13} /> Nilai posisi/kecepatan berasal dari simulator DEMO, bukan perangkat GPS aktual.
                    </span>
                  </DetailItem>
                </div>
              )}

              {tab === 'history' && (
                <div className="gps-tab-panel">
                  <div className="gps-tab-head">
                    <div>
                      <b>Riwayat koordinat</b>
                      <small>24 jam terakhir · {history.length} titik</small>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTab('detail')}>
                      <RefreshCw size={13} /> Tutup
                    </button>
                  </div>
                  {historyLoading ? (
                    <div className="table-state"><Spinner /> Memuat riwayat...</div>
                  ) : history.length === 0 ? (
                    <EmptyState title="Belum ada riwayat koordinat">Simulator belum menulis data untuk rentang ini.</EmptyState>
                  ) : (
                    <div className="table-wrap gps-scroll">
                      <table>
                        <thead>
                          <tr><th>Waktu</th><th>Kecepatan</th><th>Latitude</th><th>Longitude</th><th>Arah</th><th>Trip</th></tr>
                        </thead>
                        <tbody>
                          {[...history].reverse().map((point) => (
                            <tr key={point.id}>
                              <td>{fmtDateTime(point.recordedAt)}</td>
                              <td>{Math.round(point.speedKph)} km/j</td>
                              <td>{point.lat.toFixed(5)}</td>
                              <td>{point.lng.toFixed(5)}</td>
                              <td>{Math.round(point.heading || 0)}°</td>
                              <td>{point.tripId || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="gps-tab-head gps-tab-head-spaced">
                    <div>
                      <b>Trip history</b>
                      <small>{detail.trips.length} perjalanan terakhir</small>
                    </div>
                  </div>
                  {detail.trips.length === 0 ? (
                    <EmptyState title="Belum ada trip">Kendaraan ini belum pernah ditugaskan pada perjalanan.</EmptyState>
                  ) : (
                    <div className="gps-trip-list">
                      {detail.trips.map((trip) => (
                        <div key={trip.id} className="gps-trip-item">
                          <div>
                            <b>{trip.booking?.code || trip.id}</b>
                            <small>{trip.booking?.origin} → {trip.booking?.destination}</small>
                            <small>{trip.driver?.name || 'Tanpa driver'} · {trip._count?.locations ?? 0} titik GPS</small>
                          </div>
                          <div className="gps-trip-actions">
                            <Badge value={trip.status} />
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setTab('replay');
                                setReplayTripId(trip.id);
                              }}
                            >
                              <Play size={12} /> Replay
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'replay' && (
                <div className="gps-tab-panel">
                  <div className="gps-replay-head">
                    <Field label="Pilih perjalanan" className="gps-replay-field">
                      <select value={replayTripId} onChange={(event) => setReplayTripId(event.target.value)}>
                        <option value="">Pilih trip...</option>
                        {detail.trips.map((trip) => (
                          <option key={trip.id} value={trip.id}>
                            {trip.booking?.code} — {trip.booking?.origin} → {trip.booking?.destination}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="gps-replay-controls">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!replay?.points?.length}
                        onClick={() => setReplayPlaying((value) => !value)}
                      >
                        {replayPlaying ? <Pause size={13} /> : <Play size={13} />} {replayPlaying ? 'Pause' : 'Play'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={!replay?.points?.length}
                        onClick={() => {
                          setReplayIndex(0);
                          setReplayPlaying(!!replay?.points?.length);
                        }}
                      >
                        <RotateCcw size={13} /> Ulang
                      </button>
                    </div>
                  </div>

                  {!replay ? (
                    <EmptyState title="Pilih perjalanan">Pilih trip untuk memutar ulang koordinat simulasi.</EmptyState>
                  ) : replay.points.length === 0 ? (
                    <EmptyState title="Tidak ada titik GPS">Trip ini belum memiliki koordinat tersimpan.</EmptyState>
                  ) : (
                    <>
                      <div className="gps-replay-meta">
                        <span><b>{replay.points.length}</b> titik</span>
                        <span><Gauge size={13} /> {Math.round(replayPoint?.speedKph || 0)} km/j</span>
                        <span><Clock size={13} /> {replayPoint ? fmtDateTime(replayPoint.recordedAt) : '—'}</span>
                        <span>{replay.trip.driver?.name || 'Tanpa driver'}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(0, replay.points.length - 1)}
                        value={replayIndex}
                        onChange={(event) => {
                          setReplayPlaying(false);
                          setReplayIndex(Number(event.target.value));
                        }}
                        className="gps-replay-range"
                      />
                      <div className="gps-replay-progress">
                        <span>Titik {replayIndex + 1} / {replay.points.length}</span>
                        <span>{Math.round(((replayIndex + 1) / replay.points.length) * 100)}%</span>
                      </div>
                      <p className="gps-demo-note">
                        <AlertTriangle size={13} /> Jejak replay berasal dari data simulator DEMO untuk keperluan demonstrasi.
                      </p>
                    </>
                  )}
                </div>
              )}

              {tab === 'events' && (
                <div className="gps-tab-panel">
                  <div className="gps-tab-head">
                    <div>
                      <b>Event kendaraan</b>
                      <small>{detail.events.length} event terakhir</small>
                    </div>
                  </div>
                  {detail.events.length === 0 ? (
                    <EmptyState title="Tidak ada event">Belum ada event GPS untuk kendaraan ini.</EmptyState>
                  ) : (
                    <ul className="gps-event-list">
                      {detail.events.map((event) => (
                        <li key={event.id}>
                          <Badge value={event.type} label={eventLabels[event.type] || event.type} tone={EVENT_TONES[event.type]} />
                          <div>
                            <b>{event.message}</b>
                            <small>{fmtDateTime(event.occurredAt)}{event.geofence ? ` · ${event.geofence.name}` : ''}</small>
                            {event.acknowledgedAt && (
                              <small className="gps-ack">
                                <CheckCircle2 size={11} /> Dikonfirmasi {event.acknowledgedBy?.name || 'petugas'} · {fmtDateTime(event.acknowledgedAt)}
                              </small>
                            )}
                          </div>
                          {!event.acknowledgedAt && canWrite && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm gps-ack-btn"
                              onClick={() => acknowledgeEvent(event)}
                              disabled={acknowledging === event.id}
                            >
                              Konfirmasi
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          ) : null}
        </section>
      )}

      {eventsModal && (
        <Modal
          title="GPS Event & Alerts"
          subtitle="Event simulasi DEMO — bukan peringatan perangkat GPS sungguhan."
          onClose={() => setEventsModal(false)}
          size="lg"
          footer={
            <button type="button" className="btn btn-secondary" onClick={() => setEventsModal(false)}>
              Tutup
            </button>
          }
        >
          <div className="gps-modal-toolbar">
            <div className="gps-toolbar-selects">
              <select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
                <option value="ALL">Semua tipe event</option>
                {(options.eventTypes || []).map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
              <select value={eventAck} onChange={(event) => setEventAck(event.target.value)}>
                <option value="ALL">Semua konfirmasi</option>
                <option value="false">Belum dikonfirmasi</option>
                <option value="true">Sudah dikonfirmasi</option>
              </select>
            </div>
            <span className="muted">
              {globalEvents.total} event · {globalEvents.unacknowledged} belum dikonfirmasi
            </span>
          </div>
          {eventsLoading ? (
            <div className="table-state"><Spinner /> Memuat event...</div>
          ) : globalEvents.items.length === 0 ? (
            <EmptyState title="Tidak ada event">Belum ada event untuk filter ini.</EmptyState>
          ) : (
            <ul className="gps-event-list gps-scroll">
              {globalEvents.items.map((event) => (
                <li key={event.id}>
                  <Badge value={event.type} label={globalEvents.labels[event.type] || event.type} tone={EVENT_TONES[event.type]} />
                  <div>
                    <b>{event.message}</b>
                    <small>
                      {event.vehicle?.plateNumber || '—'} · {fmtDateTime(event.occurredAt)}
                      {event.geofence ? ` · ${event.geofence.name}` : ''}
                      {event.speedKph ? ` · ${Math.round(event.speedKph)} km/j` : ''}
                    </small>
                    {event.acknowledgedAt && (
                      <small className="gps-ack">
                        <CheckCircle2 size={11} /> Dikonfirmasi {event.acknowledgedBy?.name || 'petugas'} · {fmtDateTime(event.acknowledgedAt)}
                      </small>
                    )}
                  </div>
                  {!event.acknowledgedAt && canWrite && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm gps-ack-btn"
                      onClick={() => acknowledgeEvent(event)}
                      disabled={acknowledging === event.id}
                    >
                      Konfirmasi
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {geoModal && (
        <Modal
          title="Geofence Management"
          subtitle="Zona simulasi di area Jakarta dan koridor Whoosh."
          onClose={() => {
            setGeoModal(false);
            setGeoForm(null);
          }}
          size="lg"
          footer={
            <button type="button" className="btn btn-secondary" onClick={() => { setGeoModal(false); setGeoForm(null); }}>
              Tutup
            </button>
          }
        >
          <div className="gps-modal-toolbar">
            <span className="muted">{geofences.length} geofence</span>
            {canWrite && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openGeoForm()}>
                <MapPin size={13} /> Tambah geofence
              </button>
            )}
          </div>

          {geoForm ? (
            <div className="gps-form">
              <div className="form-grid">
                <Field label="Nama geofence">
                  <input value={geoForm.name} onChange={(event) => setGeoForm({ ...geoForm, name: event.target.value })} placeholder="Contoh: Stasiun Halim" />
                </Field>
                <Field label="Kategori">
                  <select value={geoForm.category} onChange={(event) => setGeoForm({ ...geoForm, category: event.target.value })}>
                    {Object.entries(GEOFENCE_CATEGORIES).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Latitude pusat">
                  <input type="number" step="0.00001" value={geoForm.centerLat} onChange={(event) => setGeoForm({ ...geoForm, centerLat: event.target.value })} />
                </Field>
                <Field label="Longitude pusat">
                  <input type="number" step="0.00001" value={geoForm.centerLng} onChange={(event) => setGeoForm({ ...geoForm, centerLng: event.target.value })} />
                </Field>
                <Field label="Radius (meter)">
                  <input type="number" min="50" max="20000" value={geoForm.radiusM} onChange={(event) => setGeoForm({ ...geoForm, radiusM: event.target.value })} />
                </Field>
                <Field label="Status">
                  <select value={geoForm.active ? 'ACTIVE' : 'INACTIVE'} onChange={(event) => setGeoForm({ ...geoForm, active: event.target.value === 'ACTIVE' })}>
                    <option value="ACTIVE">Aktif</option>
                    <option value="INACTIVE">Nonaktif</option>
                  </select>
                </Field>
                <Field label="Catatan" className="span-2">
                  <input value={geoForm.notes} onChange={(event) => setGeoForm({ ...geoForm, notes: event.target.value })} placeholder="Opsional" />
                </Field>
              </div>
              <div className="gps-form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setGeoForm(null)}>Batal</button>
                <button type="button" className="btn btn-primary" onClick={saveGeofence}>Simpan geofence</button>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Nama</th><th>Kategori</th><th>Pusat</th><th>Radius</th><th>Status</th>{canWrite && <th>Aksi</th>}</tr>
                </thead>
                <tbody>
                  {geofences.map((fence) => (
                    <tr key={fence.id}>
                      <td><b>{fence.name}</b></td>
                      <td>{GEOFENCE_CATEGORIES[fence.category] || fence.category}</td>
                      <td>{fence.centerLat.toFixed(4)}, {fence.centerLng.toFixed(4)}</td>
                      <td>{fence.radiusM} m</td>
                      <td><Badge value={fence.active ? 'ACTIVE' : 'INACTIVE'} /></td>
                      {canWrite && (
                        <td>
                          <div className="row-actions">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openGeoForm(fence)}>Ubah</button>
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteGeofence(fence)}>Hapus</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {deviceModal && (
        <Modal
          title="GPS Device Management"
          subtitle="Semua perangkat di sini adalah perangkat simulasi DEMO."
          onClose={() => {
            setDeviceModal(false);
            setDeviceForm(null);
          }}
          size="lg"
          footer={
            <button type="button" className="btn btn-secondary" onClick={() => { setDeviceModal(false); setDeviceForm(null); }}>
              Tutup
            </button>
          }
        >
          <div className="gps-modal-toolbar">
            <span className="muted">{devices.length} perangkat terdaftar</span>
            {canWrite && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openDeviceForm()}>
                <Cpu size={13} /> Tambah perangkat
              </button>
            )}
          </div>

          {deviceForm ? (
            <div className="gps-form">
              <div className="form-grid">
                <Field
                  label="Kendaraan"
                  hint={
                    options.vehicles.length > 0 &&
                    options.vehicles.every((vehicle) => vehicle.gpsDevice && vehicle.gpsDevice.id !== deviceForm.id)
                      ? 'Semua kendaraan sudah memiliki perangkat GPS. Hapus perangkat lama sebelum menambah yang baru.'
                      : undefined
                  }
                >
                  <select value={deviceForm.vehicleId} onChange={(event) => setDeviceForm({ ...deviceForm, vehicleId: event.target.value })}>
                    <option value="">Pilih kendaraan...</option>
                    {options.vehicles
                      .filter((vehicle) => !vehicle.gpsDevice || vehicle.gpsDevice.id === deviceForm.id)
                      .map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.plateNumber} — {vehicle.brand} {vehicle.model}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="IMEI">
                  <input value={deviceForm.imei} onChange={(event) => setDeviceForm({ ...deviceForm, imei: event.target.value })} placeholder="15 digit IMEI" />
                </Field>
                <Field label="Nomor SIM">
                  <input value={deviceForm.simNumber} onChange={(event) => setDeviceForm({ ...deviceForm, simNumber: event.target.value })} placeholder="Opsional" />
                </Field>
                <Field label="Status perangkat">
                  <select value={deviceForm.status} onChange={(event) => setDeviceForm({ ...deviceForm, status: event.target.value })}>
                    <option value="ACTIVE">Aktif</option>
                    <option value="INACTIVE">Nonaktif</option>
                  </select>
                </Field>
                <Field label="Tanggal pasang">
                  <input type="date" value={deviceForm.installedAt} onChange={(event) => setDeviceForm({ ...deviceForm, installedAt: event.target.value })} />
                </Field>
                <Field label="Provider">
                  <input value={deviceForm.provider} disabled />
                </Field>
              </div>
              <div className="gps-form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setDeviceForm(null)}>Batal</button>
                <button type="button" className="btn btn-primary" onClick={saveDevice}>Simpan perangkat</button>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Kendaraan</th><th>IMEI</th><th>SIM</th><th>Status</th><th>Ping terakhir</th>{canWrite && <th>Aksi</th>}</tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id}>
                      <td><b>{device.vehicle?.plateNumber}</b><br /><small className="muted">{device.vehicle?.brand} {device.vehicle?.model}</small></td>
                      <td>{device.imei}</td>
                      <td>{device.simNumber || '—'}</td>
                      <td><Badge value={device.status} /></td>
                      <td>{device.lastPingAt ? fmtDateTime(device.lastPingAt) : '—'}</td>
                      {canWrite && (
                        <td>
                          <div className="row-actions">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDeviceForm(device)}>Ubah</button>
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteDevice(device)}>Hapus</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

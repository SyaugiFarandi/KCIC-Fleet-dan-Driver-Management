import { useEffect, useRef, useState } from 'react';
import { CloudUpload, Wifi, WifiOff } from 'lucide-react';
import { flushQueue, readQueue, subscribeQueue } from './offlineQueue.js';
import { useToast } from './ui.jsx';

export default function OfflineQueueChip() {
  const toast = useToast();
  const [count, setCount] = useState(() => readQueue().length);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const flushing = useRef(false);

  useEffect(() => subscribeQueue((items) => setCount(items.length)), []);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const sync = async (silent) => {
    if (flushing.current) return;
    const queued = readQueue();
    if (!queued.length) return;
    flushing.current = true;
    setSyncing(true);
    try {
      const summary = await flushQueue();
      if (!silent || summary.ok || summary.failed || summary.conflict) {
        if (summary.ok) toast.success(`${summary.ok} aksi offline berhasil disinkronkan.`);
        if (summary.failed || summary.conflict) {
          toast.error(summary.messages.slice(0, 2).join(' · ') || 'Sebagian aksi antrean gagal.');
        }
        if (!summary.ok && !summary.failed && !summary.conflict && summary.remaining) {
          toast.error('Masih offline; antrean belum tersinkron.');
        }
      }
    } finally {
      flushing.current = false;
      setSyncing(false);
      setCount(readQueue().length);
    }
  };

  useEffect(() => {
    if (online && readQueue().length) sync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  if (!count) {
    return (
      <span className={`sync-chip sync-chip-static ${online ? '' : 'sync-chip-offline'}`} title={online ? 'Online' : 'Offline'}>
        {online ? <Wifi size={14} /> : <WifiOff size={14} />}
        <span>{online ? 'Online' : 'Offline'}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`sync-chip ${online ? '' : 'sync-chip-offline'}`}
      onClick={() => sync(false)}
      disabled={!online || syncing}
      title={online ? 'Sinkronkan aksi offline' : 'Menunggu koneksi untuk sinkronisasi'}
    >
      <CloudUpload size={14} />
      <span>{syncing ? 'Sinkron...' : `${count} antrean`}</span>
    </button>
  );
}

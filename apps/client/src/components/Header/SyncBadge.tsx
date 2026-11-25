import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import type { SyncStatus } from '../../core/yjs/YjsRoomClient.js';

interface Props {
  status: SyncStatus;
}

const STATUS_LABELS: Record<SyncStatus, string> = {
  online: 'En línea (Sync)',
  syncing: 'Sincronizando...',
  offline: 'Modo Local (IndexedDB)',
};

export function SyncBadge({ status }: Props) {
  const label = STATUS_LABELS[status];

  return (
    <div
      title={label}
      aria-label={`Estado de sincronización: ${label}`}
      className="flex items-center gap-1.5 lg:gap-2 px-2 lg:px-3 py-1 rounded-full text-xs font-medium border bg-slate-900/80 border-slate-800"
    >
      {status === 'online' && (
        <>
          <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse shrink-0" />
          <span className="hidden lg:inline text-emerald-400">{label}</span>
        </>
      )}
      {status === 'syncing' && (
        <>
          <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
          <span className="hidden lg:inline text-amber-400">{label}</span>
        </>
      )}
      {status === 'offline' && (
        <>
          <WifiOff className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="hidden lg:inline text-blue-400">{label}</span>
        </>
      )}
    </div>
  );
}

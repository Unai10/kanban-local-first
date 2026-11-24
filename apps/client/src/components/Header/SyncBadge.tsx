import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import type { SyncStatus } from '../../core/yjs/YjsRoomClient.js';

interface Props {
  status: SyncStatus;
}

export function SyncBadge({ status }: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border bg-slate-900/80 border-slate-800">
      {status === 'online' && (
        <>
          <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span className="text-emerald-400">En línea (Sync)</span>
        </>
      )}
      {status === 'syncing' && (
        <>
          <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
          <span className="text-amber-400">Sincronizando...</span>
        </>
      )}
      {status === 'offline' && (
        <>
          <WifiOff className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-blue-400">Modo Local (IndexedDB)</span>
        </>
      )}
    </div>
  );
}

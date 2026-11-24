import type { WebSocket } from 'ws';
import type * as Y from 'yjs';
import type * as awarenessProtocol from 'y-protocols/awareness';

export type BoardRole = 'owner' | 'member';

export interface Room {
  name: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Set<WebSocket>;
  connRoles: Map<WebSocket, BoardRole>;
  connClientIds: Map<WebSocket, Set<number>>;
  updatesSinceCompact: number;
  idleTimer: NodeJS.Timeout | null;
  destroyed: boolean;
}

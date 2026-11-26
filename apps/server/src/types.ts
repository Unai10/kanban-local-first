import type { WebSocket } from 'ws';
import type * as Y from 'yjs';
import type * as awarenessProtocol from 'y-protocols/awareness';
import type { BoardRole } from '@kanban/shared-types';

export type { BoardRole };

export interface Room {
  name: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Set<WebSocket>;
  connRoles: Map<WebSocket, BoardRole>;
  connUserIds: Map<WebSocket, string>;
  connClientIds: Map<WebSocket, Set<number>>;
  updatesSinceCompact: number;
  idleTimer: NodeJS.Timeout | null;
  destroyed: boolean;
}

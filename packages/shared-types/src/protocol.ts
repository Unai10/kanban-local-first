/** Roles soportados en un tablero Kanban colaborativo. */
export type BoardRole = 'owner' | 'admin' | 'member';

/** Roles asignables por el propietario a otros colaboradores. */
export type AssignableBoardRole = 'admin' | 'member';

/** Códigos de tipo de mensaje binario multiplexados sobre el WebSocket de sala. */
export const WS_MESSAGE_TYPE = {
  SYNC: 0,
  AWARENESS: 1,
  BOARD_META: 2,
} as const;

/** Códigos de cierre WebSocket específicos de dominio para autorización y ciclo de vida. */
export const WS_CLOSE_CODE = {
  BAD_REQUEST: 4400,
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  BOARD_DELETED: 4410,
  RATE_LIMITED: 4429,
} as const;

/** Metadatos autoritativos del tablero enviados por el servidor vía WebSocket. */
export interface ServerBoardMetaPayload {
  boardId: string;
  title: string;
  ownerId: string;
  ownerName: string;
  joinCode?: string;
  role: BoardRole;
  columnsReverted?: boolean;
}

/** Credencial enviada por el cliente para sincronizar metadatos de un tablero del sidebar. */
export interface BoardMetaSyncRequestItem {
  boardId: string;
  userId?: string;
  inviteToken?: string;
  ownerToken?: string;
  joinCode?: string;
}

/** Respuesta de metadatos por tablero devuelta por `POST /api/boards/metadata`. */
export interface BoardMetaSyncItem {
  boardId: string;
  title?: string;
  ownerId?: string;
  ownerName?: string;
  joinCode?: string;
  role?: BoardRole;
  deleted?: boolean;
}

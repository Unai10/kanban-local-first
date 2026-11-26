import type { BoardRole } from '../protocol.js';
import type { UUID } from './card.js';

/** Columna de un tablero Kanban ordenada mediante clave fraccionaria. */
export interface Column {
  id: UUID;
  boardId: UUID;
  title: string;
  orderKey: string;
  color?: string;
  createdAt: number;
  updatedAt?: number;
  deleted?: boolean;
  deletedAt?: number | null;
  deletedTargetColumnId?: string | null;
}

/** Posición del cursor remoto relativa al lienzo scrollable del tablero. */
export interface CursorPosition {
  x: number;
  y: number;
}

/** Tipo de actividad efímera mostrada en tarjetas/columnas mediante Awareness. */
export type UserActionType = 'editing-card' | 'creating-card' | 'dragging-card' | 'dragging-column';

/** Detalle de la acción en curso de un colaborador. */
export interface UserActivity {
  action: UserActionType;
  cardId?: string;
  columnId?: string;
}

/** Estado de presencia en tiempo real transmitido por y-protocols/awareness. */
export interface UserPresence {
  userId: UUID;
  userName: string;
  avatarColor: string;
  cursor?: CursorPosition | null;
  activity?: UserActivity | null;
  lastActive: number;
}

/**
 * Miembro persistido en el Y.Doc del tablero para mantener nombres/colores
 * actualizados en asignaciones de tarjetas, rol asignado y registrar abandonos del tablero.
 */
export interface BoardMember {
  userId: UUID;
  name: string;
  color: string;
  role?: BoardRole;
  updatedAt: number;
  left?: boolean;
  leftAt?: number | null;
}

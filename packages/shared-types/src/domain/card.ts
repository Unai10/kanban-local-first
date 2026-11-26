export type UUID = string;

/** Niveles de prioridad soportados por una tarjeta Kanban. */
export type CardPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Elemento individual dentro de la checklist de subtareas de una tarjeta. */
export interface ChecklistItem {
  id: UUID;
  text: string;
  completed: boolean;
}

/** Responsable asignado a una tarjeta (puede corresponder a un miembro o texto libre). */
export interface CardAssignee {
  userId?: UUID;
  name: string;
  color?: string;
}

/** Etiqueta visual coloreada asociada a una tarjeta. */
export interface Label {
  id: UUID;
  name: string;
  color: string;
}

/** Entidad de tarjeta Kanban sincronizada mediante CRDT Yjs (Edit-Wins al borrar). */
export interface Card {
  id: UUID;
  boardId: UUID;
  columnId: UUID;
  title: string;
  description: string;
  orderKey: string;
  labels: Label[];
  priority?: CardPriority | null;
  dueDate?: number | null;
  assignee?: CardAssignee | null;
  checklist?: ChecklistItem[];
  storyPoints?: number | null;
  createdAt: number;
  updatedAt: number;
  editCount?: number;
  deleted?: boolean;
  deletedAtEditCount?: number;
  deletedAt?: number | null;
}

/** Comentario colaborativo asociado a una tarjeta y sincronizado mediante CRDT. */
export interface CardComment {
  id: UUID;
  cardId: UUID;
  authorId: UUID;
  authorName: string;
  authorColor: string;
  text: string;
  createdAt: number;
  deleted?: boolean;
  deletedAt?: number | null;
}

/** Formato portátil de exportación e importación de un tablero Kanban. */
export interface BoardExportSnapshot {
  version: 1;
  exportedAt: number;
  title: string;
  columns: Array<{
    id: UUID;
    title: string;
    orderKey: string;
    color?: string;
    createdAt: number;
  }>;
  cards: Array<Omit<Card, 'boardId' | 'deleted' | 'deletedAt' | 'deletedAtEditCount'>>;
  comments: Array<Omit<CardComment, 'deleted' | 'deletedAt'>>;
}

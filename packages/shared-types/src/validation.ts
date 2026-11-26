import type {
  BoardExportSnapshot,
  CardAssignee,
  CardComment,
  CardPriority,
  ChecklistItem,
  Label,
} from './domain/card.js';
import type { BoardMember, CursorPosition, UserActivity } from './domain/board.js';
import type { BoardRole } from './protocol.js';
import { validateOrderKey } from './fractionalIndex.js';

export const ROOM_NAME_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const LIMITS = {
  BOARD_TITLE_MAX: 80,
  CARD_TITLE_MAX: 140,
  CARD_DESC_MAX: 5000,
  USER_NAME_MAX: 40,
  COLUMN_TITLE_MAX: 60,
  LABEL_NAME_MAX: 32,
  MAX_LABELS_PER_CARD: 12,
  CHECKLIST_ITEM_MAX: 120,
  MAX_CHECKLIST_ITEMS: 30,
  MAX_STORY_POINTS: 100,
  MAX_CARDS_PER_BOARD: 2000,
  MAX_COLUMNS_PER_BOARD: 30,
  COMMENT_MAX: 1000,
  MAX_COMMENTS_PER_BOARD: 5000,
  MAX_IMPORT_BYTES: 2_000_000,
} as const;

/**
 * Sanitiza texto de una sola línea eliminando caracteres de control y acotando longitud.
 */
export function sanitizeSingleLineText(value: unknown, maxLen: number, fallback: string = ''): string {
  if (typeof value !== 'string') return fallback;
  // Eliminar caracteres ASCII de control (\x00-\x1F, \x7F)
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen);
}

/**
 * Sanitiza texto multilínea preservando saltos de línea y tabulaciones.
 */
export function sanitizeMultilineText(value: unknown, maxLen: number, fallback: string = ''): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen);
}

/**
 * Valida estrictamente un color hexadecimal (#RRGGBB).
 */
export function sanitizeHexColor(value: unknown, fallback: string = '#3b82f6'): string {
  if (typeof value === 'string' && HEX_COLOR_REGEX.test(value)) {
    return value;
  }
  return fallback;
}

/**
 * Comprueba sin lanzar excepción si una clave fraccionaria es válida.
 */
export function isValidOrderKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  try {
    validateOrderKey(key);
    return true;
  } catch {
    return false;
  }
}

/** Valida una etiqueta de tarjeta verificando nombre acotado y color hexadecimal. */
export function validateLabel(value: unknown): value is Label {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 64 &&
    typeof v.name === 'string' && v.name.length > 0 && v.name.length <= LIMITS.LABEL_NAME_MAX &&
    typeof v.color === 'string' && HEX_COLOR_REGEX.test(v.color)
  );
}

/** Valida coordenadas finitas y acotadas de cursor remoto para evitar valores maliciosos. */
export function validateCursor(value: unknown): value is CursorPosition {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x === 'number' && Number.isFinite(v.x) && v.x >= -10000 && v.x <= 100000 &&
    typeof v.y === 'number' && Number.isFinite(v.y) && v.y >= -10000 && v.y <= 100000
  );
}

/** Sanitiza el descriptor de actividad efímera mostrado en Awareness. */
export function sanitizeActivity(value: unknown): UserActivity | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    v.action !== 'editing-card' &&
    v.action !== 'creating-card' &&
    v.action !== 'dragging-card' &&
    v.action !== 'dragging-column'
  ) {
    return null;
  }
  const activity: UserActivity = { action: v.action };
  if (typeof v.cardId === 'string' && v.cardId.length > 0 && v.cardId.length <= 64) {
    activity.cardId = sanitizeSingleLineText(v.cardId, 64);
  }
  if (typeof v.columnId === 'string' && v.columnId.length > 0 && v.columnId.length <= 64) {
    activity.columnId = sanitizeSingleLineText(v.columnId, 64);
  }
  return activity;
}

/** Valida el nivel de prioridad permitido en una tarjeta Kanban. */
export function sanitizePriority(value: unknown): CardPriority | null {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'urgent') {
    return value;
  }
  return null;
}

/** Sanitiza un timestamp positivo de fecha límite. */
export function sanitizeDueDate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  return null;
}

/** Sanitiza la estimación numérica de puntos de esfuerzo (1..MAX_STORY_POINTS). */
export function sanitizeStoryPoints(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= LIMITS.MAX_STORY_POINTS) {
    return Math.round(value * 10) / 10;
  }
  return null;
}

/** Sanitiza y acota la lista de subtareas de una tarjeta. */
export function sanitizeChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  const items: ChecklistItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as Record<string, unknown>;
    const id = sanitizeSingleLineText(v.id, 64);
    const text = sanitizeSingleLineText(v.text, LIMITS.CHECKLIST_ITEM_MAX);
    if (!id || !text) continue;
    items.push({
      id,
      text,
      completed: v.completed === true,
    });
    if (items.length >= LIMITS.MAX_CHECKLIST_ITEMS) break;
  }
  return items;
}

/** Sanitiza el responsable asignado a una tarjeta (usuario registrado o nombre libre). */
export function sanitizeAssignee(value: unknown): CardAssignee | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const name = sanitizeSingleLineText(v.name, LIMITS.USER_NAME_MAX);
  if (!name) return null;
  const userId = sanitizeSingleLineText(v.userId, 64);
  const color = typeof v.color === 'string' && HEX_COLOR_REGEX.test(v.color) ? v.color : undefined;
  return {
    ...(userId ? { userId } : {}),
    name,
    ...(color ? { color } : {}),
  };
}

/** Sanitiza un rol de tablero a los valores válidos (`owner` | `admin` | `member`). */
export function sanitizeBoardRole(value: unknown, fallback: BoardRole = 'member'): BoardRole {
  if (value === 'owner' || value === 'admin' || value === 'member') {
    return value;
  }
  return fallback;
}

/**
 * Sanitiza la entrada de un miembro almacenado en el mapa `members` del Y.Doc.
 */
export function sanitizeBoardMember(value: unknown, fallbackUserId: string = ''): BoardMember | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const userId = sanitizeSingleLineText(v.userId ?? fallbackUserId, 64);
  if (!userId) return null;
  const left = v.left === true;
  const name = sanitizeSingleLineText(v.name, LIMITS.USER_NAME_MAX, left ? 'Exmiembro' : 'Colaborador');
  const color = sanitizeHexColor(v.color, '#6366f1');
  const role = v.role !== undefined ? sanitizeBoardRole(v.role, 'member') : undefined;
  const updatedAt = typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) ? v.updatedAt : 0;
  const leftAt = typeof v.leftAt === 'number' && Number.isFinite(v.leftAt) ? v.leftAt : null;
  return {
    userId,
    name,
    color,
    ...(role ? { role } : {}),
    updatedAt,
    ...(left ? { left: true } : {}),
    ...(leftAt !== null ? { leftAt } : {}),
  };
}

/**
 * Sanitiza un comentario asociado a una tarjeta Kanban.
 */
export function sanitizeCardComment(value: unknown, fallbackId: string = ''): CardComment | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const id = sanitizeSingleLineText(v.id ?? fallbackId, 64);
  const cardId = sanitizeSingleLineText(v.cardId, 64);
  const authorId = sanitizeSingleLineText(v.authorId, 64);
  const text = sanitizeMultilineText(v.text, LIMITS.COMMENT_MAX, '');
  if (!id || !cardId || !authorId || !text) return null;

  const authorName = sanitizeSingleLineText(v.authorName, LIMITS.USER_NAME_MAX, 'Colaborador');
  const authorColor = sanitizeHexColor(v.authorColor, '#6366f1');
  const createdAt = typeof v.createdAt === 'number' && Number.isFinite(v.createdAt) ? Math.trunc(v.createdAt) : 0;
  const deleted = v.deleted === true;
  const deletedAt = typeof v.deletedAt === 'number' && Number.isFinite(v.deletedAt) ? Math.trunc(v.deletedAt) : null;

  return {
    id,
    cardId,
    authorId,
    authorName,
    authorColor,
    text,
    createdAt,
    ...(deleted ? { deleted: true } : {}),
    ...(deletedAt !== null ? { deletedAt } : {}),
  };
}

/**
 * Valida y sanitiza un snapshot JSON exportado para importación segura de un tablero.
 */
export function validateBoardExportSnapshot(value: unknown): BoardExportSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.columns) || !Array.isArray(v.cards)) {
    return null;
  }
  if (v.columns.length === 0 || v.columns.length > LIMITS.MAX_COLUMNS_PER_BOARD) {
    return null;
  }
  if (v.cards.length > LIMITS.MAX_CARDS_PER_BOARD) {
    return null;
  }

  const title = sanitizeSingleLineText(v.title, LIMITS.BOARD_TITLE_MAX, 'Tablero Importado');
  const exportedAt = typeof v.exportedAt === 'number' && Number.isFinite(v.exportedAt)
    ? Math.trunc(v.exportedAt)
    : Date.now();

  const columns: BoardExportSnapshot['columns'] = [];
  const columnIds = new Set<string>();
  for (const rawCol of v.columns) {
    if (!rawCol || typeof rawCol !== 'object') return null;
    const c = rawCol as Record<string, unknown>;
    const id = sanitizeSingleLineText(c.id, 64);
    const colTitle = sanitizeSingleLineText(c.title, LIMITS.COLUMN_TITLE_MAX);
    if (!id || !colTitle || columnIds.has(id)) return null;
    columnIds.add(id);
    columns.push({
      id,
      title: colTitle,
      orderKey: isValidOrderKey(c.orderKey) ? c.orderKey : 'a0',
      ...(typeof c.color === 'string' && HEX_COLOR_REGEX.test(c.color) ? { color: c.color } : {}),
      createdAt: typeof c.createdAt === 'number' && Number.isFinite(c.createdAt) ? Math.trunc(c.createdAt) : Date.now(),
    });
  }

  const fallbackColumnId = columns[0].id;
  const cards: BoardExportSnapshot['cards'] = [];
  const cardIds = new Set<string>();
  for (const rawCard of v.cards) {
    if (!rawCard || typeof rawCard !== 'object') continue;
    const c = rawCard as Record<string, unknown>;
    const id = sanitizeSingleLineText(c.id, 64);
    const cardTitle = sanitizeSingleLineText(c.title, LIMITS.CARD_TITLE_MAX);
    if (!id || !cardTitle || cardIds.has(id)) continue;
    cardIds.add(id);
    const rawColumnId = sanitizeSingleLineText(c.columnId, 64);
    const columnId = columnIds.has(rawColumnId) ? rawColumnId : fallbackColumnId;
    const labels = Array.isArray(c.labels)
      ? c.labels.filter(validateLabel).slice(0, LIMITS.MAX_LABELS_PER_CARD)
      : [];
    cards.push({
      id,
      columnId,
      title: cardTitle,
      description: sanitizeMultilineText(c.description, LIMITS.CARD_DESC_MAX, ''),
      orderKey: isValidOrderKey(c.orderKey) ? c.orderKey : 'a0',
      labels,
      priority: sanitizePriority(c.priority),
      dueDate: sanitizeDueDate(c.dueDate),
      assignee: sanitizeAssignee(c.assignee),
      checklist: sanitizeChecklist(c.checklist),
      storyPoints: sanitizeStoryPoints(c.storyPoints),
      createdAt: typeof c.createdAt === 'number' && Number.isFinite(c.createdAt) ? Math.trunc(c.createdAt) : Date.now(),
      updatedAt: typeof c.updatedAt === 'number' && Number.isFinite(c.updatedAt) ? Math.trunc(c.updatedAt) : Date.now(),
    });
  }

  const comments: BoardExportSnapshot['comments'] = [];
  if (Array.isArray(v.comments)) {
    for (const rawComment of v.comments.slice(0, LIMITS.MAX_COMMENTS_PER_BOARD)) {
      const sanitized = sanitizeCardComment(rawComment);
      if (sanitized && cardIds.has(sanitized.cardId)) {
        comments.push({
          id: sanitized.id,
          cardId: sanitized.cardId,
          authorId: sanitized.authorId,
          authorName: sanitized.authorName,
          authorColor: sanitized.authorColor,
          text: sanitized.text,
          createdAt: sanitized.createdAt,
        });
      }
    }
  }

  return {
    version: 1,
    exportedAt,
    title,
    columns,
    cards,
    comments,
  };
}

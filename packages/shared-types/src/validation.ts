import type { CardAssignee, CardPriority, ChecklistItem, Label } from './domain/card.js';
import type { BoardMember, CursorPosition, UserActivity } from './domain/board.js';
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
  if (v.action !== 'editing-card' && v.action !== 'creating-card' && v.action !== 'dragging-card') {
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
  const updatedAt = typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) ? v.updatedAt : 0;
  const leftAt = typeof v.leftAt === 'number' && Number.isFinite(v.leftAt) ? v.leftAt : null;
  return {
    userId,
    name,
    color,
    updatedAt,
    ...(left ? { left: true } : {}),
    ...(leftAt !== null ? { leftAt } : {}),
  };
}

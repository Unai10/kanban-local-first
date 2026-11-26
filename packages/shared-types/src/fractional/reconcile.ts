import { compareCards, compareOrderKeys } from './compare.js';
import { generateNKeysBetween } from '../fractionalIndex.js';

export interface OrderableColumnItem {
  id: string;
  columnId: string;
  orderKey: string;
}

export interface OrderKeyRepair {
  id: string;
  orderKey: string;
}

/**
 * Resuelve de forma determinista colisiones de `orderKey` en una colección plana
 * (por ejemplo columnas de un mismo tablero creadas o reordenadas offline).
 */
export function computeFlatOrderKeyRepairs<T extends { id: string; orderKey: string }>(
  items: readonly T[]
): OrderKeyRepair[] {
  if (items.length < 2) return [];

  const sorted = [...items].sort(compareCards);
  const repairs: OrderKeyRepair[] = [];
  let i = 0;

  while (i < sorted.length) {
    const anchorKey = sorted[i].orderKey;
    let j = i + 1;

    while (j < sorted.length && compareOrderKeys(sorted[j].orderKey, anchorKey) <= 0) {
      j += 1;
    }

    const duplicateCount = j - i - 1;
    if (duplicateCount > 0) {
      const nextDistinctKey = j < sorted.length ? sorted[j].orderKey : null;
      const freshKeys = generateNKeysBetween(anchorKey, nextDistinctKey, duplicateCount);
      for (let k = 0; k < duplicateCount; k++) {
        repairs.push({
          id: sorted[i + 1 + k].id,
          orderKey: freshKeys[k],
        });
      }
    }

    i = j;
  }

  return repairs;
}

/**
 * Detecta y resuelve de forma determinista colisiones de `orderKey` dentro de cada columna
 * (por ejemplo cuando dos usuarios crean o mueven tarjetas offline con la misma clave).
 * La primera tarjeta de cada bloque (menor `id` según `compareCards`) conserva su clave;
 * las restantes reciben claves equitativas hasta la siguiente clave estrictamente mayor.
 */
export function computeOrderKeyRepairs<T extends OrderableColumnItem>(
  cards: readonly T[]
): OrderKeyRepair[] {
  if (cards.length < 2) return [];

  const byColumn = new Map<string, T[]>();
  for (const card of cards) {
    let list = byColumn.get(card.columnId);
    if (!list) {
      list = [];
      byColumn.set(card.columnId, list);
    }
    list.push(card);
  }

  const repairs: OrderKeyRepair[] = [];
  for (const colCards of byColumn.values()) {
    repairs.push(...computeFlatOrderKeyRepairs(colCards));
  }

  return repairs;
}

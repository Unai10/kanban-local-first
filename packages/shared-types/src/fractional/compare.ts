/**
 * Comparador canónico de claves fraccionarias basado en orden de código ASCII.
 * Garantiza coherencia total con generateFractionalKey y la jerarquía de caracteres Base62.
 */
export function compareOrderKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Comparador total para elementos ordenables (tarjetas o columnas):
 * Ordena por orderKey usando compareOrderKeys, con desempate determinista por id.
 */
export function compareSortableItems<T extends { orderKey: string; id: string }>(a: T, b: T): number {
  const cmp = compareOrderKeys(a.orderKey, b.orderKey);
  return cmp !== 0 ? cmp : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const compareCards = compareSortableItems;
export const compareColumns = compareSortableItems;

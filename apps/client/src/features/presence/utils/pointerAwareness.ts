export const DESKTOP_FINE_POINTER_QUERY = '(min-width: 768px) and (hover: hover) and (pointer: fine)';

/**
 * Comprueba si el viewport actual corresponde a escritorio con puntero fino (ratón/trackpad)
 * en el que las coordenadas de cursor son precisas entre clientes.
 */
export function isDesktopFinePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(DESKTOP_FINE_POINTER_QUERY).matches;
}

/**
 * Determina si un evento de puntero debe emitir coordenadas de cursor al estado Awareness.
 * Bloquea entradas táctiles, lápiz óptico o viewports móviles para evitar cursores fantasma.
 */
export function shouldBroadcastPointerMove(pointerType: string, isDesktopPointer: boolean): boolean {
  if (!isDesktopPointer) return false;
  return pointerType === 'mouse';
}

import { useEffect, useRef, type RefObject } from 'react';
import type { CursorPosition } from '@kanban/shared-types';

interface UseCursorBroadcastParams {
  containerRef: RefObject<HTMLElement | null>;
  onCursorMove: (pos: CursorPosition | null) => void;
}

// Limita el envío de cursor a ~25 FPS para no saturar el límite de 120 msg/s en monitores >120 Hz.
const MIN_BROADCAST_INTERVAL_MS = 40;

/**
 * Captura el movimiento del puntero dentro del lienzo del tablero y emite
 * coordenadas relativas normalizadas hacia el estado Awareness de Yjs.
 */
export function useCursorBroadcast({ containerRef, onCursorMove }: UseCursorBroadcastParams) {
  const rafId = useRef<number | null>(null);
  const throttleTimerId = useRef<number | null>(null);
  const pendingPos = useRef<CursorPosition | null>(null);
  const lastSentAt = useRef<number>(0);
  const hadActiveCursor = useRef<boolean>(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const clearScheduled = () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      if (throttleTimerId.current !== null) {
        window.clearTimeout(throttleTimerId.current);
        throttleTimerId.current = null;
      }
    };

    const flush = () => {
      rafId.current = null;
      const now = performance.now();
      const elapsed = now - lastSentAt.current;
      if (elapsed < MIN_BROADCAST_INTERVAL_MS) {
        if (throttleTimerId.current === null) {
          throttleTimerId.current = window.setTimeout(() => {
            throttleTimerId.current = null;
            if (pendingPos.current !== null) {
              lastSentAt.current = performance.now();
              hadActiveCursor.current = true;
              onCursorMove(pendingPos.current);
            }
          }, MIN_BROADCAST_INTERVAL_MS - elapsed);
        }
        return;
      }

      lastSentAt.current = now;
      hadActiveCursor.current = pendingPos.current !== null;
      onCursorMove(pendingPos.current);
    };

    const handleMouseLeave = () => {
      pendingPos.current = null;
      clearScheduled();
      if (hadActiveCursor.current) {
        hadActiveCursor.current = false;
        onCursorMove(null);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        handleMouseLeave();
        return;
      }

      // Coordenadas relativas al lienzo scrollable
      const x = Math.max(0, Math.round(e.clientX - rect.left + container.scrollLeft));
      const y = Math.max(0, Math.round(e.clientY - rect.top + container.scrollTop));

      pendingPos.current = { x, y };

      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(flush);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleMouseLeave();
      }
    };

    const handleWindowLeave = (e: MouseEvent) => {
      // Desactivar cursor únicamente si el ratón sale realmente fuera de la ventana del documento
      if (!e.relatedTarget && (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight)) {
        handleMouseLeave();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.documentElement.addEventListener('mouseleave', handleWindowLeave);
    window.addEventListener('blur', handleMouseLeave);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.documentElement.removeEventListener('mouseleave', handleWindowLeave);
      window.removeEventListener('blur', handleMouseLeave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearScheduled();
      if (hadActiveCursor.current) {
        hadActiveCursor.current = false;
        onCursorMove(null);
      }
    };
  }, [containerRef, onCursorMove]);
}

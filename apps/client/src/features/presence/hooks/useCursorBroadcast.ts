import { useEffect, useRef, type RefObject } from 'react';
import type { CursorPosition } from '@kanban/shared-types';
import { shouldBroadcastPointerMove } from '../utils/pointerAwareness.js';

interface UseCursorBroadcastParams {
  containerRef: RefObject<HTMLElement | null>;
  onCursorMove: (pos: CursorPosition | null) => void;
  enabled?: boolean;
}

// Limita el envío de cursor a ~25 FPS para no saturar el límite de 120 msg/s en monitores >120 Hz.
const MIN_BROADCAST_INTERVAL_MS = 40;

/**
 * Captura el movimiento del puntero dentro del lienzo del tablero y emite
 * coordenadas relativas normalizadas hacia el estado Awareness de Yjs.
 * Ignora eventos táctiles y se desactiva en viewports móviles.
 */
export function useCursorBroadcast({
  containerRef,
  onCursorMove,
  enabled = true,
}: UseCursorBroadcastParams) {
  const rafId = useRef<number | null>(null);
  const throttleTimerId = useRef<number | null>(null);
  const pendingPos = useRef<CursorPosition | null>(null);
  const lastSentAt = useRef<number>(0);
  const hadActiveCursor = useRef<boolean>(false);

  useEffect(() => {
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

    const clearActiveCursor = () => {
      pendingPos.current = null;
      clearScheduled();
      if (hadActiveCursor.current) {
        hadActiveCursor.current = false;
        onCursorMove(null);
      }
    };

    const container = containerRef.current;
    if (!enabled || !container) {
      clearActiveCursor();
      return;
    }

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

    const emitPosition = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        clearActiveCursor();
        return;
      }

      // Coordenadas relativas al lienzo scrollable
      const x = Math.max(0, Math.round(clientX - rect.left + container.scrollLeft));
      const y = Math.max(0, Math.round(clientY - rect.top + container.scrollTop));

      pendingPos.current = { x, y };

      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(flush);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearActiveCursor();
      }
    };

    const isOutsideViewport = (e: MouseEvent) =>
      !e.relatedTarget &&
      (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight);

    const handleWindowLeave = (e: MouseEvent) => {
      // Desactivar cursor únicamente si el ratón sale realmente fuera de la ventana del documento
      if (isOutsideViewport(e)) {
        clearActiveCursor();
      }
    };

    const supportsPointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window;

    const handlePointerMove = (e: PointerEvent) => {
      if (!shouldBroadcastPointerMove(e.pointerType, enabled)) {
        clearActiveCursor();
        return;
      }
      emitPosition(e.clientX, e.clientY);
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') {
        clearActiveCursor();
      }
    };

    const handleMouseMoveFallback = (e: MouseEvent) => {
      emitPosition(e.clientX, e.clientY);
    };

    if (supportsPointerEvents) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerdown', handlePointerDown);
      window.addEventListener('pointercancel', clearActiveCursor);
      document.documentElement.addEventListener('pointerleave', handleWindowLeave);
    } else {
      window.addEventListener('mousemove', handleMouseMoveFallback);
      document.documentElement.addEventListener('mouseleave', handleWindowLeave);
    }

    window.addEventListener('blur', clearActiveCursor);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (supportsPointerEvents) {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerdown', handlePointerDown);
        window.removeEventListener('pointercancel', clearActiveCursor);
        document.documentElement.removeEventListener('pointerleave', handleWindowLeave);
      } else {
        window.removeEventListener('mousemove', handleMouseMoveFallback);
        document.documentElement.removeEventListener('mouseleave', handleWindowLeave);
      }
      window.removeEventListener('blur', clearActiveCursor);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearActiveCursor();
    };
  }, [containerRef, onCursorMove, enabled]);
}

import { useEffect, useState } from 'react';
import { DESKTOP_FINE_POINTER_QUERY, isDesktopFinePointer } from '../utils/pointerAwareness.js';

/**
 * Suscripción reactiva al soporte de puntero fino en viewport de escritorio (`>= 768px`).
 */
export function useDesktopFinePointer(): boolean {
  const [matches, setMatches] = useState<boolean>(() => isDesktopFinePointer());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia(DESKTOP_FINE_POINTER_QUERY);
    const updateMatch = () => setMatches(mediaQuery.matches);
    updateMatch();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateMatch);
      return () => mediaQuery.removeEventListener('change', updateMatch);
    }

    mediaQuery.addListener(updateMatch);
    return () => mediaQuery.removeListener(updateMatch);
  }, []);

  return matches;
}

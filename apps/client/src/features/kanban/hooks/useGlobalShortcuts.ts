import { useEffect } from 'react';

interface Options {
  isModalOpen: boolean;
  onFocusSearch: () => void;
  onOpenNewCard: () => void;
  onToggleHelp: () => void;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Registra atajos globales de teclado (`/`, `Ctrl/Cmd+K`, `N`, `?`)
 * respetando inputs activos y modales abiertos.
 */
export function useGlobalShortcuts({
  isModalOpen,
  onFocusSearch,
  onOpenNewCard,
  onToggleHelp,
}: Options) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!isModalOpen) onFocusSearch();
        return;
      }

      if (isModalOpen || isEditableElement(e.target)) {
        return;
      }

      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        onFocusSearch();
      } else if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        onOpenNewCard();
      } else if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        onToggleHelp();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, onFocusSearch, onOpenNewCard, onToggleHelp]);
}

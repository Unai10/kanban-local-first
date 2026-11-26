import { Undo2, X } from 'lucide-react';

interface Props {
  cardTitle: string | null;
  onUndo: () => void;
  onDismiss: () => void;
}

/**
 * Toast flotante temporal tras eliminar una tarjeta para revertir el tombstone Edit-Wins.
 */
export function UndoToast({ cardTitle, onUndo, onDismiss }: Props) {
  if (!cardTitle) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-surface border border-border shadow-2xl rounded-xl px-4 py-2.5 text-xs text-slate-100 max-w-[92vw]"
    >
      <span className="truncate max-w-[220px] sm:max-w-xs">
        Tarjeta <strong className="font-semibold">"{cardTitle}"</strong> eliminada
      </span>
      <button
        type="button"
        onClick={onUndo}
        className="flex items-center gap-1 font-semibold text-primary hover:text-blue-400 bg-primary/15 hover:bg-primary/25 border border-primary/30 px-2.5 py-1 rounded-lg transition shrink-0"
      >
        <Undo2 className="w-3.5 h-3.5" />
        Deshacer
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Cerrar aviso de eliminación"
        className="text-slate-400 hover:text-ink p-1 rounded transition shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

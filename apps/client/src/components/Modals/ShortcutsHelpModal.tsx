import { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['/', 'Ctrl + K'], desc: 'Enfocar buscador del tablero' },
  { keys: ['N'], desc: 'Crear nueva tarjeta' },
  { keys: ['Ctrl + Enter'], desc: 'Guardar tarjeta o enviar comentario en el modal' },
  { keys: ['Espacio', 'Flechas'], desc: 'Mover tarjetas o columnas con teclado' },
  { keys: ['Esc'], desc: 'Cerrar modal o menú activo' },
  { keys: ['?'], desc: 'Mostrar u ocultar esta ayuda' },
];

export function ShortcutsHelpModal({ isOpen, onClose }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
    >
      <div
        className="bg-surface border border-border w-full max-w-md rounded-xl shadow-2xl p-4 sm:p-6 relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar ayuda de atajos"
          className="absolute top-4 right-4 text-slate-400 hover:text-ink p-1 rounded-lg hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <Keyboard className="w-5 h-5 text-primary" />
          <h3 id="shortcuts-modal-title" className="text-sm font-semibold text-ink">
            Atajos de Teclado
          </h3>
        </div>

        <div className="space-y-2.5 text-xs">
          {SHORTCUTS.map(s => (
            <div key={s.desc} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-800/70 last:border-0">
              <span className="text-slate-300">{s.desc}</span>
              <div className="flex items-center gap-1 shrink-0">
                {s.keys.map(k => (
                  <kbd
                    key={k}
                    className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200 font-mono text-[10px]"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

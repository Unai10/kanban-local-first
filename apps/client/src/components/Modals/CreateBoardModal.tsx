import { useEffect, useState, type FormEvent } from 'react';
import { LIMITS } from '@kanban/shared-types';
import { X, PlusCircle } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (title: string) => void;
}

export function CreateBoardModal({ isOpen, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate(title.trim());
    setTitle('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-board-modal-title"
    >
      <div
        className="bg-surface border border-border w-full max-w-sm max-h-[92dvh] overflow-y-auto rounded-xl shadow-2xl p-4 sm:p-6 relative animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar modal de nuevo tablero"
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <PlusCircle className="w-5 h-5 text-primary" />
          <h3 id="create-board-modal-title" className="text-sm font-semibold text-white">Nuevo Tablero Kanban</h3>
        </div>

        <form onSubmit={handleSubmit}>
          <label htmlFor="create-board-title" className="text-xs text-slate-400 block mb-1.5 font-medium">
            Nombre del tablero
          </label>
          <input
            id="create-board-title"
            type="text"
            autoFocus
            maxLength={LIMITS.BOARD_TITLE_MAX}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Ej: Sprint Q3, Tareas Personales..."
            className="w-full bg-slate-900 border border-slate-700 text-white text-sm px-3 py-2 rounded-lg mb-5 focus:outline-none focus:border-primary"
          />

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-slate-400 hover:text-white px-3 py-1.5"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="text-xs bg-primary hover:bg-blue-600 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition"
            >
              Crear Tablero
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

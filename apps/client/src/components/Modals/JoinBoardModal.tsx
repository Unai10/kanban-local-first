import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { X, LogIn, Loader2, AlertCircle } from 'lucide-react';
import { ROOM_NAME_REGEX } from '@kanban/shared-types';
import { APP_CONFIG } from '../../core/config/env.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onJoin: (boardId: string, token: string, title?: string, ownerName?: string, joinCode?: string) => void;
}

export function JoinBoardModal({ isOpen, onClose, onJoin }: Props) {
  const [inputVal, setInputVal] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    if (isLoading) return;
    setError(null);
    setInputVal('');
    onClose();
  }, [isLoading, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const raw = inputVal.trim();
    if (!raw) return;

    setError(null);
    setIsLoading(true);

    try {
      // 1. Enlace directo (#board=...&token=... o ?board=...&token=...)
      if (raw.includes('board=') || raw.includes('http')) {
        try {
          const parsed = new URL(raw, window.location.origin);
          const hashParams = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash);
          const boardId = hashParams.get('board') || parsed.searchParams.get('board');
          const token = hashParams.get('token') || parsed.searchParams.get('token');

          if (!boardId || !ROOM_NAME_REGEX.test(boardId)) {
            setError('El enlace no contiene un identificador de tablero válido.');
            setIsLoading(false);
            return;
          }
          if (!token) {
            setError('El enlace no contiene el token de acceso criptográfico necesario.');
            setIsLoading(false);
            return;
          }

          onJoin(boardId, token);
          setInputVal('');
          onClose();
          return;
        } catch {
          // Continuar como código corto si no es URL válida
        }
      }

      // 2. Código corto XXX-XXX
      const res = await fetch(`${APP_CONFIG.getHttpApiUrl()}/api/boards/join/${encodeURIComponent(raw)}`);
      if (res.status === 410) {
        setError('Este tablero fue eliminado definitivamente por su propietario.');
        setIsLoading(false);
        return;
      }
      if (res.status === 429) {
        setError('Demasiados intentos. Espera un minuto antes de volver a probar.');
        setIsLoading(false);
        return;
      }
      if (!res.ok) {
        setError('Tablero no encontrado. Verifica el código e inténtalo de nuevo.');
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      if (data.valid && data.boardId && data.joinCode) {
        onJoin(data.boardId, '', data.title, data.ownerName, data.joinCode);
        setInputVal('');
        onClose();
      } else {
        setError('Tablero no encontrado. Verifica el código e inténtalo de nuevo.');
      }
    } catch (err) {
      console.error('[JoinBoardModal] Error uniendo a tablero:', err);
      setError('Error al consultar el servidor. Comprueba tu conexión a internet.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-board-modal-title"
    >
      <div
        className="bg-surface border border-border w-full max-w-sm max-h-[92dvh] overflow-y-auto rounded-xl shadow-2xl p-4 sm:p-6 relative animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleClose}
          disabled={isLoading}
          aria-label="Cerrar modal de unirse"
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition disabled:opacity-50"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center font-bold">
            <LogIn className="w-4 h-4" />
          </div>
          <div>
            <h3 id="join-board-modal-title" className="text-sm font-semibold text-white">Unirse a un Tablero</h3>
            <p className="text-xs text-slate-400">Introduce el código de sala o el enlace</p>
          </div>
        </div>

        {error && (
          <div className="mt-3 mb-2 p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2 text-xs text-red-400 leading-relaxed">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4">
          <label htmlFor="join-board-input" className="text-xs text-slate-400 block mb-1.5 font-medium">
            Código de Sala o Enlace Directo
          </label>
          <input
            id="join-board-input"
            type="text"
            autoFocus
            disabled={isLoading}
            value={inputVal}
            onChange={e => {
              setInputVal(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Ej: 8K2-9MW o enlace completo..."
            className="w-full bg-slate-900 border border-slate-700 text-white text-sm px-3 py-2 rounded-lg mb-5 focus:outline-none focus:border-primary font-mono disabled:opacity-60"
          />

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={isLoading}
              onClick={handleClose}
              className="text-xs text-slate-400 hover:text-white px-3 py-1.5 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading || !inputVal.trim()}
              className="text-xs bg-primary hover:bg-blue-600 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition flex items-center gap-1.5"
            >
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isLoading ? 'Buscando...' : 'Entrar al Tablero'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { LIMITS, sanitizeSingleLineText, type UserBoardEntry, type UserProfile } from '@kanban/shared-types';
import { X, Kanban, Plus, Trash2, UserCheck, LogOut, LogIn, Pencil, Check } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  boards: UserBoardEntry[];
  currentBoardId: string;
  currentUser: UserProfile;
  onSelectBoard: (boardId: string, token: string) => void;
  onOpenCreateModal: () => void;
  onOpenJoinModal: () => void;
  onOpenProfileModal: () => void;
  onRenameBoard: (boardId: string, newTitle: string) => void;
  onDeleteBoard: (boardId: string) => void;
  onLeaveBoard: (boardId: string) => void;
}

export function BoardSidebar({
  isOpen,
  onClose,
  boards,
  currentBoardId,
  currentUser,
  onSelectBoard,
  onOpenCreateModal,
  onOpenJoinModal,
  onOpenProfileModal,
  onRenameBoard,
  onDeleteBoard,
  onLeaveBoard,
}: Props) {
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingBoardId) {
          setEditingBoardId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, editingBoardId]);

  if (!isOpen) return null;

  const myBoards = boards.filter(b => b.role === 'owner');
  const joinedBoards = boards.filter(b => b.role === 'member');

  const handleRenameSubmit = (e: FormEvent, board: UserBoardEntry) => {
    e.preventDefault();
    e.stopPropagation();
    const clean = sanitizeSingleLineText(draftTitle, LIMITS.BOARD_TITLE_MAX, '');
    if (clean && clean !== board.title) {
      onRenameBoard(board.id, clean);
    }
    setEditingBoardId(null);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Lista de tableros"
    >
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={onClose} />

      <div className="relative w-[85vw] max-w-80 bg-slate-950 border-r border-slate-800 h-full p-4 sm:p-5 flex flex-col z-50 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Kanban className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-sm text-white">Mis Tableros</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar menú lateral"
            className="text-slate-400 hover:text-white p-1 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="my-4 space-y-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenCreateModal();
            }}
            className="flex items-center justify-center gap-2 w-full py-2 bg-primary/20 text-blue-300 border border-primary/40 rounded-lg hover:bg-primary/30 transition text-xs font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>Crear Nuevo Tablero</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenJoinModal();
            }}
            className="flex items-center justify-center gap-2 w-full py-2 bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/25 transition text-xs font-medium"
          >
            <LogIn className="w-4 h-4" />
            <span>Unirse por Código / Enlace</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 space-y-6">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 block">
              Creados por mí ({myBoards.length})
            </span>
            <div className="space-y-1">
              {myBoards.map(board => {
                const isEditing = editingBoardId === board.id;
                const hasUpdates = Boolean(board.previousTitle || board.previousOwnerName);

                return (
                  <div
                    key={board.id}
                    onClick={() => {
                      if (isEditing) return;
                      onSelectBoard(board.id, board.inviteToken);
                      onClose();
                    }}
                    className={`group flex items-center justify-between p-2.5 rounded-lg cursor-pointer text-xs transition ${
                      board.id === currentBoardId
                        ? 'bg-primary/20 text-white border border-primary/40 font-medium'
                        : 'text-slate-300 hover:bg-slate-900 border border-transparent'
                    }`}
                  >
                    {isEditing ? (
                      <form
                        onSubmit={e => handleRenameSubmit(e, board)}
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1 w-full"
                      >
                        <input
                          type="text"
                          autoFocus
                          maxLength={LIMITS.BOARD_TITLE_MAX}
                          value={draftTitle}
                          onChange={e => setDraftTitle(e.target.value)}
                          aria-label={`Renombrar tablero ${board.title}`}
                          className="flex-1 min-w-0 bg-slate-900 border border-primary text-white text-xs px-2 py-1 rounded focus:outline-none"
                        />
                        <button
                          type="submit"
                          aria-label="Confirmar nuevo nombre"
                          className="p-1 text-emerald-400 hover:bg-emerald-500/20 rounded"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setEditingBoardId(null);
                          }}
                          aria-label="Cancelar renombrado"
                          className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    ) : (
                      <>
                        <div className="flex flex-col min-w-0 pr-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate">{board.title}</span>
                            {hasUpdates && (
                              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                Actualizado
                              </span>
                            )}
                          </div>
                          {board.previousTitle && (
                            <span className="text-[10px] text-amber-300/90 font-normal truncate">
                              Antes: <span className="line-through opacity-80">{board.previousTitle}</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setDraftTitle(board.title);
                              setEditingBoardId(board.id);
                            }}
                            className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 text-slate-500 hover:text-blue-400 p-1.5 transition"
                            title="Cambiar nombre del tablero"
                            aria-label={`Renombrar tablero ${board.title}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {boards.length > 1 && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                if (window.confirm(`¿Estás seguro de que deseas eliminar permanentemente el tablero "${board.title}"? Todos los colaboradores perderán el acceso.`)) {
                                  onDeleteBoard(board.id);
                                }
                              }}
                              className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 text-slate-500 hover:text-red-400 p-1.5 transition"
                              title="Eliminar tablero definitivamente"
                              aria-label={`Eliminar tablero ${board.title}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {joinedBoards.length > 0 && (
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                Unidos por invitación ({joinedBoards.length})
              </span>
              <div className="space-y-1">
                {joinedBoards.map(board => {
                  const hasUpdates = Boolean(board.previousTitle || board.previousOwnerName);

                  return (
                    <div
                      key={board.id}
                      onClick={() => {
                        onSelectBoard(board.id, board.inviteToken);
                        onClose();
                      }}
                      className={`group flex items-center justify-between p-2.5 rounded-lg cursor-pointer text-xs transition ${
                        board.id === currentBoardId
                          ? 'bg-primary/20 text-white border border-primary/40 font-medium'
                          : hasUpdates
                          ? 'text-slate-200 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/30'
                          : 'text-slate-300 hover:bg-slate-900 border border-transparent'
                      }`}
                    >
                      <div className="flex flex-col min-w-0 pr-2 gap-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{board.title}</span>
                          {hasUpdates && (
                            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              Actualizado
                            </span>
                          )}
                        </div>
                        {board.previousTitle && (
                          <span className="text-[10px] text-amber-300/90 font-normal truncate">
                            Antes: <span className="line-through opacity-80">{board.previousTitle}</span>
                          </span>
                        )}
                        <span className="text-[10px] text-slate-500 font-normal truncate">
                          Propietario: {board.ownerName || 'Desconocido'}
                        </span>
                        {board.previousOwnerName && (
                          <span className="text-[10px] text-amber-300/90 font-normal truncate">
                            Dueño anterior: <span className="line-through opacity-80">{board.previousOwnerName}</span>
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          if (window.confirm(`¿Deseas abandonar el tablero compartido "${board.title}"?`)) {
                            onLeaveBoard(board.id);
                          }
                        }}
                        className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 text-slate-500 hover:text-amber-400 p-1 transition shrink-0"
                        title="Abandonar tablero"
                        aria-label={`Abandonar tablero ${board.title}`}
                      >
                        <LogOut className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenProfileModal();
          }}
          className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-2.5 w-full text-left hover:bg-slate-900 p-2 rounded-lg transition"
        >
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
            style={{ backgroundColor: currentUser.color }}
          >
            {(currentUser.name || '?').charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-200 truncate">{currentUser.name}</p>
            <p className="text-[10px] text-slate-500">Editar perfil local</p>
          </div>
        </button>
      </div>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { Sparkles, Menu, Share2, Pencil, Check, X } from 'lucide-react';
import { LIMITS, sanitizeSingleLineText, type UserPresence, type UserProfile } from '@kanban/shared-types';
import type { SyncStatus } from '../../core/yjs/YjsRoomClient.js';
import { SyncBadge } from './SyncBadge';
import { CollaboratorsList } from './CollaboratorsList';
import { InstallButton } from './InstallButton';

interface Props {
  boardId: string;
  boardTitle: string;
  role?: 'owner' | 'member';
  ownerName?: string;
  collaborators: UserPresence[];
  currentUser: UserProfile;
  syncStatus: SyncStatus;
  onOpenSidebar: () => void;
  onOpenShareModal: () => void;
  onOpenProfileModal: () => void;
  onRenameBoard?: (newTitle: string) => void;
}

function BoardTitleDisplay({
  boardTitle,
  canRename,
  onRenameBoard,
}: {
  boardTitle: string;
  canRename: boolean;
  onRenameBoard?: (newTitle: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(boardTitle);

  const cleanDraft = sanitizeSingleLineText(draft, LIMITS.BOARD_TITLE_MAX, '');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!cleanDraft) return;
    if (cleanDraft !== boardTitle) {
      onRenameBoard?.(cleanDraft);
    }
    setIsEditing(false);
  };

  if (isEditing && canRename) {
    return (
      <form onSubmit={handleSubmit} className="flex items-center gap-1 min-w-0">
        <input
          type="text"
          autoFocus
          maxLength={LIMITS.BOARD_TITLE_MAX}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setDraft(boardTitle);
              setIsEditing(false);
            }
          }}
          aria-label="Nuevo nombre del tablero"
          className="bg-slate-900 border border-primary text-slate-100 text-sm font-semibold px-2 py-0.5 rounded focus:outline-none w-full max-w-[160px] sm:max-w-[224px] min-w-0"
        />
        <button
          type="submit"
          disabled={!cleanDraft}
          aria-label="Guardar nombre del tablero"
          className="p-1 text-emerald-400 hover:bg-emerald-500/20 rounded disabled:opacity-40 transition shrink-0"
          title="Guardar nombre"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(boardTitle);
            setIsEditing(false);
          }}
          aria-label="Cancelar edición de nombre"
          className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition shrink-0"
          title="Cancelar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
      <h1 className="text-sm font-semibold text-slate-100 truncate min-w-0 md:max-w-md">
        {boardTitle || 'Local-First Kanban'}
      </h1>
      {canRename && onRenameBoard && (
        <button
          type="button"
          onClick={() => {
            setDraft(boardTitle);
            setIsEditing(true);
          }}
          aria-label="Cambiar nombre del tablero"
          title="Cambiar nombre del tablero"
          className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function Header({
  boardId,
  boardTitle,
  role = 'owner',
  ownerName,
  collaborators,
  currentUser,
  syncStatus,
  onOpenSidebar,
  onOpenShareModal,
  onOpenProfileModal,
  onRenameBoard,
}: Props) {
  const initialLetter = (currentUser.name || '?').charAt(0).toUpperCase();

  return (
    <header className="min-h-14 py-2 sm:py-0 sm:h-14 border-b border-border px-3 sm:px-6 flex items-center justify-between gap-2 bg-surface/50 backdrop-blur-sm sticky top-0 z-20">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Ver tableros"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 border border-transparent hover:border-slate-700 transition-colors shrink-0"
          title="Ver tableros"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="hidden sm:flex w-8 h-8 rounded-lg bg-primary/20 text-primary items-center justify-center font-bold shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <BoardTitleDisplay
              key={`${boardId}:${boardTitle}`}
              boardTitle={boardTitle}
              canRename={role === 'owner'}
              onRenameBoard={onRenameBoard}
            />
            {role === 'owner' ? (
              <span className="hidden md:inline-block text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">
                (Tú eres el propietario)
              </span>
            ) : (
              <span
                className="hidden md:inline-block text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0"
                title={`Creado por ${ownerName || 'un colaborador'}`}
              >
                Propietario: {ownerName || 'Colaborador'}
              </span>
            )}
          </div>
          <p className="hidden sm:block text-[10px] text-slate-400 font-mono truncate">Sala: {boardId}</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onOpenShareModal}
          aria-label="Compartir tablero"
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium border border-primary/20 transition-colors"
          title="Compartir tablero"
        >
          <Share2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Compartir</span>
        </button>

        <InstallButton />
        <CollaboratorsList collaborators={collaborators} currentUserId={currentUser.id} />

        <button
          type="button"
          onClick={onOpenProfileModal}
          aria-label="Editar perfil local"
          className="flex items-center gap-2 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 px-1.5 sm:px-2.5 py-1 rounded-full transition-all text-xs text-slate-200"
          title={`Editar tu perfil (${currentUser.name})`}
        >
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-xs shrink-0"
            style={{ backgroundColor: currentUser.color }}
          >
            {initialLetter}
          </div>
          <span className="hidden md:inline max-w-[120px] truncate font-medium">
            {currentUser.name}
          </span>
        </button>

        <SyncBadge status={syncStatus} />
      </div>
    </header>
  );
}

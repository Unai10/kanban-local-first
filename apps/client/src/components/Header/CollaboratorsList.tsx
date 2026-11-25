import { useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import type { UserActivity, UserPresence } from '@kanban/shared-types';

interface Props {
  collaborators: UserPresence[];
  currentUserId: string;
}

function getActivityDescription(activity?: UserActivity | null): string {
  if (!activity) return 'En línea';
  if (activity.action === 'editing-card') return 'Editando una tarjeta';
  if (activity.action === 'creating-card') return 'Creando una tarjeta';
  if (activity.action === 'dragging-card') return 'Arrastrando una tarjeta';
  return 'En línea';
}

export function CollaboratorsList({ collaborators, currentUserId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: Event) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', handleOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const hasRemoteActivity = collaborators.some(
    c => c.userId !== currentUserId && Boolean(c.activity)
  );
  const maxVisibleMobile = 2;
  const visibleMobileOverflow = Math.max(0, collaborators.length - maxVisibleMobile);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={`Colaboradores conectados (${collaborators.length})`}
        className="flex items-center gap-1.5 bg-slate-900/80 hover:bg-slate-800 px-2 sm:px-3 py-1 rounded-full border border-slate-800 hover:border-slate-700 transition-colors"
      >
        <span className="relative flex items-center">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          {hasRemoteActivity && (
            <span
              className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-pulse ring-2 ring-slate-900"
              aria-hidden="true"
            />
          )}
        </span>
        <div className="flex -space-x-1.5 overflow-hidden">
          {collaborators.map((collab, idx) => (
            <div
              key={collab.userId}
              title={`${collab.userName} ${collab.userId === currentUserId ? '(Tú)' : ''}`}
              style={{ backgroundColor: collab.avatarColor }}
              className={`w-5 h-5 rounded-full ring-2 ring-slate-900 flex items-center justify-center text-[9px] font-bold text-white uppercase ${
                idx >= maxVisibleMobile ? 'hidden sm:flex' : 'flex'
              }`}
            >
              {(collab.userName || '?').charAt(0)}
            </div>
          ))}
          {visibleMobileOverflow > 0 && (
            <div className="sm:hidden w-5 h-5 rounded-full ring-2 ring-slate-900 bg-slate-800 text-slate-300 flex items-center justify-center text-[9px] font-semibold">
              +{visibleMobileOverflow}
            </div>
          )}
        </div>
      </button>

      {isOpen && (
        <div
          role="region"
          aria-label="Actividad de colaboradores"
          className="absolute right-0 mt-2 w-64 max-w-[85vw] bg-slate-950 border border-slate-800 rounded-xl shadow-2xl p-2.5 z-50"
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1.5 pb-1.5 mb-1 border-b border-slate-800">
            Conectados ({collaborators.length})
          </div>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {collaborators.map(collab => {
              const isSelf = collab.userId === currentUserId;
              const isActing = Boolean(collab.activity);
              return (
                <div
                  key={collab.userId}
                  className="flex items-center gap-2 px-1.5 py-1.5 rounded-lg bg-slate-900/50"
                >
                  <span
                    style={{ backgroundColor: collab.avatarColor }}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 uppercase"
                  >
                    {(collab.userName || '?').charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-200 truncate">
                      {collab.userName} {isSelf ? '(Tú)' : ''}
                    </p>
                    <p
                      className={`text-[10px] truncate ${
                        isActing ? 'text-emerald-400 font-medium' : 'text-slate-400'
                      }`}
                    >
                      {getActivityDescription(collab.activity)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

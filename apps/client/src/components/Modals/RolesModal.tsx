import { useEffect, useMemo, useState } from 'react';
import { X, Shield, Crown, User, WifiOff } from 'lucide-react';
import type {
  AssignableBoardRole,
  BoardMember,
  BoardRole,
  UserPresence,
  UserProfile,
} from '@kanban/shared-types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  boardTitle: string;
  currentRole: BoardRole;
  ownerId?: string;
  ownerName?: string;
  currentUser: UserProfile;
  boardMembers: BoardMember[];
  collaborators: UserPresence[];
  isOffline: boolean;
  onUpdateMemberRole: (boardId: string, targetUserId: string, role: AssignableBoardRole) => Promise<boolean>;
}

interface MemberRow {
  userId: string;
  name: string;
  color: string;
  role: BoardRole;
  isOnline: boolean;
}

const ROLE_BADGES: Record<BoardRole, { label: string; className: string }> = {
  owner: {
    label: 'Propietario',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  admin: {
    label: 'Admin',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  member: {
    label: 'Miembro',
    className: 'bg-slate-800 text-slate-300 border-slate-700',
  },
};

export function RolesModal({
  isOpen,
  onClose,
  boardId,
  boardTitle,
  currentRole,
  ownerId,
  ownerName,
  currentUser,
  boardMembers,
  collaborators,
  isOffline,
  onUpdateMemberRole,
}: Props) {
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const rows = useMemo<MemberRow[]>(() => {
    const onlineIds = new Set(collaborators.map(c => c.userId));
    const map = new Map<string, MemberRow>();

    if (ownerId) {
      map.set(ownerId, {
        userId: ownerId,
        name: ownerId === currentUser.id ? currentUser.name : (ownerName || 'Propietario'),
        color: ownerId === currentUser.id ? currentUser.color : '#10b981',
        role: 'owner',
        isOnline: onlineIds.has(ownerId) || ownerId === currentUser.id,
      });
    }

    for (const member of boardMembers) {
      if (member.left) continue;
      const isOwnerRow = Boolean(ownerId && member.userId === ownerId);
      const role: BoardRole = isOwnerRow
        ? 'owner'
        : (member.role === 'admin' ? 'admin' : 'member');
      map.set(member.userId, {
        userId: member.userId,
        name: member.name,
        color: member.color,
        role,
        isOnline: onlineIds.has(member.userId) || member.userId === currentUser.id,
      });
    }

    for (const collab of collaborators) {
      const existing = map.get(collab.userId);
      if (existing) {
        existing.isOnline = true;
        existing.name = collab.userName;
        existing.color = collab.avatarColor;
      } else {
        const isOwnerRow = Boolean(ownerId && collab.userId === ownerId);
        map.set(collab.userId, {
          userId: collab.userId,
          name: collab.userName,
          color: collab.avatarColor,
          role: isOwnerRow ? 'owner' : 'member',
          isOnline: true,
        });
      }
    }

    const rank: Record<BoardRole, number> = { owner: 0, admin: 1, member: 2 };
    return Array.from(map.values()).sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name));
  }, [boardMembers, collaborators, currentUser.color, currentUser.id, currentUser.name, ownerId, ownerName]);

  if (!isOpen) return null;

  const isOwner = currentRole === 'owner';

  const handleToggleAdmin = async (row: MemberRow) => {
    if (!isOwner || row.role === 'owner' || isOffline) return;
    const nextRole: AssignableBoardRole = row.role === 'admin' ? 'member' : 'admin';
    setPendingUserId(row.userId);
    try {
      await onUpdateMemberRole(boardId, row.userId, nextRole);
    } finally {
      setPendingUserId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="roles-modal-title"
    >
      <div
        className="bg-surface border border-border w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden rounded-xl shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4 border-b border-border/80">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 id="roles-modal-title" className="text-sm font-semibold text-ink truncate">
                Miembros y Roles
              </h3>
              <p className="text-xs text-slate-400 truncate">{boardTitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar gestión de roles"
            className="text-slate-400 hover:text-ink p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-3">
          <div className="text-xs text-slate-300 bg-slate-900/60 border border-slate-800 rounded-lg p-3 space-y-1">
            <p><strong className="text-emerald-400">Propietario:</strong> administra el tablero, roles y columnas.</p>
            <p><strong className="text-amber-400">Admin:</strong> puede crear, editar, reordenar y eliminar columnas.</p>
            <p><strong className="text-slate-200">Miembro:</strong> colabora en tarjetas, checklists y comentarios.</p>
          </div>

          {isOwner && isOffline && (
            <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded-lg px-3 py-2">
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>Sin conexión: necesitas estar online para asignar o revocar el rol Admin.</span>
            </div>
          )}

          <div className="space-y-2">
            {rows.map(row => {
              const badge = ROLE_BADGES[row.role];
              const isSelf = row.userId === currentUser.id;
              const isBusy = pendingUserId === row.userId;

              return (
                <div
                  key={row.userId}
                  className="flex items-center justify-between gap-2 bg-slate-900/70 border border-slate-800 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <span
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ backgroundColor: row.color }}
                      >
                        {row.name.charAt(0).toUpperCase()}
                      </span>
                      {row.isOnline && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-surface"
                          title="Conectado"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-100 truncate">
                        {row.name}{isSelf ? ' (Tú)' : ''}
                      </p>
                      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${badge.className}`}>
                        {row.role === 'owner' ? <Crown className="w-2.5 h-2.5" /> : row.role === 'admin' ? <Shield className="w-2.5 h-2.5" /> : <User className="w-2.5 h-2.5" />}
                        {badge.label}
                      </span>
                    </div>
                  </div>

                  {isOwner && row.role !== 'owner' && (
                    <button
                      type="button"
                      disabled={isOffline || isBusy}
                      onClick={() => void handleToggleAdmin(row)}
                      className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition shrink-0 disabled:opacity-40 ${
                        row.role === 'admin'
                          ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border-red-500/30'
                          : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30'
                      }`}
                    >
                      {isBusy ? 'Guardando...' : row.role === 'admin' ? 'Quitar Admin' : 'Hacer Admin'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

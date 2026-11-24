import { Users } from 'lucide-react';
import type { UserPresence } from '@kanban/shared-types';

interface Props {
  collaborators: UserPresence[];
  currentUserId: string;
}

export function CollaboratorsList({ collaborators, currentUserId }: Props) {
  return (
    <div className="flex items-center gap-1.5 bg-slate-900/80 px-3 py-1 rounded-full border border-slate-800">
      <Users className="w-3.5 h-3.5 text-slate-400 mr-1" />
      <div className="flex -space-x-1.5 overflow-hidden">
        {collaborators.map(collab => (
          <div
            key={collab.userId}
            title={`${collab.userName} ${collab.userId === currentUserId ? '(Tú)' : ''}`}
            style={{ backgroundColor: collab.avatarColor }}
            className="w-5 h-5 rounded-full ring-2 ring-slate-900 flex items-center justify-center text-[9px] font-bold text-white uppercase"
          >
            {(collab.userName || '?').charAt(0)}
          </div>
        ))}
      </div>
    </div>
  );
}

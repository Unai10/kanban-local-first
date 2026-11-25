import type { UserPresence } from '@kanban/shared-types';
import { CollaboratorCursor } from './CollaboratorCursor.js';
import { useDesktopFinePointer } from '../hooks/useDesktopFinePointer.js';

interface Props {
  collaborators: UserPresence[];
  currentUserId: string;
}

export function CollaboratorCursors({ collaborators, currentUserId }: Props) {
  const showCursors = useDesktopFinePointer();
  if (!showCursors) return null;

  const remoteCollaborators = collaborators.filter(
    c => c.userId !== currentUserId && c.cursor != null
  );

  return (
    <div className="hidden md:block absolute inset-0 pointer-events-none overflow-visible z-30">
      {remoteCollaborators.map(collab => (
        <CollaboratorCursor key={collab.userId} collaborator={collab} />
      ))}
    </div>
  );
}

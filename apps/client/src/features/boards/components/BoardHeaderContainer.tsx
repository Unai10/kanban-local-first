import { Header } from '../../../components/Header/Header.js';
import { useBoardContext } from '../context/useBoardContext.js';
import type { UserPresence } from '@kanban/shared-types';
import type { SyncStatus } from '../../kanban/hooks/useKanbanRoom.js';

interface Props {
  collaborators: UserPresence[];
  syncStatus: SyncStatus;
}

export function BoardHeaderContainer({ collaborators, syncStatus }: Props) {
  const { boardInfo, currentUser, openSidebar, openShareModal, openProfileModal, renameBoard } = useBoardContext();

  return (
    <Header
      boardId={boardInfo.boardId}
      boardTitle={boardInfo.title}
      role={boardInfo.role}
      ownerName={boardInfo.ownerName}
      collaborators={collaborators}
      currentUser={currentUser}
      syncStatus={syncStatus}
      onOpenSidebar={openSidebar}
      onOpenShareModal={openShareModal}
      onOpenProfileModal={openProfileModal}
      onRenameBoard={newTitle => void renameBoard(boardInfo.boardId, newTitle)}
    />
  );
}

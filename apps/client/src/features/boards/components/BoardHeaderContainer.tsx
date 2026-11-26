import { Header } from '../../../components/Header/Header.js';
import { useBoardContext } from '../context/useBoardContext.js';
import type { UserPresence } from '@kanban/shared-types';
import type { SyncStatus } from '../../kanban/hooks/useKanbanRoom.js';

interface Props {
  collaborators: UserPresence[];
  syncStatus: SyncStatus;
}

export function BoardHeaderContainer({ collaborators, syncStatus }: Props) {
  const {
    boardInfo,
    currentUser,
    theme,
    toggleTheme,
    openSidebar,
    openShareModal,
    openProfileModal,
    openRolesModal,
    openMetricsModal,
    openShortcutsModal,
    renameBoard,
  } = useBoardContext();

  return (
    <Header
      boardId={boardInfo.boardId}
      boardTitle={boardInfo.title}
      role={boardInfo.role}
      ownerName={boardInfo.ownerName}
      collaborators={collaborators}
      currentUser={currentUser}
      syncStatus={syncStatus}
      theme={theme}
      onToggleTheme={toggleTheme}
      onOpenSidebar={openSidebar}
      onOpenShareModal={openShareModal}
      onOpenProfileModal={openProfileModal}
      onOpenRolesModal={openRolesModal}
      onOpenMetricsModal={openMetricsModal}
      onOpenShortcutsModal={openShortcutsModal}
      onRenameBoard={newTitle => void renameBoard(boardInfo.boardId, newTitle)}
    />
  );
}

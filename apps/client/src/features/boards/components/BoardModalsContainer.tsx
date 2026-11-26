import { useBoardContext } from '../context/useBoardContext.js';
import { BoardSidebar } from '../../../components/Sidebar/BoardSidebar.js';
import { ShareModal } from '../../../components/Modals/ShareModal.js';
import { CreateBoardModal } from '../../../components/Modals/CreateBoardModal.js';
import { JoinBoardModal } from '../../../components/Modals/JoinBoardModal.js';
import { ProfileModal } from '../../../components/Modals/ProfileModal.js';

interface Props {
  onExportJson?: () => void;
  onExportMarkdown?: () => void;
}

export function BoardModalsContainer({ onExportJson, onExportMarkdown }: Props) {
  const {
    boardInfo,
    boards,
    currentUser,
    isSidebarOpen,
    isShareModalOpen,
    isCreateBoardModalOpen,
    isJoinModalOpen,
    isProfileModalOpen,
    isOnboardingOpen,
    closeSidebar,
    closeShareModal,
    closeCreateBoardModal,
    closeJoinModal,
    closeProfileModal,
    openCreateBoardModal,
    openJoinModal,
    openProfileModal,
    openOnboarding,
    updateUserProfile,
    selectBoard,
    createBoard,
    importBoardFromSnapshot,
    renameBoard,
    joinBoard,
    deleteBoard,
    leaveBoard,
  } = useBoardContext();

  return (
    <>
      <BoardSidebar
        isOpen={isSidebarOpen}
        isTutorialHighlight={isOnboardingOpen && isSidebarOpen}
        onClose={closeSidebar}
        boards={boards}
        currentBoardId={boardInfo.boardId}
        currentUser={currentUser}
        onSelectBoard={selectBoard}
        onOpenCreateModal={openCreateBoardModal}
        onOpenJoinModal={openJoinModal}
        onOpenProfileModal={openProfileModal}
        onOpenOnboarding={openOnboarding}
        onRenameBoard={(id, newTitle) => void renameBoard(id, newTitle)}
        onDeleteBoard={deleteBoard}
        onLeaveBoard={leaveBoard}
        onImportSnapshot={importBoardFromSnapshot}
        onExportJson={onExportJson}
        onExportMarkdown={onExportMarkdown}
      />

      <ShareModal
        isOpen={isShareModalOpen}
        onClose={closeShareModal}
        boardId={boardInfo.boardId}
        boardTitle={boardInfo.title}
        inviteToken={boardInfo.inviteToken}
        joinCode={boardInfo.joinCode}
        ownerId={boardInfo.ownerId || currentUser.id}
        ownerName={boardInfo.ownerName || currentUser.name}
      />

      <CreateBoardModal
        isOpen={isCreateBoardModalOpen}
        onClose={closeCreateBoardModal}
        onCreate={createBoard}
      />

      <JoinBoardModal
        isOpen={isJoinModalOpen}
        onClose={closeJoinModal}
        onJoin={joinBoard}
      />

      <ProfileModal
        isOpen={isProfileModalOpen}
        user={currentUser}
        onClose={closeProfileModal}
        onSave={updateUserProfile}
      />
    </>
  );
}

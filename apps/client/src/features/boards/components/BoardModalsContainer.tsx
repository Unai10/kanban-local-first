import { useBoardContext } from '../context/useBoardContext.js';
import { BoardSidebar } from '../../../components/Sidebar/BoardSidebar.js';
import { ShareModal } from '../../../components/Modals/ShareModal.js';
import { CreateBoardModal } from '../../../components/Modals/CreateBoardModal.js';
import { JoinBoardModal } from '../../../components/Modals/JoinBoardModal.js';
import { ProfileModal } from '../../../components/Modals/ProfileModal.js';

export function BoardModalsContainer() {
  const {
    boardInfo,
    boards,
    currentUser,
    isSidebarOpen,
    isShareModalOpen,
    isCreateBoardModalOpen,
    isJoinModalOpen,
    isProfileModalOpen,
    closeSidebar,
    closeShareModal,
    closeCreateBoardModal,
    closeJoinModal,
    closeProfileModal,
    openCreateBoardModal,
    openJoinModal,
    openProfileModal,
    updateUserProfile,
    selectBoard,
    createBoard,
    renameBoard,
    joinBoard,
    deleteBoard,
    leaveBoard,
  } = useBoardContext();

  return (
    <>
      <BoardSidebar
        isOpen={isSidebarOpen}
        onClose={closeSidebar}
        boards={boards}
        currentBoardId={boardInfo.boardId}
        currentUser={currentUser}
        onSelectBoard={selectBoard}
        onOpenCreateModal={openCreateBoardModal}
        onOpenJoinModal={openJoinModal}
        onOpenProfileModal={openProfileModal}
        onRenameBoard={(id, newTitle) => void renameBoard(id, newTitle)}
        onDeleteBoard={deleteBoard}
        onLeaveBoard={leaveBoard}
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

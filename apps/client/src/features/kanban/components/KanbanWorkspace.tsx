import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useBoardContext } from '../../boards/context/useBoardContext.js';
import { useKanbanRoom } from '../hooks/useKanbanRoom.js';
import { INITIAL_BOARD_FILTERS, useBoardFilters } from '../hooks/useBoardFilters.js';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts.js';
import { useKanbanDnd } from '../../dnd/hooks/useKanbanDnd.js';
import { BoardHeaderContainer } from '../../boards/components/BoardHeaderContainer.js';
import { BoardModalsContainer } from '../../boards/components/BoardModalsContainer.js';
import { BoardFilterBar } from './BoardFilterBar.js';
import { KanbanCanvas } from './KanbanCanvas.js';
import { UndoToast } from '../../../components/UndoToast.js';
import { RolesModal } from '../../../components/Modals/RolesModal.js';
import { BoardMetricsModal } from '../../../components/Modals/BoardMetricsModal.js';
import { ShortcutsHelpModal } from '../../../components/Modals/ShortcutsHelpModal.js';
import { OnboardingTour } from '../../../components/OnboardingTour.js';
import { downloadBoardAsJson, downloadBoardAsMarkdown } from '../../../core/utils/boardExport.js';

export function KanbanWorkspace() {
  const {
    boardInfo,
    currentUser,
    notification,
    dismissNotification,
    isSidebarOpen,
    isShareModalOpen,
    isCreateBoardModalOpen,
    isJoinModalOpen,
    isProfileModalOpen,
    isRolesModalOpen,
    isMetricsModalOpen,
    isShortcutsModalOpen,
    isOnboardingOpen,
    openSidebar,
    closeSidebar,
    closeRolesModal,
    closeMetricsModal,
    openShortcutsModal,
    closeShortcutsModal,
    completeOnboarding,
    updateMemberRole,
    handleRemoteBoardDeleted,
    handleAuthError,
    handleOwnerResolved,
  } = useBoardContext();

  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [createCardColumnId, setCreateCardColumnId] = useState<string | null>(null);
  const [undoDeleteCard, setUndoDeleteCard] = useState<{ id: string; title: string } | null>(null);
  const [dragNotice, setDragNotice] = useState<string | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const dragNoticeTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const canManageColumns = boardInfo.role === 'owner' || boardInfo.role === 'admin';

  const {
    columns,
    cards,
    boardMembers,
    commentsByCardId,
    syncStatus,
    collaborators,
    addCard,
    updateCard,
    moveCard,
    deleteCard,
    restoreCard,
    addColumn,
    updateColumn,
    moveColumn,
    deleteColumn,
    addComment,
    deleteComment,
    buildExportSnapshot,
    updateCursor,
    updateActivity,
  } = useKanbanRoom({
    boardId: boardInfo.boardId,
    boardTitle: boardInfo.title,
    currentUser,
    inviteToken: boardInfo.inviteToken,
    ownerToken: boardInfo.ownerToken,
    joinCode: boardInfo.joinCode,
    userRole: boardInfo.role,
    initialOwnerId: boardInfo.ownerId,
    initialOwnerName: boardInfo.ownerName,
    seedDemoCards: boardInfo.seedDemoCards,
    initialTemplateId: boardInfo.initialTemplateId,
    initialImportSnapshot: boardInfo.initialImportSnapshot,
    onBoardDeleted: handleRemoteBoardDeleted,
    onAuthError: handleAuthError,
    onOwnerResolved: handleOwnerResolved,
  });

  const {
    filters,
    setFilters,
    filteredCards,
    activeFilterCount,
    hasActiveFilters,
    clearFilters,
  } = useBoardFilters(cards, currentUser.id);

  const editingCard = editingCardId ? (cards.find(c => c.id === editingCardId) ?? null) : null;

  useEffect(() => {
    if (editingCardId && !editingCard) {
      updateActivity(null);
    }
  }, [editingCardId, editingCard, updateActivity]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
      if (dragNoticeTimerRef.current !== null) {
        window.clearTimeout(dragNoticeTimerRef.current);
      }
    };
  }, []);

  const handleDragAborted = useCallback((reason: string) => {
    setDragNotice(reason);
    if (dragNoticeTimerRef.current !== null) {
      window.clearTimeout(dragNoticeTimerRef.current);
    }
    dragNoticeTimerRef.current = window.setTimeout(() => {
      setDragNotice(null);
      dragNoticeTimerRef.current = null;
    }, 5000);
  }, []);

  const handleDeleteCardWithUndo = useCallback((cardId: string) => {
    const target = cards.find(c => c.id === cardId);
    deleteCard(cardId);
    if (!target) return;

    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    setUndoDeleteCard({ id: target.id, title: target.title });
    undoTimerRef.current = window.setTimeout(() => {
      setUndoDeleteCard(null);
      undoTimerRef.current = null;
    }, 6000);
  }, [cards, deleteCard]);

  const handleUndoDelete = useCallback(() => {
    if (!undoDeleteCard) return;
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    restoreCard(undoDeleteCard.id);
    setUndoDeleteCard(null);
  }, [undoDeleteCard, restoreCard]);

  const handleOpenCreateCard = useCallback((colId: string) => {
    setCreateCardColumnId(colId);
    updateActivity({ action: 'creating-card', columnId: colId });
  }, [updateActivity]);

  const handleCloseCreateCard = useCallback(() => {
    setCreateCardColumnId(null);
    updateActivity(null);
  }, [updateActivity]);

  const handleCreateCard = useCallback((
    columnId: string,
    title: string,
    description: string,
    labels?: Parameters<typeof addCard>[3],
    extras?: Parameters<typeof addCard>[4]
  ) => {
    addCard(columnId, title, description, labels, extras);
    if (isOnboardingOpen) {
      completeOnboarding();
    }
  }, [addCard, isOnboardingOpen, completeOnboarding]);

  const isAnyModalOpen = Boolean(
    editingCard ||
    createCardColumnId !== null ||
    isSidebarOpen ||
    isShareModalOpen ||
    isCreateBoardModalOpen ||
    isJoinModalOpen ||
    isProfileModalOpen ||
    isRolesModalOpen ||
    isMetricsModalOpen ||
    isShortcutsModalOpen ||
    isOnboardingOpen
  );

  useGlobalShortcuts({
    isModalOpen: isAnyModalOpen,
    onFocusSearch: () => searchInputRef.current?.focus(),
    onOpenNewCard: () => {
      if (columns[0]) handleOpenCreateCard(columns[0].id);
    },
    onToggleHelp: () => {
      if (isShortcutsModalOpen) closeShortcutsModal();
      else openShortcutsModal();
    },
  });

  const {
    sensors,
    activeCard,
    activeColumn,
    displayCards,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useKanbanDnd({
    cards,
    visibleCards: filteredCards,
    columns,
    canManageColumns,
    moveCard,
    moveColumn,
    onUpdateActivity: updateActivity,
    onDragAborted: handleDragAborted,
  });

  const activeAlertMessage = notification ?? dragNotice;

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <BoardHeaderContainer
        collaborators={collaborators}
        syncStatus={syncStatus}
      />

      <BoardFilterBar
        filters={filters}
        onChange={setFilters}
        onClear={clearFilters}
        activeFilterCount={activeFilterCount}
        totalCards={cards.length}
        visibleCards={filteredCards.length}
        cards={cards}
        searchInputRef={searchInputRef}
      />

      {activeAlertMessage && (
        <div
          role="alert"
          className="bg-amber-500/20 border-b border-amber-500/40 text-amber-200 px-3 sm:px-6 py-2 sm:py-2.5 text-xs flex items-center justify-between gap-2 animate-in fade-in"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{activeAlertMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (notification) dismissNotification();
              else setDragNotice(null);
            }}
            aria-label="Cerrar aviso"
            className="p-1 text-amber-400 hover:text-ink rounded hover:bg-amber-500/30 transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <KanbanCanvas
        columns={columns}
        allCards={cards}
        displayCards={displayCards}
        hasActiveFilters={hasActiveFilters}
        canManageColumns={canManageColumns}
        commentsByCardId={commentsByCardId}
        collaborators={collaborators}
        boardMembers={boardMembers}
        currentUser={currentUser}
        onUpdateCursor={updateCursor}
        onUpdateActivity={updateActivity}
        sensors={sensors}
        collisionDetection={collisionDetection}
        activeCard={activeCard}
        activeColumn={activeColumn}
        handleDragStart={handleDragStart}
        handleDragOver={handleDragOver}
        handleDragEnd={handleDragEnd}
        handleDragCancel={handleDragCancel}
        addCard={handleCreateCard}
        deleteCard={handleDeleteCardWithUndo}
        updateCard={updateCard}
        addColumn={addColumn}
        updateColumn={updateColumn}
        moveColumn={moveColumn}
        deleteColumn={deleteColumn}
        addComment={addComment}
        deleteComment={deleteComment}
        createCardColumnId={createCardColumnId}
        isCreateCardTutorialHighlight={isOnboardingOpen && createCardColumnId !== null}
        onOpenCreateCard={handleOpenCreateCard}
        onCloseCreateCard={handleCloseCreateCard}
        editingCard={editingCard}
        onSelectCard={card => {
          setEditingCardId(card.id);
          updateActivity({ action: 'editing-card', cardId: card.id });
        }}
        onCloseCardModal={() => {
          setEditingCardId(null);
          updateActivity(null);
        }}
      />

      <BoardModalsContainer
        onExportJson={() => downloadBoardAsJson(buildExportSnapshot(boardInfo.title))}
        onExportMarkdown={() => downloadBoardAsMarkdown(buildExportSnapshot(boardInfo.title))}
      />

      <RolesModal
        isOpen={isRolesModalOpen}
        onClose={closeRolesModal}
        boardId={boardInfo.boardId}
        boardTitle={boardInfo.title}
        currentRole={boardInfo.role}
        ownerId={boardInfo.ownerId}
        ownerName={boardInfo.ownerName}
        currentUser={currentUser}
        boardMembers={boardMembers}
        collaborators={collaborators}
        isOffline={syncStatus === 'offline'}
        onUpdateMemberRole={updateMemberRole}
      />

      <BoardMetricsModal
        isOpen={isMetricsModalOpen}
        onClose={closeMetricsModal}
        boardTitle={boardInfo.title}
        columns={columns}
        cards={cards}
        onApplyQuickFilter={partial => setFilters({ ...INITIAL_BOARD_FILTERS, ...partial })}
      />

      <ShortcutsHelpModal
        isOpen={isShortcutsModalOpen}
        onClose={closeShortcutsModal}
      />

      <OnboardingTour
        isOpen={isOnboardingOpen}
        isSidebarOpen={isSidebarOpen}
        isCreateCardModalOpen={createCardColumnId !== null}
        isPausedBySubModal={isCreateBoardModalOpen || isJoinModalOpen || isProfileModalOpen}
        onOpenSidebar={openSidebar}
        onCloseSidebar={closeSidebar}
        onOpenFirstCardModal={() => {
          if (columns[0]) handleOpenCreateCard(columns[0].id);
        }}
        onCloseCreateCardModal={handleCloseCreateCard}
        onComplete={completeOnboarding}
      />

      <UndoToast
        cardTitle={undoDeleteCard?.title ?? null}
        onUndo={handleUndoDelete}
        onDismiss={() => setUndoDeleteCard(null)}
      />
    </div>
  );
}

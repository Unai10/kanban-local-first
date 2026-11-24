import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useBoardContext } from '../../boards/context/useBoardContext.js';
import { useKanbanRoom } from '../hooks/useKanbanRoom.js';
import { useKanbanDnd } from '../../dnd/hooks/useKanbanDnd.js';
import { BoardHeaderContainer } from '../../boards/components/BoardHeaderContainer.js';
import { BoardModalsContainer } from '../../boards/components/BoardModalsContainer.js';
import { KanbanCanvas } from './KanbanCanvas.js';

export function KanbanWorkspace() {
  const {
    boardInfo,
    currentUser,
    notification,
    dismissNotification,
    handleRemoteBoardDeleted,
    handleAuthError,
    handleOwnerResolved,
  } = useBoardContext();
  const [editingCardId, setEditingCardId] = useState<string | null>(null);

  const {
    columns,
    cards,
    boardMembers,
    syncStatus,
    collaborators,
    addCard,
    updateCard,
    moveCard,
    deleteCard,
    updateCursor,
    updateActivity,
  } = useKanbanRoom({
    boardId: boardInfo.boardId,
    boardTitle: boardInfo.title,
    currentUser,
    inviteToken: boardInfo.inviteToken,
    ownerToken: boardInfo.ownerToken,
    joinCode: boardInfo.joinCode,
    initialOwnerId: boardInfo.ownerId,
    initialOwnerName: boardInfo.ownerName,
    seedDemoCards: boardInfo.seedDemoCards,
    onBoardDeleted: handleRemoteBoardDeleted,
    onAuthError: handleAuthError,
    onOwnerResolved: handleOwnerResolved,
  });

  const editingCard = editingCardId ? (cards.find(c => c.id === editingCardId) ?? null) : null;

  useEffect(() => {
    if (editingCardId && !editingCard) {
      updateActivity(null);
    }
  }, [editingCardId, editingCard, updateActivity]);

  const {
    sensors,
    activeCard,
    displayCards,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useKanbanDnd({ cards, columns, moveCard, onUpdateActivity: updateActivity });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <BoardHeaderContainer
        collaborators={collaborators}
        syncStatus={syncStatus}
      />

      {notification && (
        <div
          role="alert"
          className="bg-amber-500/20 border-b border-amber-500/40 text-amber-200 px-6 py-2.5 text-xs flex items-center justify-between animate-in fade-in"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{notification}</span>
          </div>
          <button
            type="button"
            onClick={dismissNotification}
            aria-label="Cerrar aviso"
            className="p-1 text-amber-400 hover:text-white rounded hover:bg-amber-500/30 transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <KanbanCanvas
        columns={columns}
        displayCards={displayCards}
        collaborators={collaborators}
        boardMembers={boardMembers}
        currentUser={currentUser}
        onUpdateCursor={updateCursor}
        onUpdateActivity={updateActivity}
        sensors={sensors}
        collisionDetection={collisionDetection}
        activeCard={activeCard}
        handleDragStart={handleDragStart}
        handleDragOver={handleDragOver}
        handleDragEnd={handleDragEnd}
        handleDragCancel={handleDragCancel}
        addCard={addCard}
        deleteCard={deleteCard}
        updateCard={updateCard}
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

      <BoardModalsContainer />
    </div>
  );
}

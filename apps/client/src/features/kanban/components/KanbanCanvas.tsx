import { useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core';
import type { BoardMember, Card, Column, Label, UserPresence, UserProfile, CursorPosition, UserActivity } from '@kanban/shared-types';
import { KanbanColumn } from '../../../components/KanbanColumn.js';
import { KanbanCardView } from '../../../components/KanbanCard.js';
import { CardModal } from '../../../components/Modals/CardModal.js';
import { CreateCardModal } from '../../../components/Modals/CreateCardModal.js';
import { CollaboratorCursors } from '../../presence/components/CollaboratorCursors.js';
import { useCursorBroadcast } from '../../presence/hooks/useCursorBroadcast.js';

interface Props {
  columns: Column[];
  displayCards: Card[];
  collaborators: UserPresence[];
  boardMembers: BoardMember[];
  currentUser: UserProfile;
  onUpdateCursor: (pos: CursorPosition | null) => void;
  onUpdateActivity?: (activity: UserActivity | null) => void;
  sensors: SensorDescriptor<SensorOptions>[];
  collisionDetection: CollisionDetection;
  activeCard: Card | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel: () => void;
  addCard: (
    columnId: string,
    title: string,
    desc: string,
    labels?: Label[],
    extras?: Pick<Partial<Card>, 'priority' | 'dueDate' | 'assignee' | 'checklist' | 'storyPoints'>
  ) => void;
  deleteCard: (cardId: string) => void;
  updateCard: (cardId: string, updates: Partial<Card>) => void;
  editingCard: Card | null;
  onSelectCard: (card: Card) => void;
  onCloseCardModal: () => void;
}

export function KanbanCanvas({
  columns,
  displayCards,
  collaborators,
  boardMembers,
  currentUser,
  onUpdateCursor,
  onUpdateActivity,
  sensors,
  collisionDetection,
  activeCard,
  handleDragStart,
  handleDragOver,
  handleDragEnd,
  handleDragCancel,
  addCard,
  deleteCard,
  updateCard,
  editingCard,
  onSelectCard,
  onCloseCardModal,
}: Props) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [createCardColumnId, setCreateCardColumnId] = useState<string | null>(null);

  useCursorBroadcast({
    containerRef,
    onCursorMove: onUpdateCursor,
  });

  const cardsByColumn = useMemo(() => {
    const grouped = new Map<string, Card[]>();
    for (const col of columns) {
      grouped.set(col.id, []);
    }
    for (const card of displayCards) {
      const list = grouped.get(card.columnId);
      if (list) {
        list.push(card);
      }
    }
    return grouped;
  }, [columns, displayCards]);

  const handleOpenCreateCard = (colId: string) => {
    setCreateCardColumnId(colId);
    onUpdateActivity?.({ action: 'creating-card', columnId: colId });
  };

  const handleCloseCreateCard = () => {
    setCreateCardColumnId(null);
    onUpdateActivity?.(null);
  };

  return (
    <>
      <main ref={containerRef} className="flex-1 p-6 overflow-x-auto relative min-w-full">
        <CollaboratorCursors
          collaborators={collaborators}
          currentUserId={currentUser.id}
        />

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="flex items-start gap-6">
            {columns.map(column => (
              <KanbanColumn
                key={column.id}
                column={column}
                cards={cardsByColumn.get(column.id) ?? []}
                onOpenCreateCard={handleOpenCreateCard}
                onDeleteCard={deleteCard}
                onCardClick={onSelectCard}
                collaborators={collaborators}
                currentUserId={currentUser.id}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeCard ? (
              <div className="cursor-grabbing rotate-1 scale-105 shadow-2xl">
                <KanbanCardView
                  card={activeCard}
                  isOverlay
                  onDelete={() => {}}
                  onClick={() => {}}
                  collaborators={collaborators}
                  currentUserId={currentUser.id}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>

      <CreateCardModal
        isOpen={createCardColumnId !== null}
        columns={columns}
        defaultColumnId={createCardColumnId || columns[0]?.id || ''}
        collaborators={collaborators}
        boardMembers={boardMembers}
        currentUser={currentUser}
        onClose={handleCloseCreateCard}
        onCreateCard={addCard}
      />

      <CardModal
        card={editingCard}
        columns={columns}
        collaborators={collaborators}
        boardMembers={boardMembers}
        currentUser={currentUser}
        onClose={onCloseCardModal}
        onUpdate={updateCard}
        onDelete={deleteCard}
      />
    </>
  );
}

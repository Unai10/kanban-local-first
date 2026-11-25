import { useCallback, useMemo, useRef, useState } from 'react';
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
import { useDesktopFinePointer } from '../../presence/hooks/useDesktopFinePointer.js';

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
  const [activeMobileColId, setActiveMobileColId] = useState<string | null>(null);
  const isDesktopPointer = useDesktopFinePointer();

  useCursorBroadcast({
    containerRef,
    onCursorMove: onUpdateCursor,
    enabled: isDesktopPointer,
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

  const cardColumnById = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of displayCards) {
      map.set(card.id, card.columnId);
    }
    return map;
  }, [displayCards]);

  const columnActivityColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const collab of collaborators) {
      if (collab.userId === currentUser.id || !collab.activity) continue;
      const targetColId =
        collab.activity.columnId ??
        (collab.activity.cardId ? cardColumnById.get(collab.activity.cardId) : undefined);
      if (targetColId && !map.has(targetColId)) {
        map.set(targetColId, collab.avatarColor);
      }
    }
    return map;
  }, [collaborators, currentUser.id, cardColumnById]);

  const selectedMobileColId =
    activeMobileColId && columns.some(col => col.id === activeMobileColId)
      ? activeMobileColId
      : (columns[0]?.id ?? null);

  const handleSelectMobileColumn = useCallback((colId: string) => {
    setActiveMobileColId(colId);
    const container = containerRef.current;
    if (!container) return;
    const colEl = container.querySelector<HTMLElement>(`[data-column-id="${CSS.escape(colId)}"]`);
    if (!colEl) return;
    const targetLeft = Math.max(0, colEl.offsetLeft - (container.clientWidth - colEl.clientWidth) / 2);
    container.scrollTo({ left: targetLeft, behavior: 'smooth' });
  }, []);

  const handleCanvasScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const colEls = Array.from(container.querySelectorAll<HTMLElement>('[data-column-id]'));
    if (colEls.length === 0) return;

    const viewportCenter = container.scrollLeft + container.clientWidth / 2;
    let closestId: string | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const el of colEls) {
      const elCenter = el.offsetLeft + el.clientWidth / 2;
      const distance = Math.abs(elCenter - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestId = el.dataset.columnId ?? null;
      }
    }

    if (closestId) {
      setActiveMobileColId(closestId);
    }
  }, []);

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
      <div className="flex-1 flex flex-col min-h-0">
        {columns.length > 0 && (
          <nav
            aria-label="Columnas del tablero"
            className="md:hidden flex items-center gap-1.5 px-3 py-2 border-b border-border/70 bg-slate-950/60 overflow-x-auto no-scrollbar shrink-0"
          >
            {columns.map(column => {
              const isSelected = column.id === selectedMobileColId;
              const colCardsCount = cardsByColumn.get(column.id)?.length ?? 0;
              const activityColor = columnActivityColor.get(column.id);
              return (
                <button
                  key={column.id}
                  type="button"
                  onClick={() => handleSelectMobileColumn(column.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition shrink-0 ${
                    isSelected
                      ? 'bg-primary/20 text-white border-primary/50'
                      : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {activityColor && (
                    <span
                      style={{ backgroundColor: activityColor }}
                      className="w-2 h-2 rounded-full animate-pulse shrink-0"
                      aria-label="Colaborador activo en esta columna"
                    />
                  )}
                  <span>{column.title}</span>
                  <span className="text-[10px] font-mono bg-slate-800/90 text-slate-300 px-1.5 py-0.5 rounded-full">
                    {colCardsCount}
                  </span>
                </button>
              );
            })}
          </nav>
        )}

        <main
          ref={containerRef}
          onScroll={handleCanvasScroll}
          className={`flex-1 p-3 sm:p-6 overflow-x-auto relative min-w-full ${
            activeCard ? '' : 'snap-x snap-mandatory md:snap-none'
          }`}
        >
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
            <div className="flex items-start gap-3 sm:gap-6">
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
      </div>

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

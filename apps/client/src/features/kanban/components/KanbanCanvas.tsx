import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, Check, X } from 'lucide-react';
import {
  LIMITS,
  sanitizeSingleLineText,
  type BoardMember,
  type Card,
  type CardComment,
  type Column,
  type Label,
  type UserPresence,
  type UserProfile,
  type CursorPosition,
  type UserActivity,
} from '@kanban/shared-types';
import { KanbanColumn } from '../../../components/KanbanColumn.js';
import { KanbanCardView } from '../../../components/KanbanCard.js';
import { CardModal } from '../../../components/Modals/CardModal.js';
import { CreateCardModal } from '../../../components/Modals/CreateCardModal.js';
import { CollaboratorCursors } from '../../presence/components/CollaboratorCursors.js';
import { useCursorBroadcast } from '../../presence/hooks/useCursorBroadcast.js';
import { useDesktopFinePointer } from '../../presence/hooks/useDesktopFinePointer.js';

interface Props {
  columns: Column[];
  allCards: Card[];
  displayCards: Card[];
  hasActiveFilters: boolean;
  canManageColumns: boolean;
  commentsByCardId: Map<string, CardComment[]>;
  collaborators: UserPresence[];
  boardMembers: BoardMember[];
  currentUser: UserProfile;
  onUpdateCursor: (pos: CursorPosition | null) => void;
  onUpdateActivity?: (activity: UserActivity | null) => void;
  sensors: SensorDescriptor<SensorOptions>[];
  collisionDetection: CollisionDetection;
  activeCard: Card | null;
  activeColumn: Column | null;
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
  addColumn: (title: string, color?: string) => void;
  updateColumn: (columnId: string, updates: Partial<Pick<Column, 'title' | 'color'>>) => void;
  moveColumn: (columnId: string, prevKey?: string | null, nextKey?: string | null) => void;
  deleteColumn: (columnId: string, targetColumnIdForCards?: string | null) => void;
  addComment: (cardId: string, text: string) => void;
  deleteComment: (commentId: string) => void;
  createCardColumnId: string | null;
  onOpenCreateCard: (colId: string) => void;
  onCloseCreateCard: () => void;
  editingCard: Card | null;
  onSelectCard: (card: Card) => void;
  onCloseCardModal: () => void;
}

export function KanbanCanvas({
  columns,
  allCards,
  displayCards,
  hasActiveFilters,
  canManageColumns,
  commentsByCardId,
  collaborators,
  boardMembers,
  currentUser,
  onUpdateCursor,
  sensors,
  collisionDetection,
  activeCard,
  activeColumn,
  handleDragStart,
  handleDragOver,
  handleDragEnd,
  handleDragCancel,
  addCard,
  deleteCard,
  updateCard,
  addColumn,
  updateColumn,
  moveColumn,
  deleteColumn,
  addComment,
  deleteComment,
  createCardColumnId,
  onOpenCreateCard,
  onCloseCreateCard,
  editingCard,
  onSelectCard,
  onCloseCardModal,
}: Props) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [activeMobileColId, setActiveMobileColId] = useState<string | null>(null);
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const isDesktopPointer = useDesktopFinePointer();

  useCursorBroadcast({
    containerRef,
    onCursorMove: onUpdateCursor,
    enabled: isDesktopPointer,
  });

  const { cardsByColumn, totalCardsByColumn } = useMemo(() => {
    const grouped = new Map<string, Card[]>();
    const totals = new Map<string, number>();
    for (const col of columns) {
      grouped.set(col.id, []);
      totals.set(col.id, 0);
    }
    const fallbackColId = columns[0]?.id;
    for (const card of allCards) {
      const targetId = totals.has(card.columnId) ? card.columnId : fallbackColId;
      if (targetId) {
        totals.set(targetId, (totals.get(targetId) ?? 0) + 1);
      }
    }
    for (const card of displayCards) {
      const list = grouped.get(card.columnId) ?? (fallbackColId ? grouped.get(fallbackColId) : undefined);
      if (list) {
        list.push(card);
      }
    }
    return { cardsByColumn: grouped, totalCardsByColumn: totals };
  }, [columns, allCards, displayCards]);

  // Calcular presencia/awareness sobre ALLCARDS sin filtrar para evitar fallos visuales al filtrar
  const cardColumnById = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of allCards) {
      map.set(card.id, card.columnId);
    }
    return map;
  }, [allCards]);

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

  const commentsCountByCardId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [cardId, list] of commentsByCardId.entries()) {
      counts.set(cardId, list.length);
    }
    return counts;
  }, [commentsByCardId]);

  const columnSortableIds = useMemo(
    () => columns.map(col => `col-sort:${col.id}`),
    [columns]
  );

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

  const handleMoveColumnStep = useCallback((colId: string, direction: 'left' | 'right') => {
    const idx = columns.findIndex(c => c.id === colId);
    if (idx === -1) return;
    if (direction === 'left' && idx > 0) {
      const prev = idx - 2 >= 0 ? columns[idx - 2] : null;
      const next = columns[idx - 1];
      moveColumn(colId, prev?.orderKey ?? null, next?.orderKey ?? null);
    } else if (direction === 'right' && idx < columns.length - 1) {
      const prev = columns[idx + 1];
      const next = idx + 2 < columns.length ? columns[idx + 2] : null;
      moveColumn(colId, prev?.orderKey ?? null, next?.orderKey ?? null);
    }
  }, [columns, moveColumn]);

  const handleCreateColumnSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clean = sanitizeSingleLineText(newColumnTitle, LIMITS.COLUMN_TITLE_MAX, '');
    if (!clean) return;
    addColumn(clean);
    setNewColumnTitle('');
    setIsAddingColumn(false);
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
                      ? 'bg-primary/20 text-ink border-primary/50'
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
            activeCard || activeColumn ? '' : 'snap-x snap-mandatory md:snap-none'
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
              <SortableContext items={columnSortableIds} strategy={horizontalListSortingStrategy}>
                {columns.map((column, idx) => (
                  <KanbanColumn
                    key={column.id}
                    column={column}
                    allColumns={columns}
                    cards={cardsByColumn.get(column.id) ?? []}
                    totalCardsInColumn={totalCardsByColumn.get(column.id) ?? 0}
                    hasActiveFilters={hasActiveFilters}
                    canManageColumns={canManageColumns}
                    isFirstColumn={idx === 0}
                    isLastColumn={idx === columns.length - 1}
                    commentsCountByCardId={commentsCountByCardId}
                    onOpenCreateCard={onOpenCreateCard}
                    onDeleteCard={deleteCard}
                    onCardClick={onSelectCard}
                    onUpdateColumn={updateColumn}
                    onDeleteColumn={deleteColumn}
                    onMoveColumnStep={handleMoveColumnStep}
                    collaborators={collaborators}
                    currentUserId={currentUser.id}
                  />
                ))}
              </SortableContext>

              {canManageColumns && columns.length < LIMITS.MAX_COLUMNS_PER_BOARD && (
                <div className="w-72 shrink-0">
                  {isAddingColumn ? (
                    <form
                      onSubmit={handleCreateColumnSubmit}
                      className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-2"
                    >
                      <input
                        type="text"
                        autoFocus
                        maxLength={LIMITS.COLUMN_TITLE_MAX}
                        value={newColumnTitle}
                        onChange={e => setNewColumnTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') {
                            setNewColumnTitle('');
                            setIsAddingColumn(false);
                          }
                        }}
                        placeholder="Nombre de la columna..."
                        aria-label="Nombre de la nueva columna"
                        className="w-full bg-slate-950 border border-primary text-slate-100 text-xs px-2.5 py-2 rounded-lg focus:outline-none"
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setNewColumnTitle('');
                            setIsAddingColumn(false);
                          }}
                          className="p-1.5 text-slate-400 hover:text-ink rounded"
                          aria-label="Cancelar nueva columna"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <button
                          type="submit"
                          disabled={!newColumnTitle.trim()}
                          className="flex items-center gap-1 text-xs bg-primary hover:bg-blue-600 disabled:opacity-40 text-white font-medium px-3 py-1.5 rounded-lg transition"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Añadir
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsAddingColumn(true)}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-dashed border-slate-700 bg-slate-900/30 hover:bg-slate-900/70 text-slate-400 hover:text-ink text-xs font-medium transition"
                    >
                      <Plus className="w-4 h-4" />
                      Añadir columna
                    </button>
                  )}
                </div>
              )}
            </div>

            <DragOverlay dropAnimation={null}>
              {activeCard ? (
                <div className="cursor-grabbing rotate-1 scale-105 shadow-2xl">
                  <KanbanCardView
                    card={activeCard}
                    commentsCount={commentsCountByCardId.get(activeCard.id) ?? 0}
                    isOverlay
                    onDelete={() => {}}
                    onClick={() => {}}
                    collaborators={collaborators}
                    currentUserId={currentUser.id}
                  />
                </div>
              ) : activeColumn ? (
                <div className="w-80 bg-surface border border-primary rounded-xl p-3 shadow-2xl opacity-95">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-ink truncate">{activeColumn.title}</span>
                    <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full">
                      {totalCardsByColumn.get(activeColumn.id) ?? 0}
                    </span>
                  </div>
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
        onClose={onCloseCreateCard}
        onCreateCard={addCard}
      />

      <CardModal
        card={editingCard}
        columns={columns}
        comments={editingCard ? (commentsByCardId.get(editingCard.id) ?? []) : []}
        collaborators={collaborators}
        boardMembers={boardMembers}
        currentUser={currentUser}
        onClose={onCloseCardModal}
        onUpdate={updateCard}
        onDelete={deleteCard}
        onAddComment={addComment}
        onDeleteComment={deleteComment}
      />
    </>
  );
}

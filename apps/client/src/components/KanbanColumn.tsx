import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LIMITS, sanitizeSingleLineText, type Column, type Card, type UserPresence } from '@kanban/shared-types';
import { KanbanCard } from './KanbanCard';
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  GripHorizontal,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Ban,
} from 'lucide-react';

const COLUMN_COLOR_PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#64748b',
];

interface Props {
  column: Column;
  allColumns?: Column[];
  cards: Card[];
  totalCardsInColumn?: number;
  hasActiveFilters?: boolean;
  canManageColumns?: boolean;
  isFirstColumn?: boolean;
  isLastColumn?: boolean;
  commentsCountByCardId?: Map<string, number>;
  onOpenCreateCard: (colId: string) => void;
  onDeleteCard: (id: string) => void;
  onCardClick: (card: Card) => void;
  onUpdateColumn?: (colId: string, updates: Partial<Pick<Column, 'title' | 'color'>>) => void;
  onDeleteColumn?: (colId: string, targetColumnIdForCards?: string | null) => void;
  onMoveColumnStep?: (colId: string, direction: 'left' | 'right') => void;
  collaborators?: UserPresence[];
  currentUserId?: string;
}

export function KanbanColumn({
  column,
  allColumns = [],
  cards,
  totalCardsInColumn,
  hasActiveFilters = false,
  canManageColumns = false,
  isFirstColumn = false,
  isLastColumn = false,
  commentsCountByCardId,
  onOpenCreateCard,
  onDeleteCard,
  onCardClick,
  onUpdateColumn,
  onDeleteColumn,
  onMoveColumnStep,
  collaborators,
  currentUserId,
}: Props) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(column.title);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const otherColumns = useMemo(
    () => allColumns.filter(c => c.id !== column.id),
    [allColumns, column.id]
  );
  const [moveTargetColId, setMoveTargetColId] = useState<string>(otherColumns[0]?.id ?? '__delete__');

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleOutside = (e: Event) => {
      const target = e.target as Node | null;
      if (
        target &&
        !menuPanelRef.current?.contains(target) &&
        !menuTriggerRef.current?.contains(target)
      ) {
        setIsMenuOpen(false);
        setIsConfirmingDelete(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
        setIsConfirmingDelete(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  const droppableData = useMemo(() => ({ type: 'column', column }), [column]);
  const sortableData = useMemo(() => ({ type: 'column-sortable', column }), [column]);
  const cardIds = useMemo(() => cards.map(c => c.id), [cards]);

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: column.id,
    data: droppableData,
  });

  const {
    attributes: colAttributes,
    listeners: colListeners,
    setNodeRef: setSortableRef,
    transform: colTransform,
    transition: colTransition,
    isDragging: isColumnDragging,
  } = useSortable({
    id: `col-sort:${column.id}`,
    data: sortableData,
    disabled: !canManageColumns || isRenaming || isConfirmingDelete,
  });

  const creatingCollaborator = collaborators?.find(
    c => c.userId !== currentUserId && c.activity?.action === 'creating-card' && c.activity?.columnId === column.id
  );
  const draggingCollaborator = collaborators?.find(
    c => c.userId !== currentUserId && c.activity?.action === 'dragging-column' && c.activity?.columnId === column.id
  );
  const highlightCollaborator = draggingCollaborator ?? creatingCollaborator;

  const realCount = totalCardsInColumn ?? cards.length;
  const canDeleteCol = otherColumns.length > 0;

  const handleRenameSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clean = sanitizeSingleLineText(draftTitle, LIMITS.COLUMN_TITLE_MAX, '');
    if (clean && clean !== column.title) {
      onUpdateColumn?.(column.id, { title: clean });
    }
    setIsRenaming(false);
  };

  return (
    <div
      ref={setSortableRef}
      data-column-id={column.id}
      style={{
        transform: CSS.Transform.toString(colTransform),
        transition: colTransition,
        opacity: isColumnDragging ? 0.5 : 1,
        ...(highlightCollaborator
          ? {
              borderColor: highlightCollaborator.avatarColor,
              boxShadow: `0 0 0 1px ${highlightCollaborator.avatarColor}40`,
            }
          : {}),
      }}
      className="flex flex-col w-[85vw] max-w-[340px] sm:w-80 bg-slate-900/60 border border-slate-800 rounded-xl p-2.5 sm:p-3 shrink-0 snap-center md:snap-align-none max-h-[calc(100dvh-13rem)] md:max-h-[82vh] transition-all duration-150 relative overflow-hidden"
    >
      {column.color && (
        <div
          className="absolute top-0 left-0 right-0 h-1 rounded-t-xl"
          style={{ backgroundColor: column.color }}
        />
      )}

      {/* Cabecera de la columna */}
      <div className="flex items-center justify-between mb-2.5 sm:mb-3 px-1 pt-0.5 gap-1">
        {isRenaming ? (
          <form onSubmit={handleRenameSubmit} className="flex items-center gap-1 flex-1 min-w-0">
            <input
              type="text"
              autoFocus
              maxLength={LIMITS.COLUMN_TITLE_MAX}
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setDraftTitle(column.title);
                  setIsRenaming(false);
                }
              }}
              aria-label="Nuevo título de columna"
              className="flex-1 min-w-0 bg-slate-950 border border-primary text-slate-100 text-xs font-semibold px-2 py-1 rounded focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Guardar nombre de columna"
              className="p-1 text-emerald-400 hover:bg-emerald-500/20 rounded"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftTitle(column.title);
                setIsRenaming(false);
              }}
              aria-label="Cancelar renombrado de columna"
              className="p-1 text-slate-400 hover:text-ink rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-1.5 min-w-0">
              {canManageColumns && (
                <button
                  type="button"
                  {...colAttributes}
                  {...colListeners}
                  aria-label={`Reordenar columna ${column.title}`}
                  title="Arrastrar para reordenar columna"
                  className="text-slate-500 hover:text-slate-200 p-0.5 cursor-grab active:cursor-grabbing shrink-0"
                >
                  <GripHorizontal className="w-3.5 h-3.5" />
                </button>
              )}
              <h3 className="font-semibold text-sm text-slate-200 truncate">{column.title}</h3>
              <span className="text-xs font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full shrink-0">
                {hasActiveFilters ? `${cards.length}/${realCount}` : cards.length}
              </span>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              {canManageColumns && (
                <button
                  ref={menuTriggerRef}
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(prev => !prev);
                    setIsConfirmingDelete(false);
                  }}
                  aria-label={`Opciones de columna ${column.title}`}
                  title="Gestionar columna"
                  className="text-slate-400 hover:text-ink p-1.5 sm:p-1 hover:bg-slate-800 rounded transition"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenCreateCard(column.id)}
                aria-label={`Añadir tarjeta a ${column.title}`}
                className="text-slate-400 hover:text-ink p-1.5 sm:p-1 hover:bg-slate-800 rounded transition"
                title="Añadir tarjeta"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Menú de gestión de columna (solo owner/admin) */}
      {canManageColumns && isMenuOpen && !isRenaming && (
        <div
          ref={menuPanelRef}
          className="mb-2.5 bg-surface border border-border rounded-lg p-2.5 text-xs space-y-2.5 shadow-lg"
        >
          {isConfirmingDelete ? (
            <div className="space-y-2">
              <p className="font-medium text-red-300">
                ¿Eliminar "{column.title}"?
              </p>
              {realCount > 0 && (
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Qué hacer con las {realCount} tarjetas:
                  </label>
                  <select
                    value={moveTargetColId}
                    onChange={e => setMoveTargetColId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs px-2 py-1 rounded"
                  >
                    {otherColumns.map(c => (
                      <option key={c.id} value={c.id}>Mover a "{c.title}"</option>
                    ))}
                    <option value="__delete__">Eliminar también las tarjetas</option>
                  </select>
                </div>
              )}
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(false)}
                  className="px-2 py-1 text-slate-400 hover:text-ink rounded"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteColumn?.(
                      column.id,
                      realCount > 0 && moveTargetColId !== '__delete__' ? moveTargetColId : null
                    );
                    setIsConfirmingDelete(false);
                    setIsMenuOpen(false);
                  }}
                  className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded font-medium"
                >
                  Confirmar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setDraftTitle(column.title);
                    setIsRenaming(true);
                    setIsMenuOpen(false);
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-800 text-slate-200"
                >
                  <Pencil className="w-3.5 h-3.5 text-primary" />
                  Renombrar
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={isFirstColumn}
                    onClick={() => onMoveColumnStep?.(column.id, 'left')}
                    aria-label="Mover columna a la izquierda"
                    title="Mover a la izquierda"
                    className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 text-slate-300"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={isLastColumn}
                    onClick={() => onMoveColumnStep?.(column.id, 'right')}
                    aria-label="Mover columna a la derecha"
                    title="Mover a la derecha"
                    className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 text-slate-300"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Quitar color de columna"
                    title="Sin color"
                    onClick={() => onUpdateColumn?.(column.id, { color: '' })}
                    className={`w-4 h-4 rounded-full border border-slate-500 flex items-center justify-center text-slate-400 transition ${
                      !column.color ? 'ring-2 ring-primary scale-110' : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    <Ban className="w-2.5 h-2.5" />
                  </button>
                  {COLUMN_COLOR_PALETTE.map(c => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Color de columna ${c}`}
                      onClick={() => onUpdateColumn?.(column.id, { color: c })}
                      style={{ backgroundColor: c }}
                      className={`w-4 h-4 rounded-full transition ${
                        column.color === c ? 'ring-2 ring-ink scale-110' : 'opacity-75 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!canDeleteCol}
                  onClick={() => {
                    setMoveTargetColId(otherColumns[0]?.id ?? '__delete__');
                    setIsConfirmingDelete(true);
                  }}
                  title={canDeleteCol ? 'Eliminar columna' : 'Debe haber al menos una columna'}
                  className="flex items-center gap-1 text-red-400 hover:text-red-300 disabled:opacity-30 px-1.5 py-1 rounded hover:bg-red-500/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Eliminar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {draggingCollaborator && (
        <div
          style={{
            backgroundColor: `${draggingCollaborator.avatarColor}20`,
            borderColor: `${draggingCollaborator.avatarColor}60`,
          }}
          className="mb-2 px-2 py-1 rounded-lg border text-[10px] text-ink flex items-center justify-between animate-pulse"
        >
          <span className="font-semibold truncate max-w-[120px]">{draggingCollaborator.userName}</span>
          <span className="opacity-90 font-normal">reordenando columna...</span>
        </div>
      )}

      {creatingCollaborator && (
        <div
          style={{
            backgroundColor: `${creatingCollaborator.avatarColor}20`,
            borderColor: `${creatingCollaborator.avatarColor}60`,
          }}
          className="mb-2 px-2 py-1 rounded-lg border text-[10px] text-ink flex items-center justify-between animate-pulse"
        >
          <span className="font-semibold truncate max-w-[120px]">{creatingCollaborator.userName}</span>
          <span className="opacity-90 font-normal">creando tarjeta...</span>
        </div>
      )}

      {/* Lista de tarjetas sortable con espaciado para insignias y sombras flotantes */}
      <div ref={setDroppableRef} className="flex-1 overflow-y-auto px-1 sm:px-2 pt-3.5 pb-3 min-h-[120px]">
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {cards.map(card => (
            <KanbanCard
              key={card.id}
              card={card}
              commentsCount={commentsCountByCardId?.get(card.id) ?? 0}
              onDelete={onDeleteCard}
              onClick={onCardClick}
              collaborators={collaborators}
              currentUserId={currentUserId}
            />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="h-24 border border-dashed border-slate-800 rounded-lg flex items-center justify-center text-xs text-slate-500 text-center px-3">
            {hasActiveFilters ? 'Sin coincidencias con el filtro' : 'Columna vacía'}
          </div>
        )}
      </div>
    </div>
  );
}

import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Column, Card, UserPresence } from '@kanban/shared-types';
import { KanbanCard } from './KanbanCard';
import { Plus } from 'lucide-react';

interface Props {
  column: Column;
  cards: Card[];
  onOpenCreateCard: (colId: string) => void;
  onDeleteCard: (id: string) => void;
  onCardClick: (card: Card) => void;
  collaborators?: UserPresence[];
  currentUserId?: string;
}

export function KanbanColumn({
  column,
  cards,
  onOpenCreateCard,
  onDeleteCard,
  onCardClick,
  collaborators,
  currentUserId
}: Props) {
  const droppableData = useMemo(() => ({ type: 'column', column }), [column]);
  const cardIds = useMemo(() => cards.map(c => c.id), [cards]);

  const { setNodeRef } = useDroppable({
    id: column.id,
    data: droppableData,
  });

  const creatingCollaborator = collaborators?.find(
    c => c.userId !== currentUserId && c.activity?.action === 'creating-card' && c.activity?.columnId === column.id
  );

  return (
    <div
      style={creatingCollaborator ? {
        borderColor: creatingCollaborator.avatarColor,
        boxShadow: `0 0 0 1px ${creatingCollaborator.avatarColor}40`
      } : undefined}
      className="flex flex-col w-80 bg-slate-900/60 border border-slate-800 rounded-xl p-3 shrink-0 max-h-[85vh] transition-all duration-150"
    >
      {/* Cabecera de la columna */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm text-slate-200">{column.title}</h3>
          <span className="text-xs font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
            {cards.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onOpenCreateCard(column.id)}
          aria-label={`Añadir tarjeta a ${column.title}`}
          className="text-slate-400 hover:text-white p-1 hover:bg-slate-800 rounded transition"
          title="Añadir tarjeta"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {creatingCollaborator && (
        <div
          style={{
            backgroundColor: `${creatingCollaborator.avatarColor}20`,
            borderColor: `${creatingCollaborator.avatarColor}60`
          }}
          className="mb-2 px-2 py-1 rounded-lg border text-[10px] text-white flex items-center justify-between animate-pulse"
        >
          <span className="font-semibold truncate max-w-[120px]">{creatingCollaborator.userName}</span>
          <span className="opacity-90 font-normal">creando tarjeta...</span>
        </div>
      )}

      {/* Lista de tarjetas sortable con espaciado para insignias y sombras flotantes */}
      <div ref={setNodeRef} className="flex-1 overflow-y-auto px-2 pt-3.5 pb-3 min-h-[120px]">
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {cards.map(card => (
            <KanbanCard
              key={card.id}
              card={card}
              onDelete={onDeleteCard}
              onClick={onCardClick}
              collaborators={collaborators}
              currentUserId={currentUserId}
            />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="h-24 border border-dashed border-slate-800 rounded-lg flex items-center justify-center text-xs text-slate-600">
            Columna vacía
          </div>
        )}
      </div>
    </div>
  );
}
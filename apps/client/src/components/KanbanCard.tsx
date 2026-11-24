import { useMemo, type CSSProperties, type HTMLAttributes } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card, CardPriority, UserPresence } from '@kanban/shared-types';
import { Trash2, GripVertical, Tag, Calendar, CheckSquare, Flag } from 'lucide-react';

interface CardProps {
  card: Card;
  onDelete: (id: string) => void;
  onClick: (card: Card) => void;
  collaborators?: UserPresence[];
  currentUserId?: string;
}

interface CardViewProps extends CardProps {
  cardRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  attributes?: HTMLAttributes<HTMLElement>;
  listeners?: Record<string, unknown>;
  isDragging?: boolean;
  isOverlay?: boolean;
}

const PRIORITY_STYLES: Record<CardPriority, { label: string; className: string }> = {
  urgent: {
    label: 'Urgente',
    className: 'bg-red-500/20 text-red-300 border-red-500/40',
  },
  high: {
    label: 'Alta',
    className: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  },
  medium: {
    label: 'Media',
    className: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  },
  low: {
    label: 'Baja',
    className: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  },
};

function formatDueDateBadge(dueDate: number): { label: string; className: string } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  const dateObj = new Date(dueDate);
  const label = dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });

  if (dueDate < startOfToday) {
    return {
      label: `${label} (vencida)`,
      className: 'bg-red-500/15 text-red-300 border-red-500/40',
    };
  }
  if (dueDate <= startOfToday + twoDaysMs) {
    return {
      label,
      className: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    };
  }
  return {
    label,
    className: 'bg-slate-800/80 text-slate-300 border-slate-700',
  };
}

/**
 * Vista presentacional pura de tarjeta Kanban (sin hooks de @dnd-kit).
 * Se reutiliza en `<DragOverlay>` para evitar registros duplicados de `useSortable`.
 */
export function KanbanCardView({
  card,
  onDelete,
  onClick,
  collaborators,
  currentUserId,
  cardRef,
  style,
  attributes,
  listeners,
  isDragging = false,
  isOverlay = false,
}: CardViewProps) {
  const activeCollaborator = collaborators?.find(
    c => c.userId !== currentUserId && c.activity?.cardId === card.id
  );

  const mergedStyle: CSSProperties = {
    ...style,
    opacity: isOverlay ? 1 : isDragging ? 0.35 : 1,
    ...(activeCollaborator && !isOverlay
      ? {
          boxShadow: `0 0 0 2px ${activeCollaborator.avatarColor}, 0 4px 18px ${activeCollaborator.avatarColor}55`,
          borderColor: activeCollaborator.avatarColor,
        }
      : {}),
  };

  const priorityMeta = card.priority ? PRIORITY_STYLES[card.priority] : null;
  const dueMeta = card.dueDate ? formatDueDateBadge(card.dueDate) : null;
  const checklist = card.checklist ?? [];
  const completedCount = checklist.filter(item => item.completed).length;
  const checklistPct = checklist.length > 0 ? Math.round((completedCount / checklist.length) * 100) : 0;

  return (
    <div
      ref={cardRef}
      style={mergedStyle}
      {...attributes}
      {...listeners}
      onClick={() => onClick(card)}
      className={`bg-surface hover:bg-surfaceHover border border-border p-3 rounded-lg shadow-sm mb-3 group transition-colors duration-150 relative overflow-visible select-none ${
        isOverlay ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing hover:border-slate-600'
      }`}
    >
      {activeCollaborator && !isOverlay && (
        <div
          style={{ backgroundColor: activeCollaborator.avatarColor }}
          className="absolute -top-2.5 right-3 px-2 py-0.5 rounded-full text-[10px] font-bold text-white shadow-lg border border-black/25 flex items-center gap-1.5 z-20 animate-pulse tracking-tight whitespace-nowrap"
        >
          <span>{activeCollaborator.userName}</span>
          <span className="opacity-95 font-normal">
            ({activeCollaborator.activity?.action === 'editing-card' ? 'editando' : 'arrastrando'})
          </span>
        </div>
      )}

      {(priorityMeta || card.storyPoints != null) && (
        <div className="flex items-center justify-between gap-2 mb-1.5 pl-5">
          {priorityMeta ? (
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${priorityMeta.className}`}
            >
              <Flag className="w-2.5 h-2.5" />
              {priorityMeta.label}
            </span>
          ) : (
            <span />
          )}
          {card.storyPoints != null && (
            <span className="text-[10px] font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded">
              {card.storyPoints} pts
            </span>
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <GripVertical className="w-3.5 h-3.5 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          <h4 className="font-medium text-sm text-slate-100 truncate">{card.title}</h4>
        </div>
        {!isOverlay && (
          <button
            type="button"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              onDelete(card.id);
            }}
            aria-label="Eliminar tarjeta"
            className="text-slate-500 hover:text-red-400 p-1 rounded transition-colors opacity-70 sm:opacity-0 sm:group-hover:opacity-100 flex-shrink-0"
            title="Eliminar tarjeta"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {card.description && (
        <p className="text-xs text-slate-400 mt-1 line-clamp-2 mb-2 pl-5 font-normal">
          {card.description}
        </p>
      )}

      {card.labels && card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-5 mb-2">
          {card.labels.map(label => (
            <span
              key={label.id}
              style={{
                backgroundColor: `${label.color}25`,
                color: label.color,
                borderColor: `${label.color}40`,
              }}
              className="text-[10px] px-1.5 py-0.5 rounded border font-medium flex items-center gap-1"
            >
              <Tag className="w-2.5 h-2.5" />
              {label.name}
            </span>
          ))}
        </div>
      )}

      {checklist.length > 0 && (
        <div className="pl-5 mb-2">
          <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
            <span className="inline-flex items-center gap-1">
              <CheckSquare className="w-3 h-3 text-emerald-400" />
              Subtareas
            </span>
            <span className="font-mono">
              {completedCount}/{checklist.length}
            </span>
          </div>
          <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                completedCount === checklist.length ? 'bg-emerald-400' : 'bg-primary'
              }`}
              style={{ width: `${checklistPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pl-5 text-[10px] text-slate-500 mt-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {dueMeta ? (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-medium ${dueMeta.className}`}
            >
              <Calendar className="w-2.5 h-2.5 shrink-0" />
              {dueMeta.label}
            </span>
          ) : (
            <span className="font-mono">#{card.id.substring(0, 6)}</span>
          )}
        </div>

        {card.assignee ? (
          <div
            className="flex items-center gap-1.5 min-w-0 bg-slate-900/80 border border-slate-800 px-1.5 py-0.5 rounded-full"
            title={`Asignado a ${card.assignee.name}`}
          >
            <span
              className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0"
              style={{ backgroundColor: card.assignee.color || '#6366f1' }}
            >
              {card.assignee.name.charAt(0).toUpperCase()}
            </span>
            <span className="text-slate-300 truncate max-w-[85px]">{card.assignee.name}</span>
          </div>
        ) : (
          <span className="font-mono">key: {card.orderKey}</span>
        )}
      </div>
    </div>
  );
}

/** Envoltorio sortable de tarjeta Kanban conectado a @dnd-kit/sortable. */
export function KanbanCard({ card, onDelete, onClick, collaborators, currentUserId }: CardProps) {
  const sortableData = useMemo(() => ({ type: 'card', card }), [card]);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: sortableData });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <KanbanCardView
      card={card}
      onDelete={onDelete}
      onClick={onClick}
      collaborators={collaborators}
      currentUserId={currentUserId}
      cardRef={setNodeRef}
      style={style}
      attributes={attributes}
      listeners={listeners}
      isDragging={isDragging}
    />
  );
}
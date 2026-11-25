import { useEffect, useState, type FormEvent } from 'react';
import {
  LIMITS,
  type BoardMember,
  type Card,
  type CardAssignee,
  type CardPriority,
  type ChecklistItem,
  type Column,
  type Label,
  type UserPresence,
  type UserProfile,
} from '@kanban/shared-types';
import { X, AlignLeft, Plus } from 'lucide-react';
import { CardRichFieldsEditor } from './CardRichFieldsEditor.js';

interface Props {
  isOpen: boolean;
  columns: Column[];
  defaultColumnId: string;
  collaborators: UserPresence[];
  boardMembers: BoardMember[];
  currentUser: UserProfile;
  onClose: () => void;
  onCreateCard: (
    columnId: string,
    title: string,
    description: string,
    labels: Label[],
    extras?: Pick<Partial<Card>, 'priority' | 'dueDate' | 'assignee' | 'checklist' | 'storyPoints'>
  ) => void;
}

interface ContentProps {
  columns: Column[];
  defaultColumnId: string;
  collaborators: UserPresence[];
  boardMembers: BoardMember[];
  currentUser: UserProfile;
  onClose: () => void;
  onCreateCard: Props['onCreateCard'];
}

function CreateCardModalContent({
  columns,
  defaultColumnId,
  collaborators,
  boardMembers,
  currentUser,
  onClose,
  onCreateCard,
}: ContentProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columnId, setColumnId] = useState(defaultColumnId || columns[0]?.id || '');
  const [labels, setLabels] = useState<Label[]>([]);
  const [priority, setPriority] = useState<CardPriority | null>(null);
  const [dueDate, setDueDate] = useState<number | null>(null);
  const [storyPoints, setStoryPoints] = useState<number | null>(null);
  const [assignee, setAssignee] = useState<CardAssignee | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreateCard(columnId || columns[0]?.id, title.trim(), description.trim(), labels, {
      priority,
      dueDate,
      assignee,
      checklist,
      storyPoints,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-card-modal-title"
    >
      <div
        className="bg-surface border border-border w-full max-w-xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden rounded-t-2xl sm:rounded-xl shadow-2xl relative animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-border/80 bg-surface">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">
              <Plus className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 id="create-card-modal-title" className="text-sm font-semibold text-white truncate">Nueva Tarjeta</h3>
              <p className="text-xs text-slate-400 truncate">Añade una tarjeta con sus detalles al tablero</p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            aria-label="Cerrar modal de nueva tarjeta"
            className="text-slate-400 hover:text-white p-1.5 -mr-1 rounded-lg hover:bg-slate-800 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4">
            <div>
              <label htmlFor="create-card-title" className="text-xs text-slate-300 block mb-1.5 font-medium">
                Título <span className="text-red-400">*</span>
              </label>
              <input
                id="create-card-title"
                type="text"
                maxLength={LIMITS.CARD_TITLE_MAX}
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-white font-medium text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-primary"
                placeholder="Ej: Diseñar flujo de autenticación..."
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="create-card-column" className="text-xs text-slate-300 block mb-1.5 font-medium">
                Columna de destino
              </label>
              <select
                id="create-card-column"
                value={columnId}
                onChange={e => setColumnId(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg w-full focus:outline-none focus:border-primary"
              >
                {columns.map(col => (
                  <option key={col.id} value={col.id}>
                    {col.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="create-card-desc" className="text-xs text-slate-300 flex items-center gap-1.5 mb-1.5 font-medium">
                <AlignLeft className="w-3.5 h-3.5" />
                Descripción (opcional)
              </label>
              <textarea
                id="create-card-desc"
                value={description}
                maxLength={LIMITS.CARD_DESC_MAX}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg resize-none focus:outline-none focus:border-primary"
                placeholder="Añade especificaciones, detalles o notas..."
              />
            </div>

            <CardRichFieldsEditor
              priority={priority}
              onPriorityChange={setPriority}
              dueDate={dueDate}
              onDueDateChange={setDueDate}
              storyPoints={storyPoints}
              onStoryPointsChange={setStoryPoints}
              assignee={assignee}
              onAssigneeChange={setAssignee}
              checklist={checklist}
              onChecklistChange={setChecklist}
              labels={labels}
              onLabelsChange={setLabels}
              collaborators={collaborators}
              boardMembers={boardMembers}
              currentUser={currentUser}
            />

            <div className="flex justify-end items-center gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!title.trim()}
                className="text-xs bg-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-lg transition flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Crear Tarjeta
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CreateCardModal({
  isOpen,
  columns,
  defaultColumnId,
  collaborators,
  boardMembers,
  currentUser,
  onClose,
  onCreateCard,
}: Props) {
  if (!isOpen) return null;

  return (
    <CreateCardModalContent
      columns={columns}
      defaultColumnId={defaultColumnId}
      collaborators={collaborators}
      boardMembers={boardMembers}
      currentUser={currentUser}
      onClose={onClose}
      onCreateCard={onCreateCard}
    />
  );
}

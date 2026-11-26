import { useCallback, useEffect, useState } from 'react';
import {
  LIMITS,
  type BoardMember,
  type Card,
  type CardAssignee,
  type CardComment,
  type CardPriority,
  type ChecklistItem,
  type Column,
  type Label,
  type UserPresence,
  type UserProfile,
} from '@kanban/shared-types';
import { X, AlignLeft, Trash2, Clock, Eye, Pencil, MessageSquare, Send } from 'lucide-react';
import { CardRichFieldsEditor } from './CardRichFieldsEditor.js';
import { SafeMarkdown } from '../SafeMarkdown.js';

interface Props {
  card: Card | null;
  columns: Column[];
  comments: CardComment[];
  collaborators: UserPresence[];
  boardMembers: BoardMember[];
  currentUser: UserProfile;
  onClose: () => void;
  onUpdate: (cardId: string, updates: Partial<Card>) => void;
  onDelete: (cardId: string) => void;
  onAddComment: (cardId: string, text: string) => void;
  onDeleteComment: (commentId: string) => void;
}

interface ContentProps {
  card: Card;
  columns: Column[];
  comments: CardComment[];
  collaborators: UserPresence[];
  boardMembers: BoardMember[];
  currentUser: UserProfile;
  onClose: () => void;
  onUpdate: (cardId: string, updates: Partial<Card>) => void;
  onDelete: (cardId: string) => void;
  onAddComment: (cardId: string, text: string) => void;
  onDeleteComment: (commentId: string) => void;
}

function formatCardTimestamp(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CardModalContent({
  card,
  columns,
  comments,
  collaborators,
  boardMembers,
  currentUser,
  onClose,
  onUpdate,
  onDelete,
  onAddComment,
  onDeleteComment,
}: ContentProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || '');
  const [isPreviewDesc, setIsPreviewDesc] = useState(Boolean(card.description));
  const [commentDraft, setCommentDraft] = useState('');
  const [columnId, setColumnId] = useState(card.columnId);
  const [labels, setLabels] = useState<Label[]>(card.labels || []);
  const [priority, setPriority] = useState<CardPriority | null>(card.priority ?? null);
  const [dueDate, setDueDate] = useState<number | null>(card.dueDate ?? null);
  const [storyPoints, setStoryPoints] = useState<number | null>(card.storyPoints ?? null);
  const [assignee, setAssignee] = useState<CardAssignee | null>(card.assignee ?? null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(card.checklist ?? []);

  const handleSave = useCallback(() => {
    if (!title.trim()) return;
    onUpdate(card.id, {
      title: title.trim(),
      description: description.trim(),
      columnId,
      labels,
      priority,
      dueDate,
      storyPoints,
      assignee,
      checklist,
    });
    onClose();
  }, [card.id, title, description, columnId, labels, priority, dueDate, storyPoints, assignee, checklist, onUpdate, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const active = document.activeElement as HTMLElement | null;
        if (active?.id === 'card-comment-input') return;
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, handleSave]);

  const handlePostComment = () => {
    const trimmed = commentDraft.trim();
    if (!trimmed) return;
    onAddComment(card.id, trimmed);
    setCommentDraft('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-modal-title"
    >
      <div
        className="bg-surface border border-border w-full max-w-xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden rounded-t-2xl sm:rounded-xl shadow-2xl relative animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-border/80 bg-surface">
          <h3 id="card-modal-title" className="text-xs uppercase font-bold tracking-wider text-primary">
            Detalle de Tarjeta
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle de tarjeta"
            className="text-slate-400 hover:text-ink p-1.5 -mr-1 rounded-lg hover:bg-slate-800 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
          <input
            type="text"
            maxLength={LIMITS.CARD_TITLE_MAX}
            value={title}
            onChange={e => setTitle(e.target.value)}
            aria-label="Título de la tarjeta"
            className="w-full bg-slate-900 border border-slate-700 text-ink font-semibold text-lg px-3 py-2 rounded-lg mb-4 focus:outline-none focus:border-primary"
            placeholder="Título de la tarjeta..."
          />

          <div className="space-y-4">
            <div>
              <label htmlFor="card-column-select" className="text-xs text-slate-400 block mb-1.5 font-medium">
                Columna
              </label>
              <select
                id="card-column-select"
                value={columnId}
                onChange={e => setColumnId(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-200 text-sm px-3 py-1.5 rounded-lg w-full focus:outline-none focus:border-primary"
              >
                {columns.map(col => (
                  <option key={col.id} value={col.id}>{col.title}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="card-description-input" className="text-xs text-slate-400 flex items-center gap-1.5 font-medium">
                  <AlignLeft className="w-3.5 h-3.5" />
                  Descripción (Markdown)
                </label>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setIsPreviewDesc(false)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded transition ${
                      !isPreviewDesc ? 'bg-primary/20 text-primary font-medium' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Pencil className="w-3 h-3" />
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPreviewDesc(true)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded transition ${
                      isPreviewDesc ? 'bg-primary/20 text-primary font-medium' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Eye className="w-3 h-3" />
                    Vista previa
                  </button>
                </div>
              </div>
              {isPreviewDesc ? (
                <div className="w-full min-h-[76px] bg-slate-900/70 border border-slate-800 px-3 py-2 rounded-lg">
                  <SafeMarkdown content={description} />
                </div>
              ) : (
                <textarea
                  id="card-description-input"
                  value={description}
                  maxLength={LIMITS.CARD_DESC_MAX}
                  onChange={e => setDescription(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm px-3 py-2 rounded-lg resize-y focus:outline-none focus:border-primary"
                  placeholder="Añade especificaciones con Markdown (**negrita**, - listas, `código`, [enlace](https://...))..."
                />
              )}
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

            {/* Hilo de Comentarios CRDT */}
            <div className="pt-3 border-t border-slate-800/80">
              <span className="text-xs text-slate-300 flex items-center gap-1.5 mb-2 font-medium">
                <MessageSquare className="w-3.5 h-3.5 text-primary" />
                Comentarios ({comments.length})
              </span>

              {comments.length > 0 && (
                <div className="space-y-2 mb-3 max-h-44 overflow-y-auto pr-1">
                  {comments.map(comment => (
                    <div
                      key={comment.id}
                      className="bg-slate-900/70 border border-slate-800 rounded-lg p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                            style={{ backgroundColor: comment.authorColor }}
                          >
                            {comment.authorName.charAt(0).toUpperCase()}
                          </span>
                          <span className="font-medium text-slate-200 truncate">{comment.authorName}</span>
                          <span className="text-[10px] text-slate-500">{formatCardTimestamp(comment.createdAt)}</span>
                        </div>
                        {comment.authorId === currentUser.id && (
                          <button
                            type="button"
                            onClick={() => onDeleteComment(comment.id)}
                            aria-label="Eliminar comentario"
                            className="text-slate-500 hover:text-red-400 p-0.5 rounded transition shrink-0"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <p className="text-slate-300 whitespace-pre-wrap break-words">{comment.text}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-start gap-2">
                <textarea
                  id="card-comment-input"
                  rows={2}
                  maxLength={LIMITS.COMMENT_MAX}
                  value={commentDraft}
                  onChange={e => setCommentDraft(e.target.value)}
                  onKeyDown={e => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handlePostComment();
                    }
                  }}
                  placeholder="Escribe un comentario... (Ctrl+Enter para enviar)"
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg resize-none focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  disabled={!commentDraft.trim()}
                  onClick={handlePostComment}
                  className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 px-3 py-2 rounded-lg transition inline-flex items-center gap-1 shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  Enviar
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 mt-5 pt-3 border-t border-slate-800/80">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Creada: {formatCardTimestamp(card.createdAt)}
            </span>
            <span>Última edición: {formatCardTimestamp(card.updatedAt)}</span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-4 mt-3 border-t border-border">
            <button
              type="button"
              onClick={() => {
                onDelete(card.id);
                onClose();
              }}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition"
            >
              <Trash2 className="w-4 h-4" />
              Eliminar
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-slate-400 hover:text-ink px-3 py-1.5 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!title.trim()}
                className="text-xs bg-primary hover:bg-blue-600 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition"
              >
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CardModal({
  card,
  columns,
  comments,
  collaborators,
  boardMembers,
  currentUser,
  onClose,
  onUpdate,
  onDelete,
  onAddComment,
  onDeleteComment,
}: Props) {
  if (!card) return null;

  return (
    <CardModalContent
      key={card.id}
      card={card}
      columns={columns}
      comments={comments}
      collaborators={collaborators}
      boardMembers={boardMembers}
      currentUser={currentUser}
      onClose={onClose}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onAddComment={onAddComment}
      onDeleteComment={onDeleteComment}
    />
  );
}

import { useState } from 'react';
import {
  LIMITS,
  generateUuid,
  sanitizeSingleLineText,
  type BoardMember,
  type CardAssignee,
  type CardPriority,
  type ChecklistItem,
  type Label,
  type UserPresence,
  type UserProfile,
} from '@kanban/shared-types';
import { Calendar, Check, CheckSquare, Flag, Plus, Tag, Trash2, User, Zap } from 'lucide-react';
import { PRESET_LABELS } from '../../core/constants/labels.js';
import { AVATAR_COLORS } from '../../core/storage/localUserRepository.js';

interface Props {
  priority: CardPriority | null;
  onPriorityChange: (priority: CardPriority | null) => void;
  dueDate: number | null;
  onDueDateChange: (dueDate: number | null) => void;
  storyPoints: number | null;
  onStoryPointsChange: (points: number | null) => void;
  assignee: CardAssignee | null;
  onAssigneeChange: (assignee: CardAssignee | null) => void;
  checklist: ChecklistItem[];
  onChecklistChange: (items: ChecklistItem[]) => void;
  labels: Label[];
  onLabelsChange: (labels: Label[]) => void;
  collaborators: UserPresence[];
  boardMembers: BoardMember[];
  currentUser: UserProfile;
}

const PRIORITY_OPTIONS: Array<{ value: '' | CardPriority; label: string }> = [
  { value: '', label: 'Sin prioridad' },
  { value: 'low', label: 'Baja' },
  { value: 'medium', label: 'Media' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
];

const STORY_POINT_PRESETS = [1, 2, 3, 5, 8, 13];

function timestampToDateInput(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateInputToTimestamp(value: string): number | null {
  if (!value) return null;
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

/**
 * Formulario compartido para los campos avanzados de tarjeta Kanban:
 * prioridad, fecha límite, puntos de esfuerzo, responsable, checklist y etiquetas.
 */
export function CardRichFieldsEditor({
  priority,
  onPriorityChange,
  dueDate,
  onDueDateChange,
  storyPoints,
  onStoryPointsChange,
  assignee,
  onAssigneeChange,
  checklist,
  onChecklistChange,
  labels,
  onLabelsChange,
  collaborators,
  boardMembers,
  currentUser,
}: Props) {
  const [newSubtaskText, setNewSubtaskText] = useState('');
  const [customAssigneeName, setCustomAssigneeName] = useState('');
  const [customLabelName, setCustomLabelName] = useState('');
  const [customLabelColor, setCustomLabelColor] = useState<string>(AVATAR_COLORS[5]);

  const candidateMap = new Map<string, CardAssignee>();
  candidateMap.set(currentUser.id, {
    userId: currentUser.id,
    name: currentUser.name,
    color: currentUser.color,
  });
  for (const member of boardMembers) {
    if (!member.left && member.userId !== currentUser.id) {
      candidateMap.set(member.userId, {
        userId: member.userId,
        name: member.name,
        color: member.color,
      });
    }
  }
  for (const collab of collaborators) {
    if (collab.userId !== currentUser.id) {
      candidateMap.set(collab.userId, {
        userId: collab.userId,
        name: collab.userName,
        color: collab.avatarColor,
      });
    }
  }
  const collaboratorCandidates = Array.from(candidateMap.values());

  const handleAddSubtask = () => {
    const clean = sanitizeSingleLineText(newSubtaskText, LIMITS.CHECKLIST_ITEM_MAX, '');
    if (!clean || checklist.length >= LIMITS.MAX_CHECKLIST_ITEMS) return;
    onChecklistChange([
      ...checklist,
      { id: `chk-${generateUuid().slice(0, 8)}`, text: clean, completed: false },
    ]);
    setNewSubtaskText('');
  };

  const handleToggleSubtask = (id: string) => {
    onChecklistChange(
      checklist.map(item => (item.id === id ? { ...item, completed: !item.completed } : item))
    );
  };

  const handleRemoveSubtask = (id: string) => {
    onChecklistChange(checklist.filter(item => item.id !== id));
  };

  const togglePresetLabel = (preset: Omit<Label, 'id'>) => {
    const exists = labels.some(l => l.name === preset.name);
    if (exists) {
      onLabelsChange(labels.filter(l => l.name !== preset.name));
    } else if (labels.length < LIMITS.MAX_LABELS_PER_CARD) {
      onLabelsChange([...labels, { id: `lbl-${generateUuid().slice(0, 8)}`, ...preset }]);
    }
  };

  const handleAddCustomLabel = () => {
    const cleanName = sanitizeSingleLineText(customLabelName, LIMITS.LABEL_NAME_MAX, '');
    if (!cleanName || labels.length >= LIMITS.MAX_LABELS_PER_CARD) return;
    if (labels.some(l => l.name.toLowerCase() === cleanName.toLowerCase())) {
      setCustomLabelName('');
      return;
    }
    onLabelsChange([
      ...labels,
      { id: `lbl-${generateUuid().slice(0, 8)}`, name: cleanName, color: customLabelColor },
    ]);
    setCustomLabelName('');
  };

  const handleApplyCustomAssignee = () => {
    const clean = sanitizeSingleLineText(customAssigneeName, LIMITS.USER_NAME_MAX, '');
    if (!clean) return;
    onAssigneeChange({ name: clean, color: '#6366f1' });
    setCustomAssigneeName('');
  };

  return (
    <div className="space-y-4">
      {/* Prioridad, Fecha Límite y Puntos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="card-priority-select" className="text-xs text-slate-300 flex items-center gap-1.5 mb-1.5 font-medium">
            <Flag className="w-3.5 h-3.5 text-amber-400" />
            Prioridad
          </label>
          <select
            id="card-priority-select"
            value={priority ?? ''}
            onChange={e => onPriorityChange((e.target.value || null) as CardPriority | null)}
            className="bg-slate-900 border border-slate-700 text-slate-200 text-xs px-2.5 py-2 rounded-lg w-full focus:outline-none focus:border-primary"
          >
            {PRIORITY_OPTIONS.map(opt => (
              <option key={opt.label} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="card-due-date-input" className="text-xs text-slate-300 flex items-center gap-1.5 mb-1.5 font-medium">
            <Calendar className="w-3.5 h-3.5 text-sky-400" />
            Fecha límite
          </label>
          <input
            id="card-due-date-input"
            type="date"
            value={timestampToDateInput(dueDate)}
            onChange={e => onDueDateChange(dateInputToTimestamp(e.target.value))}
            className="bg-slate-900 border border-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg w-full focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label htmlFor="card-points-input" className="text-xs text-slate-300 flex items-center gap-1.5 mb-1.5 font-medium">
            <Zap className="w-3.5 h-3.5 text-purple-400" />
            Puntos
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="card-points-input"
              type="number"
              min={1}
              max={LIMITS.MAX_STORY_POINTS}
              step={1}
              value={storyPoints ?? ''}
              onChange={e => {
                const raw = e.target.value.trim();
                if (!raw) {
                  onStoryPointsChange(null);
                  return;
                }
                const parsed = Number(raw);
                if (Number.isFinite(parsed) && parsed > 0 && parsed <= LIMITS.MAX_STORY_POINTS) {
                  onStoryPointsChange(Math.round(parsed));
                }
              }}
              placeholder="Ej: 3"
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs px-2.5 py-2 rounded-lg w-full focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {STORY_POINT_PRESETS.map(pt => (
              <button
                key={pt}
                type="button"
                onClick={() => onStoryPointsChange(storyPoints === pt ? null : pt)}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition ${
                  storyPoints === pt
                    ? 'bg-primary/25 border-primary text-blue-200 font-semibold'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {pt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Responsable */}
      <div>
        <span className="text-xs text-slate-300 flex items-center gap-1.5 mb-1.5 font-medium">
          <User className="w-3.5 h-3.5 text-emerald-400" />
          Responsable
        </span>
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {collaboratorCandidates.map(candidate => {
            const isSelected =
              assignee &&
              ((candidate.userId && assignee.userId === candidate.userId) ||
                assignee.name === candidate.name);
            const isSelf = candidate.userId === currentUser.id;
            return (
              <button
                key={candidate.userId || candidate.name}
                type="button"
                onClick={() => onAssigneeChange(isSelected ? null : candidate)}
                className={`text-xs px-2 py-1 rounded-full border flex items-center gap-1.5 transition ${
                  isSelected
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200 font-medium'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <span
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                  style={{ backgroundColor: candidate.color || '#6366f1' }}
                >
                  {candidate.name.charAt(0).toUpperCase()}
                </span>
                <span>{isSelf ? `${candidate.name} (Tú)` : candidate.name}</span>
              </button>
            );
          })}
          {assignee && (
            <button
              type="button"
              onClick={() => onAssigneeChange(null)}
              className="text-[11px] text-slate-400 hover:text-red-300 px-2 py-1 rounded-full border border-slate-800 hover:border-red-500/40 transition"
            >
              Quitar
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            maxLength={LIMITS.USER_NAME_MAX}
            value={customAssigneeName}
            onChange={e => setCustomAssigneeName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleApplyCustomAssignee();
              }
            }}
            placeholder={assignee ? `Actual: ${assignee.name} (o escribe otro nombre...)` : 'O escribe un responsable manualmente...'}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-primary"
          />
          <button
            type="button"
            disabled={!customAssigneeName.trim()}
            onClick={handleApplyCustomAssignee}
            className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 px-2.5 py-1.5 rounded-lg transition"
          >
            Asignar
          </button>
        </div>
      </div>

      {/* Checklist / Subtareas */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-300 flex items-center gap-1.5 font-medium">
            <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
            Checklist ({checklist.filter(i => i.completed).length}/{checklist.length})
          </span>
        </div>

        {checklist.length > 0 && (
          <div className="space-y-1.5 mb-2 max-h-36 overflow-y-auto pr-1">
            {checklist.map(item => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 bg-slate-900/70 border border-slate-800 px-2.5 py-1.5 rounded-lg"
              >
                <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => handleToggleSubtask(item.id)}
                    className="rounded border-slate-600 bg-slate-800 text-primary focus:ring-0"
                  />
                  <span className={`truncate ${item.completed ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                    {item.text}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => handleRemoveSubtask(item.id)}
                  aria-label={`Eliminar subtarea ${item.text}`}
                  className="text-slate-500 hover:text-red-400 p-0.5 rounded transition shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            type="text"
            maxLength={LIMITS.CHECKLIST_ITEM_MAX}
            value={newSubtaskText}
            onChange={e => setNewSubtaskText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddSubtask();
              }
            }}
            placeholder="Añadir subtarea..."
            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-primary"
          />
          <button
            type="button"
            disabled={!newSubtaskText.trim() || checklist.length >= LIMITS.MAX_CHECKLIST_ITEMS}
            onClick={handleAddSubtask}
            className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 px-2.5 py-1.5 rounded-lg transition inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Añadir
          </button>
        </div>
      </div>

      {/* Etiquetas (presets + personalizadas) */}
      <div>
        <span className="text-xs text-slate-300 flex items-center gap-1.5 mb-2 font-medium">
          <Tag className="w-3.5 h-3.5" />
          Etiquetas
        </span>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {PRESET_LABELS.map(preset => {
            const isSelected = labels.some(l => l.name === preset.name);
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => togglePresetLabel(preset)}
                style={{
                  backgroundColor: isSelected ? preset.color : `${preset.color}15`,
                  color: isSelected ? '#fff' : preset.color,
                  borderColor: preset.color,
                }}
                className="text-xs px-2.5 py-1 rounded-full border transition flex items-center gap-1 font-medium"
              >
                {isSelected && <Check className="w-3 h-3" />}
                {preset.name}
              </button>
            );
          })}
          {labels
            .filter(l => !PRESET_LABELS.some(p => p.name === l.name))
            .map(custom => (
              <button
                key={custom.id}
                type="button"
                onClick={() => onLabelsChange(labels.filter(l => l.id !== custom.id))}
                style={{
                  backgroundColor: custom.color,
                  color: '#fff',
                  borderColor: custom.color,
                }}
                className="text-xs px-2.5 py-1 rounded-full border transition flex items-center gap-1 font-medium"
                title="Clic para quitar etiqueta"
              >
                <Check className="w-3 h-3" />
                {custom.name}
              </button>
            ))}
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <input
            type="text"
            maxLength={LIMITS.LABEL_NAME_MAX}
            value={customLabelName}
            onChange={e => setCustomLabelName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCustomLabel();
              }
            }}
            placeholder="Nueva etiqueta personalizada..."
            className="flex-1 min-w-[160px] bg-slate-900 border border-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-primary"
          />
          <div className="flex items-center gap-1">
            {AVATAR_COLORS.slice(0, 5).map(c => (
              <button
                key={c}
                type="button"
                aria-label={`Color de etiqueta ${c}`}
                onClick={() => setCustomLabelColor(c)}
                style={{ backgroundColor: c }}
                className={`w-4 h-4 rounded-full transition ${
                  customLabelColor === c ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            disabled={!customLabelName.trim() || labels.length >= LIMITS.MAX_LABELS_PER_CARD}
            onClick={handleAddCustomLabel}
            className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 px-2.5 py-1.5 rounded-lg transition"
          >
            + Etiqueta
          </button>
        </div>
      </div>
    </div>
  );
}

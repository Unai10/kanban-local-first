import { useMemo, type RefObject } from 'react';
import { Search, X, Filter, User, Flag, Tag, Calendar } from 'lucide-react';
import type { Card, CardPriority } from '@kanban/shared-types';
import type { BoardFilterState, DueDateFilter } from '../hooks/useBoardFilters.js';

interface Props {
  filters: BoardFilterState;
  onChange: (next: BoardFilterState) => void;
  onClear: () => void;
  activeFilterCount: number;
  totalCards: number;
  visibleCards: number;
  cards: Card[];
  searchInputRef: RefObject<HTMLInputElement | null>;
}

export function BoardFilterBar({
  filters,
  onChange,
  onClear,
  activeFilterCount,
  totalCards,
  visibleCards,
  cards,
  searchInputRef,
}: Props) {
  const { availableLabels, availableAssignees } = useMemo(() => {
    const labelSet = new Set<string>();
    const assigneeSet = new Set<string>();
    for (const card of cards) {
      for (const lbl of card.labels) {
        labelSet.add(lbl.name);
      }
      if (card.assignee?.name) {
        assigneeSet.add(card.assignee.name);
      }
    }
    return {
      availableLabels: Array.from(labelSet).sort((a, b) => a.localeCompare(b)),
      availableAssignees: Array.from(assigneeSet).sort((a, b) => a.localeCompare(b)),
    };
  }, [cards]);

  return (
    <section
      aria-label="Buscador y filtros del tablero"
      className="border-b border-border bg-surface/40 px-3 sm:px-6 py-2 flex flex-wrap items-center gap-2"
    >
      {/* Buscador de texto */}
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={searchInputRef}
          type="text"
          value={filters.query}
          onChange={e => onChange({ ...filters, query: e.target.value })}
          placeholder="Buscar tarjetas... (/)"
          aria-label="Buscar tarjetas"
          className="w-full bg-slate-900/90 border border-slate-700 text-slate-100 placeholder-slate-500 text-xs pl-8 pr-7 py-1.5 rounded-lg focus:outline-none focus:border-primary"
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => onChange({ ...filters, query: '' })}
            aria-label="Limpiar texto de búsqueda"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-ink"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Solo mis tarjetas */}
      <button
        type="button"
        onClick={() => onChange({ ...filters, onlyMine: !filters.onlyMine })}
        className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition ${
          filters.onlyMine
            ? 'bg-primary/20 border-primary/50 text-primary font-medium'
            : 'bg-slate-900/70 border-slate-700 text-slate-300 hover:border-slate-500'
        }`}
      >
        <User className="w-3.5 h-3.5" />
        <span>Mis tarjetas</span>
      </button>

      {/* Prioridad */}
      <div className="flex items-center gap-1 bg-slate-900/70 border border-slate-700 rounded-lg px-2 py-1">
        <Flag className="w-3 h-3 text-amber-400 shrink-0" />
        <select
          aria-label="Filtrar por prioridad"
          value={filters.priority}
          onChange={e => onChange({ ...filters, priority: e.target.value as '' | CardPriority })}
          className="bg-transparent text-xs text-slate-200 focus:outline-none"
        >
          <option value="" className="bg-slate-900">Prioridad</option>
          <option value="urgent" className="bg-slate-900">Urgente</option>
          <option value="high" className="bg-slate-900">Alta</option>
          <option value="medium" className="bg-slate-900">Media</option>
          <option value="low" className="bg-slate-900">Baja</option>
        </select>
      </div>

      {/* Etiqueta */}
      {availableLabels.length > 0 && (
        <div className="flex items-center gap-1 bg-slate-900/70 border border-slate-700 rounded-lg px-2 py-1">
          <Tag className="w-3 h-3 text-sky-400 shrink-0" />
          <select
            aria-label="Filtrar por etiqueta"
            value={filters.labelName}
            onChange={e => onChange({ ...filters, labelName: e.target.value })}
            className="bg-transparent text-xs text-slate-200 focus:outline-none max-w-[130px]"
          >
            <option value="" className="bg-slate-900">Etiqueta</option>
            {availableLabels.map(lbl => (
              <option key={lbl} value={lbl} className="bg-slate-900">{lbl}</option>
            ))}
          </select>
        </div>
      )}

      {/* Responsable */}
      <div className="flex items-center gap-1 bg-slate-900/70 border border-slate-700 rounded-lg px-2 py-1">
        <Filter className="w-3 h-3 text-emerald-400 shrink-0" />
        <select
          aria-label="Filtrar por responsable"
          value={filters.assigneeName}
          onChange={e => onChange({ ...filters, assigneeName: e.target.value })}
          className="bg-transparent text-xs text-slate-200 focus:outline-none max-w-[140px]"
        >
          <option value="" className="bg-slate-900">Responsable</option>
          <option value="__unassigned__" className="bg-slate-900">Sin asignar</option>
          {availableAssignees.map(name => (
            <option key={name} value={name} className="bg-slate-900">{name}</option>
          ))}
        </select>
      </div>

      {/* Fecha límite */}
      <div className="flex items-center gap-1 bg-slate-900/70 border border-slate-700 rounded-lg px-2 py-1">
        <Calendar className="w-3 h-3 text-purple-400 shrink-0" />
        <select
          aria-label="Filtrar por fecha límite"
          value={filters.dueFilter}
          onChange={e => onChange({ ...filters, dueFilter: e.target.value as DueDateFilter })}
          className="bg-transparent text-xs text-slate-200 focus:outline-none"
        >
          <option value="all" className="bg-slate-900">Vencimiento</option>
          <option value="overdue" className="bg-slate-900">Vencidas</option>
          <option value="upcoming" className="bg-slate-900">Próximas 48h</option>
          <option value="none" className="bg-slate-900">Sin fecha</option>
        </select>
      </div>

      {activeFilterCount > 0 && (
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[11px] text-slate-400 font-mono">
            {visibleCards}/{totalCards}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 text-xs text-amber-300 hover:text-ink bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 px-2.5 py-1 rounded-lg transition"
          >
            <X className="w-3 h-3" />
            Limpiar ({activeFilterCount})
          </button>
        </div>
      )}
    </section>
  );
}

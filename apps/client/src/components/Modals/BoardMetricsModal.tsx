import { useEffect, useMemo } from 'react';
import { X, BarChart3, CheckSquare, Calendar, AlertTriangle, Users } from 'lucide-react';
import type { Card, CardPriority, Column } from '@kanban/shared-types';
import type { BoardFilterState } from '../../features/kanban/hooks/useBoardFilters.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  boardTitle: string;
  columns: Column[];
  cards: Card[];
  onApplyQuickFilter: (partial: Partial<BoardFilterState>) => void;
}

export interface BoardMetricsSummary {
  totalCards: number;
  totalPoints: number;
  overdueCount: number;
  upcomingCount: number;
  checklistTotal: number;
  checklistDone: number;
  byColumn: Array<{ id: string; title: string; color?: string; count: number; points: number }>;
  byPriority: Record<CardPriority | 'none', number>;
  byAssignee: Array<{ name: string; color?: string; count: number; points: number; isUnassigned: boolean }>;
}

/** Calcula estadísticas agregadas del tablero en memoria. */
export function computeBoardMetrics(
  columns: readonly Column[],
  cards: readonly Card[],
  nowMs: number = Date.now()
): BoardMetricsSummary {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const twoDaysEnd = startOfToday + 2 * 24 * 60 * 60 * 1000;

  let totalPoints = 0;
  let overdueCount = 0;
  let upcomingCount = 0;
  let checklistTotal = 0;
  let checklistDone = 0;

  const colMap = new Map<string, { id: string; title: string; color?: string; count: number; points: number }>();
  for (const col of columns) {
    colMap.set(col.id, { id: col.id, title: col.title, color: col.color, count: 0, points: 0 });
  }

  const byPriority: Record<CardPriority | 'none', number> = {
    urgent: 0,
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
  };

  const assigneeMap = new Map<string, { name: string; color?: string; count: number; points: number; isUnassigned: boolean }>();

  for (const card of cards) {
    const pts = card.storyPoints ?? 0;
    totalPoints += pts;

    const colBucket = colMap.get(card.columnId);
    if (colBucket) {
      colBucket.count += 1;
      colBucket.points += pts;
    }

    byPriority[card.priority ?? 'none'] += 1;

    if (card.dueDate) {
      if (card.dueDate < startOfToday) overdueCount += 1;
      else if (card.dueDate <= twoDaysEnd) upcomingCount += 1;
    }

    const list = card.checklist ?? [];
    checklistTotal += list.length;
    checklistDone += list.filter(i => i.completed).length;

    const key = card.assignee ? card.assignee.name : '__unassigned__';
    const existing = assigneeMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.points += pts;
    } else {
      assigneeMap.set(key, {
        name: card.assignee ? card.assignee.name : 'Sin asignar',
        color: card.assignee?.color,
        count: 1,
        points: pts,
        isUnassigned: !card.assignee,
      });
    }
  }

  const byAssignee = Array.from(assigneeMap.values()).sort((a, b) => b.count - a.count);

  return {
    totalCards: cards.length,
    totalPoints,
    overdueCount,
    upcomingCount,
    checklistTotal,
    checklistDone,
    byColumn: Array.from(colMap.values()),
    byPriority,
    byAssignee,
  };
}

export function BoardMetricsModal({
  isOpen,
  onClose,
  boardTitle,
  columns,
  cards,
  onApplyQuickFilter,
}: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const metrics = useMemo(() => computeBoardMetrics(columns, cards), [columns, cards]);

  if (!isOpen) return null;

  const checklistPct = metrics.checklistTotal > 0
    ? Math.round((metrics.checklistDone / metrics.checklistTotal) * 100)
    : 0;

  const triggerFilter = (partial: Partial<BoardFilterState>) => {
    onApplyQuickFilter(partial);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="metrics-modal-title"
    >
      <div
        className="bg-surface border border-border w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden rounded-xl shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4 border-b border-border/80">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 id="metrics-modal-title" className="text-sm font-semibold text-ink truncate">
                Resumen y Métricas
              </h3>
              <p className="text-xs text-slate-400 truncate">{boardTitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar resumen"
            className="text-slate-400 hover:text-ink p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-xs">
          {/* Tarjetas clave */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3">
              <p className="text-slate-400 mb-1">Total tarjetas</p>
              <p className="text-xl font-bold text-ink font-mono">{metrics.totalCards}</p>
              <p className="text-[11px] text-slate-500 font-mono">{metrics.totalPoints} pts esfuerzo</p>
            </div>

            <button
              type="button"
              onClick={() => triggerFilter({ dueFilter: 'overdue' })}
              className="text-left bg-slate-900/70 hover:border-red-500/50 border border-slate-800 rounded-lg p-3 transition"
              title="Clic para filtrar tarjetas vencidas"
            >
              <p className="text-slate-400 flex items-center gap-1 mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                Vencidas
              </p>
              <p className="text-xl font-bold text-red-400 font-mono">{metrics.overdueCount}</p>
              <p className="text-[10px] text-slate-500">Clic para filtrar</p>
            </button>

            <button
              type="button"
              onClick={() => triggerFilter({ dueFilter: 'upcoming' })}
              className="text-left bg-slate-900/70 hover:border-amber-500/50 border border-slate-800 rounded-lg p-3 transition"
              title="Clic para filtrar próximas 48h"
            >
              <p className="text-slate-400 flex items-center gap-1 mb-1">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                Próximas 48h
              </p>
              <p className="text-xl font-bold text-amber-400 font-mono">{metrics.upcomingCount}</p>
              <p className="text-[10px] text-slate-500">Clic para filtrar</p>
            </button>

            <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3">
              <p className="text-slate-400 flex items-center gap-1 mb-1">
                <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                Subtareas
              </p>
              <p className="text-xl font-bold text-emerald-400 font-mono">{checklistPct}%</p>
              <p className="text-[11px] text-slate-500 font-mono">{metrics.checklistDone}/{metrics.checklistTotal}</p>
            </div>
          </div>

          {/* Distribución por columna */}
          <div>
            <h4 className="font-semibold text-slate-200 mb-2">Distribución por columna</h4>
            <div className="space-y-2">
              {metrics.byColumn.map(col => {
                const pct = metrics.totalCards > 0 ? Math.round((col.count / metrics.totalCards) * 100) : 0;
                return (
                  <div key={col.id} className="space-y-1">
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="truncate font-medium">{col.title}</span>
                      <span className="font-mono text-slate-400">
                        {col.count} ({pct}%) · {col.points} pts
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: col.color || '#3b82f6',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Carga por responsable */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold text-slate-200 flex items-center gap-1.5 mb-2">
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                Carga por responsable
              </h4>
              <div className="space-y-1.5">
                {metrics.byAssignee.map(a => (
                  <button
                    key={a.name}
                    type="button"
                    onClick={() =>
                      triggerFilter({ assigneeName: a.isUnassigned ? '__unassigned__' : a.name })
                    }
                    className="w-full flex items-center justify-between bg-slate-900/70 hover:bg-slate-800 border border-slate-800 rounded-lg px-2.5 py-1.5 transition text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ backgroundColor: a.color || '#64748b' }}
                      >
                        {a.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="text-slate-200 truncate">{a.name}</span>
                    </div>
                    <span className="font-mono text-slate-400 shrink-0">
                      {a.count} · {a.points} pts
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-slate-200 mb-2">Por prioridad</h4>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { key: 'urgent', label: 'Urgente', cls: 'text-red-400' },
                    { key: 'high', label: 'Alta', cls: 'text-orange-400' },
                    { key: 'medium', label: 'Media', cls: 'text-amber-400' },
                    { key: 'low', label: 'Baja', cls: 'text-sky-400' },
                  ] as const
                ).map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => triggerFilter({ priority: item.key })}
                    className="bg-slate-900/70 hover:bg-slate-800 border border-slate-800 rounded-lg p-2.5 text-left transition"
                  >
                    <span className={`font-medium ${item.cls}`}>{item.label}</span>
                    <p className="text-base font-bold font-mono text-ink mt-0.5">
                      {metrics.byPriority[item.key]}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

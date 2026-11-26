import { useMemo, useState } from 'react';
import type { Card, CardPriority } from '@kanban/shared-types';

export type DueDateFilter = 'all' | 'overdue' | 'upcoming' | 'none';

export interface BoardFilterState {
  query: string;
  onlyMine: boolean;
  assigneeName: string;
  priority: '' | CardPriority;
  labelName: string;
  dueFilter: DueDateFilter;
}

export const INITIAL_BOARD_FILTERS: BoardFilterState = {
  query: '',
  onlyMine: false,
  assigneeName: '',
  priority: '',
  labelName: '',
  dueFilter: 'all',
};

/**
 * Filtra tarjetas en memoria con latencia de 0 ms según búsqueda y criterios combinables.
 */
export function filterCards(
  cards: readonly Card[],
  filters: BoardFilterState,
  currentUserId: string,
  nowMs: number = Date.now()
): Card[] {
  const q = filters.query.trim().toLowerCase();
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const twoDaysEnd = startOfToday + 2 * 24 * 60 * 60 * 1000;

  return cards.filter(card => {
    if (q) {
      const inTitle = card.title.toLowerCase().includes(q);
      const inDesc = card.description.toLowerCase().includes(q);
      if (!inTitle && !inDesc) return false;
    }

    if (filters.onlyMine && card.assignee?.userId !== currentUserId) {
      return false;
    }

    if (filters.assigneeName) {
      if (filters.assigneeName === '__unassigned__') {
        if (card.assignee) return false;
      } else if (card.assignee?.name !== filters.assigneeName) {
        return false;
      }
    }

    if (filters.priority && card.priority !== filters.priority) {
      return false;
    }

    if (filters.labelName && !card.labels.some(l => l.name === filters.labelName)) {
      return false;
    }

    if (filters.dueFilter === 'overdue') {
      if (!card.dueDate || card.dueDate >= startOfToday) return false;
    } else if (filters.dueFilter === 'upcoming') {
      if (!card.dueDate || card.dueDate < startOfToday || card.dueDate > twoDaysEnd) return false;
    } else if (filters.dueFilter === 'none') {
      if (card.dueDate) return false;
    }

    return true;
  });
}

export function useBoardFilters(cards: readonly Card[], currentUserId: string) {
  const [filters, setFilters] = useState<BoardFilterState>(INITIAL_BOARD_FILTERS);

  const filteredCards = useMemo(
    () => filterCards(cards, filters, currentUserId),
    [cards, filters, currentUserId]
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.query.trim()) count++;
    if (filters.onlyMine) count++;
    if (filters.assigneeName) count++;
    if (filters.priority) count++;
    if (filters.labelName) count++;
    if (filters.dueFilter !== 'all') count++;
    return count;
  }, [filters]);

  const clearFilters = () => setFilters(INITIAL_BOARD_FILTERS);

  return {
    filters,
    setFilters,
    filteredCards,
    activeFilterCount,
    hasActiveFilters: activeFilterCount > 0,
    clearFilters,
  };
}

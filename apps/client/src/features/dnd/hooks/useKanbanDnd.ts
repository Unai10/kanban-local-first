import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { compareCards, type Card, type Column, type UserActivity } from '@kanban/shared-types';
import { kanbanCollisionDetection } from '../collision/kanbanCollision.js';

interface UseKanbanDndParams {
  cards: Card[];
  columns: Column[];
  moveCard: (
    cardId: string,
    targetColId: string,
    prevKey: string | null,
    nextKey: string | null
  ) => void;
  onUpdateActivity?: (activity: UserActivity | null) => void;
}

/**
 * Hook de Drag & Drop sobre @dnd-kit: gestiona estado optimista durante el arrastre
 * entre columnas y calcula nuevas claves fraccionarias (`orderKey`) al soltar.
 */
export function useKanbanDnd({ cards, columns, moveCard, onUpdateActivity }: UseKanbanDndParams) {
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [localCards, setLocalCards] = useState<Card[] | null>(null);

  const displayCards = localCards ?? cards;

  const cardsRef = useRef(cards);
  const columnsRef = useRef(columns);
  const localCardsRef = useRef(localCards);
  const moveCardRef = useRef(moveCard);
  const onUpdateActivityRef = useRef(onUpdateActivity);

  useEffect(() => {
    cardsRef.current = cards;
    columnsRef.current = columns;
    localCardsRef.current = localCards;
    moveCardRef.current = moveCard;
    onUpdateActivityRef.current = onUpdateActivity;
  }, [cards, columns, localCards, moveCard, onUpdateActivity]);

  useEffect(() => {
    return () => {
      document.body.classList.remove('is-dragging');
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const cleanup = useCallback(() => {
    setActiveCard(null);
    setLocalCards(null);
    document.body.classList.remove('is-dragging');
    onUpdateActivityRef.current?.(null);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const cardData = event.active.data.current?.card as Card | undefined;
    if (cardData) {
      setActiveCard(cardData);
      setLocalCards(cardsRef.current);
      document.body.classList.add('is-dragging');
      onUpdateActivityRef.current?.({ action: 'dragging-card', cardId: cardData.id });
    }
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const currentSnapshot = localCardsRef.current ?? cardsRef.current;
    const activeSnapshotItem = currentSnapshot.find(c => c.id === activeId);
    if (!activeSnapshotItem) return;

    const currentColumns = columnsRef.current;
    const isOverColumn = currentColumns.some(col => col.id === overId);

    if (isOverColumn) {
      if (activeSnapshotItem.columnId === overId) return;
    } else {
      const overSnapshotItem = currentSnapshot.find(c => c.id === overId);
      if (!overSnapshotItem || activeSnapshotItem.columnId === overSnapshotItem.columnId) {
        return;
      }
    }

    setLocalCards(prev => {
      const current = prev ?? cardsRef.current;
      const activeIndex = current.findIndex(c => c.id === activeId);
      if (activeIndex === -1) return prev;

      const activeItem = current[activeIndex];

      // CASO 1: Sobre el fondo de una columna vacía o distinta
      if (isOverColumn) {
        if (activeItem.columnId !== overId) {
          const withoutActive = current.filter(c => c.id !== activeId);
          return [...withoutActive, { ...activeItem, columnId: overId }];
        }
        return prev;
      }

      // CASO 2: Sobre otra tarjeta en una columna distinta
      const overItem = current.find(c => c.id === overId);
      if (!overItem) return prev;

      if (activeItem.columnId !== overItem.columnId) {
        const withoutActive = current.filter(c => c.id !== activeId);
        const targetOverIndex = withoutActive.findIndex(c => c.id === overId);
        if (targetOverIndex === -1) return prev;

        const translatedTop = active.rect.current.translated?.top;
        const isBelowOverItem =
          translatedTop !== undefined &&
          over.rect &&
          translatedTop > over.rect.top + over.rect.height / 2;

        const insertIndex = isBelowOverItem ? targetOverIndex + 1 : targetOverIndex;
        const next = [...withoutActive];
        next.splice(insertIndex, 0, { ...activeItem, columnId: overItem.columnId });
        return next;
      }

      return prev;
    });
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const baseCards = cardsRef.current;
    const currentCards = localCardsRef.current ?? baseCards;
    cleanup();

    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const originalCard = baseCards.find(c => c.id === activeId);
    const draggedCard = currentCards.find(c => c.id === activeId);
    if (!draggedCard || !originalCard) return;

    const isOverColumn = columnsRef.current.some(col => col.id === overId);
    const overCard = currentCards.find(c => c.id === overId);
    const targetColId = isOverColumn ? overId : (overCard?.columnId ?? draggedCard.columnId);

    const isSameOriginalColumn = originalCard.columnId === targetColId;
    const colCards = isSameOriginalColumn
      ? baseCards.filter(c => c.columnId === targetColId).sort(compareCards)
      : currentCards.filter(c => c.columnId === targetColId);

    const activeIndexInCol = colCards.findIndex(c => c.id === activeId);

    let reorderedColCards: Card[];

    if (isOverColumn || !overCard) {
      if (activeIndexInCol !== -1) {
        reorderedColCards = isSameOriginalColumn
          ? arrayMove(colCards, activeIndexInCol, colCards.length - 1)
          : colCards;
      } else {
        reorderedColCards = [...colCards, { ...draggedCard, columnId: targetColId }];
      }
    } else {
      const overIndexInCol = colCards.findIndex(c => c.id === overId);
      if (activeIndexInCol !== -1 && overIndexInCol !== -1) {
        reorderedColCards = arrayMove(colCards, activeIndexInCol, overIndexInCol);
      } else if (overIndexInCol !== -1) {
        reorderedColCards = [...colCards];
        reorderedColCards.splice(overIndexInCol, 0, { ...draggedCard, columnId: targetColId });
      } else {
        reorderedColCards = colCards;
      }
    }

    const finalIndex = reorderedColCards.findIndex(c => c.id === activeId);
    if (finalIndex === -1) return;

    if (isSameOriginalColumn && activeIndexInCol === finalIndex) {
      return;
    }

    const prevCard = finalIndex > 0 ? reorderedColCards[finalIndex - 1] : null;
    const nextCard = finalIndex < reorderedColCards.length - 1 ? reorderedColCards[finalIndex + 1] : null;

    moveCardRef.current(
      activeId,
      targetColId,
      prevCard ? prevCard.orderKey : null,
      nextCard ? nextCard.orderKey : null
    );
  }, [cleanup]);

  const handleDragCancel = useCallback(() => {
    cleanup();
  }, [cleanup]);

  return {
    sensors,
    activeCard,
    displayCards,
    collisionDetection: kanbanCollisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}

export { kanbanCollisionDetection };

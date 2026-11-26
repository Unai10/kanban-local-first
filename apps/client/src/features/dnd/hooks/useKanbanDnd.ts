import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { compareCards, compareColumns, type Card, type Column, type UserActivity } from '@kanban/shared-types';
import { kanbanCollisionDetection } from '../collision/kanbanCollision.js';

interface UseKanbanDndParams {
  cards: Card[];
  visibleCards: Card[];
  columns: Column[];
  canManageColumns: boolean;
  moveCard: (
    cardId: string,
    targetColId: string,
    prevKey: string | null,
    nextKey: string | null
  ) => boolean;
  moveColumn: (
    columnId: string,
    prevKey: string | null,
    nextKey: string | null
  ) => void;
  onUpdateActivity?: (activity: UserActivity | null) => void;
  onDragAborted?: (reason: string) => void;
}

/**
 * Hook de Drag & Drop sobre @dnd-kit: soporta ratón, táctil y teclado, estado optimista
 * sobre tarjetas visibles y cálculo seguro de `orderKey` sobre la lista completa sin filtrar.
 */
export function useKanbanDnd({
  cards,
  visibleCards,
  columns,
  canManageColumns,
  moveCard,
  moveColumn,
  onUpdateActivity,
  onDragAborted,
}: UseKanbanDndParams) {
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const [localCards, setLocalCards] = useState<Card[] | null>(null);

  const displayCards = localCards ?? visibleCards;

  const cardsRef = useRef(cards);
  const visibleCardsRef = useRef(visibleCards);
  const columnsRef = useRef(columns);
  const canManageColumnsRef = useRef(canManageColumns);
  const localCardsRef = useRef(localCards);
  const moveCardRef = useRef(moveCard);
  const moveColumnRef = useRef(moveColumn);
  const onUpdateActivityRef = useRef(onUpdateActivity);
  const onDragAbortedRef = useRef(onDragAborted);
  const lastColumnSwapRef = useRef<{
    fromColId: string;
    toColId: string;
    timestamp: number;
  } | null>(null);

  useEffect(() => {
    cardsRef.current = cards;
    visibleCardsRef.current = visibleCards;
    columnsRef.current = columns;
    canManageColumnsRef.current = canManageColumns;
    localCardsRef.current = localCards;
    moveCardRef.current = moveCard;
    moveColumnRef.current = moveColumn;
    onUpdateActivityRef.current = onUpdateActivity;
    onDragAbortedRef.current = onDragAborted;
  }, [cards, visibleCards, columns, canManageColumns, localCards, moveCard, moveColumn, onUpdateActivity, onDragAborted]);

  useEffect(() => {
    return () => {
      document.body.classList.remove('is-dragging');
    };
  }, []);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const cleanup = useCallback(() => {
    lastColumnSwapRef.current = null;
    setActiveCard(null);
    setActiveColumn(null);
    setLocalCards(null);
    document.body.classList.remove('is-dragging');
    onUpdateActivityRef.current?.(null);
  }, []);

  // Reconciliación en vivo si otro admin elimina columnas o tarjetas durante un arrastre activo
  useEffect(() => {
    if (activeColumn && !columns.some(c => c.id === activeColumn.id)) {
      cleanup();
      onDragAbortedRef.current?.('La columna que estabas reordenando fue eliminada.');
      return;
    }

    if (activeCard) {
      if (!cards.some(c => c.id === activeCard.id)) {
        cleanup();
        onDragAbortedRef.current?.('Se canceló el arrastre porque la tarjeta o su columna origen fue eliminada.');
        return;
      }

      if (localCards) {
        const validColIds = new Set(columns.map(c => c.id));
        const localActive = localCards.find(c => c.id === activeCard.id);
        if (localActive && !validColIds.has(localActive.columnId)) {
          setLocalCards(visibleCards);
          onDragAbortedRef.current?.('La columna de destino fue eliminada durante el arrastre.');
        }
      }
    }
  }, [activeCard, activeColumn, cards, columns, localCards, visibleCards, cleanup]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const activeType = event.active.data.current?.type;
    if (activeType === 'column-sortable') {
      if (!canManageColumnsRef.current) return;
      const colData = event.active.data.current?.column as Column | undefined;
      if (colData) {
        setActiveColumn(colData);
        document.body.classList.add('is-dragging');
        onUpdateActivityRef.current?.({ action: 'dragging-column', columnId: colData.id });
      }
      return;
    }

    const cardData = event.active.data.current?.card as Card | undefined;
    if (cardData) {
      lastColumnSwapRef.current = null;
      setActiveCard(cardData);
      setLocalCards(visibleCardsRef.current);
      document.body.classList.add('is-dragging');
      onUpdateActivityRef.current?.({ action: 'dragging-card', cardId: cardData.id });
    }
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    if (event.active.data.current?.type === 'column-sortable') return;
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const currentSnapshot = localCardsRef.current ?? visibleCardsRef.current;
    const activeSnapshotItem = currentSnapshot.find(c => c.id === activeId);
    if (!activeSnapshotItem) return;

    const currentColumns = columnsRef.current;
    const isOverColumn = currentColumns.some(col => col.id === overId);

    let targetColId: string;
    if (isOverColumn) {
      targetColId = overId;
    } else {
      const overSnapshotItem = currentSnapshot.find(c => c.id === overId);
      if (!overSnapshotItem) return;
      targetColId = overSnapshotItem.columnId;
    }

    if (activeSnapshotItem.columnId === targetColId) {
      return;
    }

    // Evita bucles de rebote (ping-pong) cuando SortableContext re-mide contenedores tras mover de columna
    const now = Date.now();
    const lastSwap = lastColumnSwapRef.current;
    if (lastSwap) {
      const elapsed = now - lastSwap.timestamp;
      if (elapsed < 50) return;
      if (
        elapsed < 180 &&
        lastSwap.toColId === activeSnapshotItem.columnId &&
        lastSwap.fromColId === targetColId
      ) {
        return;
      }
    }
    lastColumnSwapRef.current = {
      fromColId: activeSnapshotItem.columnId,
      toColId: targetColId,
      timestamp: now,
    };

    setLocalCards(prev => {
      const current = prev ?? visibleCardsRef.current;
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
    const baseVisibleCards = visibleCardsRef.current;
    const currentCards = localCardsRef.current ?? baseVisibleCards;
    const activeType = event.active.data.current?.type;
    cleanup();

    const { active, over } = event;
    if (!over) return;

    if (activeType === 'column-sortable') {
      if (!canManageColumnsRef.current) return;
      const activeColId = (active.data.current?.column as Column | undefined)?.id;
      const overColId = (over.data.current?.column as Column | undefined)?.id;
      if (!activeColId || !overColId || activeColId === overColId) return;

      const sortedCols = [...columnsRef.current].sort(compareColumns);
      const fromIdx = sortedCols.findIndex(c => c.id === activeColId);
      const toIdx = sortedCols.findIndex(c => c.id === overColId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

      const reordered = arrayMove(sortedCols, fromIdx, toIdx);
      const finalIdx = reordered.findIndex(c => c.id === activeColId);
      const prevCol = finalIdx > 0 ? reordered[finalIdx - 1] : null;
      const nextCol = finalIdx < reordered.length - 1 ? reordered[finalIdx + 1] : null;
      moveColumnRef.current(activeColId, prevCol ? prevCol.orderKey : null, nextCol ? nextCol.orderKey : null);
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    const originalCard = baseCards.find(c => c.id === activeId);
    const draggedCard = currentCards.find(c => c.id === activeId);
    if (!draggedCard || !originalCard) return;

    const isOverColumn = columnsRef.current.some(col => col.id === overId);
    const overCard = currentCards.find(c => c.id === overId);
    const targetColId = isOverColumn ? overId : (overCard?.columnId ?? draggedCard.columnId);

    if (!columnsRef.current.some(col => col.id === targetColId)) {
      onDragAbortedRef.current?.('La columna de destino fue eliminada; la tarjeta se mantuvo en su ubicación actual.');
      return;
    }

    const isSameOriginalColumn = originalCard.columnId === targetColId;
    const visibleColCards = isSameOriginalColumn
      ? baseVisibleCards.filter(c => c.columnId === targetColId).sort(compareCards)
      : currentCards.filter(c => c.columnId === targetColId);

    const activeIndexInVisible = visibleColCards.findIndex(c => c.id === activeId);
    let reorderedVisible: Card[];

    if (isOverColumn || !overCard) {
      if (activeIndexInVisible !== -1) {
        reorderedVisible = isSameOriginalColumn
          ? arrayMove(visibleColCards, activeIndexInVisible, visibleColCards.length - 1)
          : visibleColCards;
      } else {
        reorderedVisible = [...visibleColCards, { ...draggedCard, columnId: targetColId }];
      }
    } else {
      const overIndexInVisible = visibleColCards.findIndex(c => c.id === overId);
      if (activeIndexInVisible !== -1 && overIndexInVisible !== -1) {
        reorderedVisible = arrayMove(visibleColCards, activeIndexInVisible, overIndexInVisible);
      } else if (overIndexInVisible !== -1) {
        reorderedVisible = [...visibleColCards];
        reorderedVisible.splice(overIndexInVisible, 0, { ...draggedCard, columnId: targetColId });
      } else {
        reorderedVisible = visibleColCards;
      }
    }

    const finalVisibleIndex = reorderedVisible.findIndex(c => c.id === activeId);
    if (finalVisibleIndex === -1) return;

    if (isSameOriginalColumn && activeIndexInVisible === finalVisibleIndex) {
      return;
    }

    // Calcular claves vecinas sobre la lista COMPLETA sin filtrar para no pisar tarjetas ocultas
    const fullTargetColCards = baseCards
      .filter(c => c.columnId === targetColId && c.id !== activeId)
      .sort(compareCards);

    let prevCard: Card | null = null;
    let nextCard: Card | null = null;

    if (baseVisibleCards.length === baseCards.length) {
      prevCard = finalVisibleIndex > 0 ? reorderedVisible[finalVisibleIndex - 1] : null;
      nextCard = finalVisibleIndex < reorderedVisible.length - 1 ? reorderedVisible[finalVisibleIndex + 1] : null;
    } else {
      const visiblePrev = finalVisibleIndex > 0 ? reorderedVisible[finalVisibleIndex - 1] : null;
      const visibleNext = finalVisibleIndex < reorderedVisible.length - 1 ? reorderedVisible[finalVisibleIndex + 1] : null;
      if (visibleNext) {
        const idxNext = fullTargetColCards.findIndex(c => c.id === visibleNext.id);
        nextCard = idxNext >= 0 ? fullTargetColCards[idxNext] : null;
        prevCard = idxNext > 0 ? fullTargetColCards[idxNext - 1] : null;
      } else if (visiblePrev) {
        const idxPrev = fullTargetColCards.findIndex(c => c.id === visiblePrev.id);
        prevCard = idxPrev >= 0 ? fullTargetColCards[idxPrev] : null;
        nextCard = idxPrev >= 0 && idxPrev < fullTargetColCards.length - 1 ? fullTargetColCards[idxPrev + 1] : null;
      } else {
        prevCard = fullTargetColCards[fullTargetColCards.length - 1] ?? null;
      }
    }

    const moved = moveCardRef.current(
      activeId,
      targetColId,
      prevCard ? prevCard.orderKey : null,
      nextCard ? nextCard.orderKey : null
    );
    if (!moved) {
      onDragAbortedRef.current?.('La columna de destino fue eliminada; la tarjeta se mantuvo en su ubicación actual.');
    }
  }, [cleanup]);

  const handleDragCancel = useCallback(() => {
    cleanup();
  }, [cleanup]);

  return {
    sensors,
    activeCard,
    activeColumn,
    displayCards,
    collisionDetection: kanbanCollisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}

export { kanbanCollisionDetection };

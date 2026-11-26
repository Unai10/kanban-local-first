import { pointerWithin, closestCenter, type CollisionDetection } from '@dnd-kit/core';

/**
 * Estrategia de colisión optimizada para tableros Kanban:
 * 1. Si se arrastra una columna, colisiona exclusivamente contra otras columnas ordenables.
 * 2. Si se arrastra con teclado (`pointerCoordinates === null`), usa `closestCenter`.
 * 3. Si el puntero cae sobre una tarjeta, la prioriza frente al fondo de la columna.
 */
export const kanbanCollisionDetection: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;

  if (activeType === 'column-sortable') {
    const columnContainers = args.droppableContainers.filter(
      container =>
        container.id !== args.active.id &&
        container.data.current?.type === 'column-sortable'
    );
    return closestCenter({ ...args, droppableContainers: columnContainers });
  }

  const droppableContainers = args.droppableContainers.filter(
    container =>
      container.id !== args.active.id &&
      container.data.current?.type !== 'column-sortable'
  );

  const filteredArgs = { ...args, droppableContainers };

  if (!args.pointerCoordinates) {
    return closestCenter(filteredArgs);
  }

  const pointerCollisions = pointerWithin(filteredArgs);
  if (pointerCollisions.length > 0) {
    const cardCollision = pointerCollisions.find(c => {
      const container = droppableContainers.find(dc => dc.id === c.id);
      return container?.data.current?.type !== 'column';
    });
    if (cardCollision) {
      return [cardCollision];
    }

    const colCollision = pointerCollisions[0];
    const colCardContainers = droppableContainers.filter(
      dc =>
        dc.data.current?.type === 'card' &&
        dc.data.current?.card?.columnId === colCollision.id
    );

    if (colCardContainers.length > 0) {
      const maxCardBottom = Math.max(
        ...colCardContainers.map(dc => dc.rect.current?.bottom ?? -Infinity)
      );
      if (args.pointerCoordinates.y <= maxCardBottom) {
        const nearestCard = closestCenter({
          ...filteredArgs,
          droppableContainers: colCardContainers,
        });
        if (nearestCard.length > 0) {
          return nearestCard;
        }
      }
    }

    return pointerCollisions;
  }

  return closestCenter(filteredArgs);
};

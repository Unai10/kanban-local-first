import { pointerWithin, closestCenter, type CollisionDetection } from '@dnd-kit/core';

/**
 * Estrategia de colisión optimizada para tableros Kanban:
 * 1. Filtra la tarjeta activa para evitar auto-colisión.
 * 2. Si el puntero cae sobre una tarjeta, la prioriza frente al fondo de la columna.
 * 3. Si cae en un margen o espacio vacío, calcula closestCenter.
 */
export const kanbanCollisionDetection: CollisionDetection = (args) => {
  const droppableContainers = args.droppableContainers.filter(
    container => container.id !== args.active.id
  );

  const filteredArgs = { ...args, droppableContainers };

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

    if (colCardContainers.length > 0 && args.pointerCoordinates) {
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

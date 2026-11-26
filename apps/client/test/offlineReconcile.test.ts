import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  compareCards,
  compareColumns,
  generateFractionalKey,
  type Card,
  type Column,
} from '@kanban/shared-types';
import {
  extractCardsFromMap,
  extractColumnsFromMap,
  extractCommentsFromMap,
  reconcileCardsInDoc,
  reconcileColumnsInDoc,
  reconcileOrphanCardsInDoc,
} from '../src/core/yjs/YjsRoomClient.ts';

function createYCard(doc: Y.Doc, card: Card): void {
  const cardsMap = doc.getMap<Y.Map<unknown> | Card>('cards');
  doc.transact(() => {
    const yCard = new Y.Map<unknown>();
    yCard.set('id', card.id);
    yCard.set('boardId', card.boardId);
    yCard.set('columnId', card.columnId);
    yCard.set('title', card.title);
    yCard.set('description', card.description);
    yCard.set('orderKey', card.orderKey);
    yCard.set('labels', card.labels);
    yCard.set('createdAt', card.createdAt);
    yCard.set('updatedAt', card.updatedAt);
    cardsMap.set(card.id, yCard);
  });
}

test('Offline CRDT Sync - Dos usuarios crean tarjetas offline con la misma orderKey y convergen sin colisiones', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();

  // Estado inicial común antes de desconectarse: 1 tarjeta con orderKey "a0"
  createYCard(docA, {
    id: 'card-base',
    boardId: 'board-1',
    columnId: 'col-todo',
    title: 'Base',
    description: '',
    orderKey: 'a0',
    labels: [],
    createdAt: 1000,
    updatedAt: 1000,
  });
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

  // Ambos usuarios pasan a modo offline y añaden una tarjeta al final de 'col-todo'
  // Ambos generan exactamente orderKey = "a1"
  const keyA = generateFractionalKey('a0', null);
  const keyB = generateFractionalKey('a0', null);
  assert.equal(keyA, 'a1');
  assert.equal(keyB, 'a1');

  createYCard(docA, {
    id: 'card-offline-a',
    boardId: 'board-1',
    columnId: 'col-todo',
    title: 'Offline A',
    description: '',
    orderKey: keyA,
    labels: [],
    createdAt: 2000,
    updatedAt: 2000,
  });

  createYCard(docB, {
    id: 'card-offline-b',
    boardId: 'board-1',
    columnId: 'col-todo',
    title: 'Offline B',
    description: '',
    orderKey: keyB,
    labels: [],
    createdAt: 2001,
    updatedAt: 2001,
  });

  // Ambos se reconectan e intercambian sus estados Yjs
  const updateA = Y.encodeStateAsUpdate(docA);
  const updateB = Y.encodeStateAsUpdate(docB);
  Y.applyUpdate(docA, updateB);
  Y.applyUpdate(docB, updateA);

  // Ambos ejecutan la reconciliación determinista
  const repairedA = reconcileCardsInDoc(docA, docA.getMap('cards'));
  const repairedB = reconcileCardsInDoc(docB, docB.getMap('cards'));
  assert.equal(repairedA, true);
  assert.equal(repairedB, true);

  // Sincronización mutua post-reconciliación: debe ser idempotente (0 reparaciones adicionales)
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  assert.equal(reconcileCardsInDoc(docA, docA.getMap('cards')), false);
  assert.equal(reconcileCardsInDoc(docB, docB.getMap('cards')), false);

  const cardsA = extractCardsFromMap(docA.getMap('cards')).sort(compareCards);
  const cardsB = extractCardsFromMap(docB.getMap('cards')).sort(compareCards);

  assert.equal(cardsA.length, 3);
  assert.deepEqual(
    cardsA.map(c => ({ id: c.id, orderKey: c.orderKey })),
    cardsB.map(c => ({ id: c.id, orderKey: c.orderKey }))
  );

  // Verificar que todas las orderKey son únicas y estrictamente crecientes
  for (let i = 0; i < cardsA.length - 1; i++) {
    assert.ok(
      cardsA[i].orderKey < cardsA[i + 1].orderKey,
      `Las claves deben ser estrictamente crecientes: ${cardsA[i].orderKey} vs ${cardsA[i + 1].orderKey}`
    );
  }
});

test('extractCardsFromMap - Preserva campos enriquecidos y tolera tarjetas antiguas sin ellos', () => {
  const doc = new Y.Doc();
  const cardsMap = doc.getMap<Y.Map<unknown> | Card>('cards');

  // Tarjeta antigua sin campos enriquecidos
  createYCard(doc, {
    id: 'card-legacy',
    boardId: 'board-1',
    columnId: 'col-todo',
    title: 'Legacy',
    description: '',
    orderKey: 'a0',
    labels: [],
    createdAt: 1000,
    updatedAt: 1000,
  });

  // Tarjeta enriquecida
  doc.transact(() => {
    const yRich = new Y.Map<unknown>();
    yRich.set('id', 'card-rich');
    yRich.set('boardId', 'board-1');
    yRich.set('columnId', 'col-todo');
    yRich.set('title', 'Rich Card');
    yRich.set('description', 'Detalles');
    yRich.set('orderKey', 'a1');
    yRich.set('labels', []);
    yRich.set('priority', 'urgent');
    yRich.set('dueDate', 1800000000000);
    yRich.set('storyPoints', 8);
    yRich.set('assignee', { userId: 'u1', name: 'Elena', color: '#3b82f6' });
    yRich.set('checklist', [{ id: 's1', text: 'Paso 1', completed: true }]);
    yRich.set('createdAt', 2000);
    yRich.set('updatedAt', 2500);
    cardsMap.set('card-rich', yRich);
  });

  const extracted = extractCardsFromMap(cardsMap).sort(compareCards);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].priority, null);
  assert.deepEqual(extracted[0].checklist, []);
  assert.equal(extracted[1].priority, 'urgent');
  assert.equal(extracted[1].dueDate, 1800000000000);
  assert.equal(extracted[1].storyPoints, 8);
  assert.deepEqual(extracted[1].assignee, { userId: 'u1', name: 'Elena', color: '#3b82f6' });
  assert.deepEqual(extracted[1].checklist, [{ id: 's1', text: 'Paso 1', completed: true }]);
});

test('extractCardsFromMap - Resuelve nombre actualizado desde membersMap y limpia si abandonó', () => {
  const doc = new Y.Doc();
  const cardsMap = doc.getMap<Y.Map<unknown> | Card>('cards');
  const membersMap = doc.getMap<Y.Map<unknown>>('members');

  doc.transact(() => {
    const cardA = new Y.Map<unknown>();
    cardA.set('id', 'c-a');
    cardA.set('boardId', 'b1');
    cardA.set('columnId', 'col-1');
    cardA.set('title', 'Tarea A');
    cardA.set('description', '');
    cardA.set('orderKey', 'a0');
    cardA.set('labels', []);
    cardA.set('assignee', { userId: 'u-active', name: 'Nombre Viejo', color: '#3b82f6' });
    cardA.set('createdAt', 1000);
    cardA.set('updatedAt', 1000);
    cardsMap.set('c-a', cardA);

    const cardB = new Y.Map<unknown>();
    cardB.set('id', 'c-b');
    cardB.set('boardId', 'b1');
    cardB.set('columnId', 'col-1');
    cardB.set('title', 'Tarea B');
    cardB.set('description', '');
    cardB.set('orderKey', 'a1');
    cardB.set('labels', []);
    cardB.set('assignee', { userId: 'u-left', name: 'Saliente', color: '#ef4444' });
    cardB.set('createdAt', 1000);
    cardB.set('updatedAt', 1000);
    cardsMap.set('c-b', cardB);

    const mActive = new Y.Map<unknown>();
    mActive.set('userId', 'u-active');
    mActive.set('name', 'Nombre Nuevo');
    mActive.set('color', '#10b981');
    mActive.set('updatedAt', 2000);
    membersMap.set('u-active', mActive);

    const mLeft = new Y.Map<unknown>();
    mLeft.set('userId', 'u-left');
    mLeft.set('name', 'Saliente');
    mLeft.set('color', '#ef4444');
    mLeft.set('left', true);
    mLeft.set('leftAt', 2000);
    mLeft.set('updatedAt', 2000);
    membersMap.set('u-left', mLeft);
  });

  const resolved = extractCardsFromMap(cardsMap, membersMap as never).sort(compareCards);
  assert.equal(resolved.length, 2);
  assert.deepEqual(resolved[0].assignee, { userId: 'u-active', name: 'Nombre Nuevo', color: '#10b981' });
  assert.equal(resolved[1].assignee, null);
});

test('reconcileColumnsInDoc y extractColumnsFromMap - Convergencia de columnas y borrado lógico', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();

  docA.transact(() => {
    const col1 = new Y.Map<unknown>();
    col1.set('id', 'col-1');
    col1.set('boardId', 'b1');
    col1.set('title', 'Base');
    col1.set('orderKey', 'a0');
    col1.set('createdAt', 1000);
    docA.getMap('columns').set('col-1', col1);
  });
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

  // Dos admins crean una columna offline al final -> ambos generan orderKey = 'a1'
  docA.transact(() => {
    const colA = new Y.Map<unknown>();
    colA.set('id', 'col-a');
    colA.set('boardId', 'b1');
    colA.set('title', 'Columna A');
    colA.set('orderKey', 'a1');
    colA.set('createdAt', 2000);
    docA.getMap('columns').set('col-a', colA);
  });
  docB.transact(() => {
    const colB = new Y.Map<unknown>();
    colB.set('id', 'col-b');
    colB.set('boardId', 'b1');
    colB.set('title', 'Columna B');
    colB.set('orderKey', 'a1');
    colB.set('createdAt', 2001);
    docB.getMap('columns').set('col-b', colB);
  });

  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

  assert.equal(reconcileColumnsInDoc(docA, docA.getMap('columns') as Y.Map<Y.Map<unknown> | Column>), true);
  assert.equal(reconcileColumnsInDoc(docB, docB.getMap('columns') as Y.Map<Y.Map<unknown> | Column>), true);
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

  const colsA = extractColumnsFromMap(docA.getMap('columns') as Y.Map<Y.Map<unknown> | Column>).sort(compareColumns);
  const colsB = extractColumnsFromMap(docB.getMap('columns') as Y.Map<Y.Map<unknown> | Column>).sort(compareColumns);
  assert.equal(colsA.length, 3);
  assert.deepEqual(colsA.map(c => c.orderKey), colsB.map(c => c.orderKey));
  assert.ok(colsA[1].orderKey < colsA[2].orderKey);

  // Columna marcada deleted: true deja de extraerse
  (docA.getMap('columns').get('col-b') as Y.Map<unknown>).set('deleted', true);
  assert.equal(extractColumnsFromMap(docA.getMap('columns') as Y.Map<Y.Map<unknown> | Column>).length, 2);
});

test('extractCommentsFromMap - Comentarios concurrentes offline convergen y resuelven autor desde membersMap', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();

  docA.transact(() => {
    const c1 = new Y.Map<unknown>();
    c1.set('id', 'cmt-1');
    c1.set('cardId', 'card-1');
    c1.set('authorId', 'u1');
    c1.set('authorName', 'Nombre Antiguo');
    c1.set('authorColor', '#3b82f6');
    c1.set('text', 'Comentario offline A');
    c1.set('createdAt', 1000);
    docA.getMap('comments').set('cmt-1', c1);

    const m1 = new Y.Map<unknown>();
    m1.set('userId', 'u1');
    m1.set('name', 'Nombre Actualizado');
    m1.set('color', '#10b981');
    m1.set('updatedAt', 2000);
    docA.getMap('members').set('u1', m1);
  });

  docB.transact(() => {
    const c2 = new Y.Map<unknown>();
    c2.set('id', 'cmt-2');
    c2.set('cardId', 'card-1');
    c2.set('authorId', 'u2');
    c2.set('authorName', 'Eva');
    c2.set('authorColor', '#f59e0b');
    c2.set('text', 'Comentario offline B');
    c2.set('createdAt', 1500);
    docB.getMap('comments').set('cmt-2', c2);
  });

  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
  const comments = extractCommentsFromMap(
    docA.getMap('comments') as never,
    docA.getMap('members') as never
  );
  assert.equal(comments.length, 2);
  assert.equal(comments[0].authorName, 'Nombre Actualizado');
  assert.equal(comments[0].authorColor, '#10b981');
  assert.equal(comments[1].text, 'Comentario offline B');
});

test('reconcileOrphanCardsInDoc - Reubica tarjetas offline que apuntan a columnas eliminadas concurrentemente', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();

  // Estado inicial compartido: 3 columnas (col-1, col-2, col-3) y 1 tarjeta en col-1
  docA.transact(() => {
    const c1 = new Y.Map<unknown>();
    c1.set('id', 'col-1');
    c1.set('boardId', 'b1');
    c1.set('title', 'Por Hacer');
    c1.set('orderKey', 'a0');
    c1.set('createdAt', 1000);
    docA.getMap('columns').set('col-1', c1);

    const c2 = new Y.Map<unknown>();
    c2.set('id', 'col-2');
    c2.set('boardId', 'b1');
    c2.set('title', 'En Progreso');
    c2.set('orderKey', 'a1');
    c2.set('createdAt', 1000);
    docA.getMap('columns').set('col-2', c2);

    const c3 = new Y.Map<unknown>();
    c3.set('id', 'col-3');
    c3.set('boardId', 'b1');
    c3.set('title', 'Terminado');
    c3.set('orderKey', 'a2');
    c3.set('createdAt', 1000);
    docA.getMap('columns').set('col-3', c3);
  });
  createYCard(docA, {
    id: 'card-moving',
    boardId: 'b1',
    columnId: 'col-1',
    title: 'Tarjeta movida offline',
    description: '',
    orderKey: 'a0',
    labels: [],
    createdAt: 1000,
    updatedAt: 1000,
  });
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

  // Usuario A (offline) arrastra card-moving hacia col-2 y crea una tarjeta nueva en col-2
  docA.transact(() => {
    (docA.getMap('cards').get('card-moving') as Y.Map<unknown>).set('columnId', 'col-2');
  });
  createYCard(docA, {
    id: 'card-new-offline',
    boardId: 'b1',
    columnId: 'col-2',
    title: 'Nueva en col-2',
    description: '',
    orderKey: 'a1',
    labels: [],
    createdAt: 2000,
    updatedAt: 2000,
  });

  // Admin B (offline) elimina col-2 reubicando sus tarjetas hacia col-3
  docB.transact(() => {
    const col2 = docB.getMap('columns').get('col-2') as Y.Map<unknown>;
    col2.set('deleted', true);
    col2.set('deletedAt', 2500);
    col2.set('deletedTargetColumnId', 'col-3');
  });

  // Al reconectar ambos convergen
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

  assert.equal(
    reconcileOrphanCardsInDoc(docA, docA.getMap('cards') as never, docA.getMap('columns') as never),
    true
  );
  assert.equal(
    reconcileOrphanCardsInDoc(docB, docB.getMap('cards') as never, docB.getMap('columns') as never),
    true
  );
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

  // Ambos docs convergen exactamente en col-3 y sin tarjetas huérfanas
  const cardsA = extractCardsFromMap(docA.getMap('cards') as never).sort(compareCards);
  const cardsB = extractCardsFromMap(docB.getMap('cards') as never).sort(compareCards);
  assert.equal(cardsA.length, 2);
  assert.deepEqual(
    cardsA.map(c => ({ id: c.id, columnId: c.columnId, orderKey: c.orderKey })),
    cardsB.map(c => ({ id: c.id, columnId: c.columnId, orderKey: c.orderKey }))
  );
  assert.equal(cardsA.every(c => c.columnId === 'col-3'), true);
  assert.notEqual(cardsA[0].orderKey, cardsA[1].orderKey);
});

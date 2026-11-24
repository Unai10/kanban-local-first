import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { compareCards, generateFractionalKey, type Card } from '@kanban/shared-types';
import { extractCardsFromMap, reconcileCardsInDoc } from '../src/core/yjs/YjsRoomClient.ts';

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

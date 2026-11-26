import test from 'node:test';
import assert from 'node:assert/strict';
import type { Card, Column } from '@kanban/shared-types';
import { filterCards, INITIAL_BOARD_FILTERS } from '../src/features/kanban/hooks/useBoardFilters.ts';
import { computeBoardMetrics } from '../src/components/Modals/BoardMetricsModal.tsx';
import { boardSnapshotToMarkdown } from '../src/core/utils/boardExport.ts';

const NOW = new Date(2026, 10, 26, 12, 0, 0).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

const SAMPLE_COLUMNS: Column[] = [
  { id: 'col-1', boardId: 'b1', title: 'Por Hacer', orderKey: 'a0', createdAt: 1000 },
  { id: 'col-2', boardId: 'b1', title: 'Terminado', orderKey: 'a1', createdAt: 1000 },
];

const SAMPLE_CARDS: Card[] = [
  {
    id: 'c1',
    boardId: 'b1',
    columnId: 'col-1',
    title: 'Corregir login',
    description: 'Revisar tokens',
    orderKey: 'a0',
    labels: [{ id: 'l1', name: 'Bug', color: '#ef4444' }],
    priority: 'urgent',
    dueDate: NOW - 2 * DAY_MS,
    assignee: { userId: 'u1', name: 'Ana', color: '#3b82f6' },
    checklist: [
      { id: 's1', text: 'Reproducir', completed: true },
      { id: 's2', text: 'Parchear', completed: false },
    ],
    storyPoints: 5,
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: 'c2',
    boardId: 'b1',
    columnId: 'col-2',
    title: 'Documentar API',
    description: 'Añadir ejemplos',
    orderKey: 'a0',
    labels: [{ id: 'l2', name: 'Docs', color: '#10b981' }],
    priority: 'low',
    dueDate: NOW + DAY_MS,
    assignee: null,
    checklist: [{ id: 's3', text: 'Publicar', completed: true }],
    storyPoints: 3,
    createdAt: 1000,
    updatedAt: 1000,
  },
];

test('filterCards - Filtra por texto, mis tarjetas, prioridad, etiqueta y vencimiento', () => {
  assert.equal(filterCards(SAMPLE_CARDS, INITIAL_BOARD_FILTERS, 'u1', NOW).length, 2);
  assert.equal(filterCards(SAMPLE_CARDS, { ...INITIAL_BOARD_FILTERS, query: 'tokens' }, 'u1', NOW).length, 1);
  assert.equal(filterCards(SAMPLE_CARDS, { ...INITIAL_BOARD_FILTERS, onlyMine: true }, 'u1', NOW).length, 1);
  assert.equal(filterCards(SAMPLE_CARDS, { ...INITIAL_BOARD_FILTERS, assigneeName: '__unassigned__' }, 'u1', NOW)[0].id, 'c2');
  assert.equal(filterCards(SAMPLE_CARDS, { ...INITIAL_BOARD_FILTERS, priority: 'urgent' }, 'u1', NOW)[0].id, 'c1');
  assert.equal(filterCards(SAMPLE_CARDS, { ...INITIAL_BOARD_FILTERS, labelName: 'Docs' }, 'u1', NOW)[0].id, 'c2');
  assert.equal(filterCards(SAMPLE_CARDS, { ...INITIAL_BOARD_FILTERS, dueFilter: 'overdue' }, 'u1', NOW)[0].id, 'c1');
  assert.equal(filterCards(SAMPLE_CARDS, { ...INITIAL_BOARD_FILTERS, dueFilter: 'upcoming' }, 'u1', NOW)[0].id, 'c2');
});

test('computeBoardMetrics - Calcula puntos, vencimientos, checklists y carga por responsable', () => {
  const metrics = computeBoardMetrics(SAMPLE_COLUMNS, SAMPLE_CARDS, NOW);
  assert.equal(metrics.totalCards, 2);
  assert.equal(metrics.totalPoints, 8);
  assert.equal(metrics.overdueCount, 1);
  assert.equal(metrics.upcomingCount, 1);
  assert.equal(metrics.checklistTotal, 3);
  assert.equal(metrics.checklistDone, 2);
  assert.equal(metrics.byColumn[0].points, 5);
  assert.equal(metrics.byColumn[1].points, 3);
  assert.equal(metrics.byPriority.urgent, 1);
});

test('boardSnapshotToMarkdown - Genera Markdown legible con checklists y comentarios', () => {
  const md = boardSnapshotToMarkdown({
    version: 1,
    exportedAt: NOW,
    title: 'Mi Proyecto',
    columns: [{ id: 'col-1', title: 'Por Hacer', orderKey: 'a0', createdAt: NOW }],
    cards: [
      {
        id: 'c1',
        columnId: 'col-1',
        title: 'Tarea Markdown',
        description: 'Detalle **importante**',
        orderKey: 'a0',
        labels: [],
        checklist: [{ id: 's1', text: 'Paso 1', completed: true }],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    comments: [
      {
        id: 'cm-1',
        cardId: 'c1',
        authorId: 'u1',
        authorName: 'Ana',
        authorColor: '#3b82f6',
        text: 'Listo para revisar',
        createdAt: NOW,
      },
    ],
  });

  assert.match(md, /# Mi Proyecto/);
  assert.match(md, /## Por Hacer \(1\)/);
  assert.match(md, /- \[x\] Paso 1/);
  assert.match(md, /\*\*Ana\*\*: Listo para revisar/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOrderKey,
  isValidOrderKey,
  sanitizeSingleLineText,
  sanitizeMultilineText,
  sanitizeHexColor,
  validateLabel,
  validateCursor,
  sanitizePriority,
  sanitizeDueDate,
  sanitizeStoryPoints,
  sanitizeChecklist,
  sanitizeAssignee,
  sanitizeBoardMember,
  sanitizeBoardRole,
  sanitizeActivity,
  sanitizeCardComment,
  validateBoardExportSnapshot,
  BOARD_TEMPLATES,
  computeOrderKeyRepairs,
  computeFlatOrderKeyRepairs,
  compareCards,
} from '../dist/index.js';

test('validateOrderKey - Rechaza caracteres fuera de Base62 y strings vacíos', () => {
  assert.throws(() => validateOrderKey(''), /fuera de rango/);
  assert.throws(() => validateOrderKey('a'), /fuera de rango/);
  assert.throws(() => validateOrderKey('a!'), /fuera de alfabeto/);
  assert.throws(() => validateOrderKey('a0 '), /fuera de alfabeto/);
  assert.equal(isValidOrderKey('a0'), true);
  assert.equal(isValidOrderKey('Zz'), true);
  assert.equal(isValidOrderKey('a0V'), true);
  assert.equal(isValidOrderKey('a!'), false);
});

test('Sanitización de texto y colores hexadecimales', () => {
  assert.equal(sanitizeSingleLineText('  Hola\u0000\nMundo  ', 20), 'HolaMundo');
  assert.equal(sanitizeSingleLineText('   ', 20, 'Fallback'), 'Fallback');
  assert.equal(sanitizeMultilineText('Linea 1\nLinea 2\u0007', 50), 'Linea 1\nLinea 2');

  assert.equal(sanitizeHexColor('#3b82f6'), '#3b82f6');
  assert.equal(sanitizeHexColor('red; background: url(evil)', '#000000'), '#000000');
  assert.equal(sanitizeHexColor('#123', '#000000'), '#000000');
});

test('Validadores de Label y Cursor', () => {
  assert.equal(validateLabel({ id: 'l1', name: 'Bug', color: '#ef4444' }), true);
  assert.equal(validateLabel({ id: 'l1', name: 'Bug', color: 'red' }), false);

  assert.equal(validateCursor({ x: 100, y: 200 }), true);
  assert.equal(validateCursor({ x: Number.NaN, y: 200 }), false);
  assert.equal(validateCursor({ x: 9999999, y: 0 }), false);
});

test('computeOrderKeyRepairs - Reconcilia colisiones offline de forma determinista', () => {
  // Sin colisiones -> 0 reparaciones
  assert.deepEqual(
    computeOrderKeyRepairs([
      { id: 'c1', columnId: 'col-1', orderKey: 'a0' },
      { id: 'c2', columnId: 'col-1', orderKey: 'a1' },
    ]),
    []
  );

  // Dos tarjetas creadas offline al final de la columna con la misma key "a1"
  const endCollision = [
    { id: 'c1', columnId: 'col-1', orderKey: 'a0' },
    { id: 'c3-uuid', columnId: 'col-1', orderKey: 'a1' },
    { id: 'c2-uuid', columnId: 'col-1', orderKey: 'a1' },
  ];
  const repairsEnd = computeOrderKeyRepairs(endCollision);
  assert.equal(repairsEnd.length, 1);
  assert.equal(repairsEnd[0].id, 'c3-uuid', 'La tarjeta con menor ID conserva "a1" y la otra recibe nueva clave');
  assert.ok(repairsEnd[0].orderKey > 'a1');

  // Colisión en medio de columna (entre "a0" y "a1") con 3 tarjetas compartiendo "a0"
  const midCollision = [
    { id: 'id-b', columnId: 'col-1', orderKey: 'a0' },
    { id: 'id-a', columnId: 'col-1', orderKey: 'a0' },
    { id: 'id-c', columnId: 'col-1', orderKey: 'a0' },
    { id: 'id-d', columnId: 'col-1', orderKey: 'a1' },
  ];
  const repairsMid = computeOrderKeyRepairs(midCollision);
  assert.equal(repairsMid.length, 2);

  const repairedMap = new Map(repairsMid.map(r => [r.id, r.orderKey]));
  const updated = midCollision
    .map(c => ({ ...c, orderKey: repairedMap.get(c.id) ?? c.orderKey }))
    .sort(compareCards);

  for (let i = 0; i < updated.length - 1; i++) {
    assert.ok(updated[i].orderKey < updated[i + 1].orderKey, 'Todas las claves deben quedar estrictamente crecientes');
  }
  assert.deepEqual(computeOrderKeyRepairs(updated), [], 'Segunda pasada debe ser idempotente (0 reparaciones)');
});

test('Sanitizadores de campos enriquecidos de Card', () => {
  assert.equal(sanitizePriority('high'), 'high');
  assert.equal(sanitizePriority('invalid'), null);

  assert.equal(sanitizeDueDate(1700000000000), 1700000000000);
  assert.equal(sanitizeDueDate(-10), null);
  assert.equal(sanitizeDueDate('2026-01-01'), null);

  assert.equal(sanitizeStoryPoints(5), 5);
  assert.equal(sanitizeStoryPoints(150), null);
  assert.equal(sanitizeStoryPoints(0), null);

  const checklist = sanitizeChecklist([
    { id: 'c1', text: '  Revisar PR  ', completed: true },
    { id: '', text: 'Sin id', completed: false },
    { id: 'c2', text: '   ', completed: false },
    { id: 'c3', text: 'Escribir tests', completed: false },
  ]);
  assert.deepEqual(checklist, [
    { id: 'c1', text: 'Revisar PR', completed: true },
    { id: 'c3', text: 'Escribir tests', completed: false },
  ]);

  assert.deepEqual(
    sanitizeAssignee({ userId: 'u1', name: '  Carlos  ', color: '#10b981' }),
    { userId: 'u1', name: 'Carlos', color: '#10b981' }
  );
  assert.deepEqual(
    sanitizeAssignee({ name: 'Externo', color: 'bad-color' }),
    { name: 'Externo' }
  );
  assert.equal(sanitizeAssignee({ name: '   ' }), null);

  assert.deepEqual(
    sanitizeBoardMember({ name: '  Marta  ', color: '#ec4899', role: 'admin', updatedAt: 1234 }, 'usr-marta'),
    { userId: 'usr-marta', name: 'Marta', color: '#ec4899', role: 'admin', updatedAt: 1234 }
  );
  assert.equal(sanitizeBoardMember({ name: 'Sin id' }, ''), null);
  assert.equal(sanitizeBoardRole('admin'), 'admin');
  assert.equal(sanitizeBoardRole('superadmin', 'member'), 'member');
});

test('computeFlatOrderKeyRepairs - Reconcilia colisiones de columnas', () => {
  const repairs = computeFlatOrderKeyRepairs([
    { id: 'col-b', orderKey: 'a0' },
    { id: 'col-a', orderKey: 'a0' },
    { id: 'col-c', orderKey: 'a1' },
  ]);
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].id, 'col-b');
  assert.ok(repairs[0].orderKey > 'a0' && repairs[0].orderKey < 'a1');
});

test('sanitizeCardComment y validateBoardExportSnapshot', () => {
  assert.equal(sanitizeCardComment({ id: 'cm-1', cardId: 'c1', authorId: 'u1', text: '   ' }), null);
  const comment = sanitizeCardComment({
    id: 'cm-1',
    cardId: 'c1',
    authorId: 'u1',
    authorName: '  Alex  ',
    authorColor: 'bad',
    text: 'Hola **mundo**\u0000',
    createdAt: 1000,
  });
  assert.deepEqual(comment, {
    id: 'cm-1',
    cardId: 'c1',
    authorId: 'u1',
    authorName: 'Alex',
    authorColor: '#6366f1',
    text: 'Hola **mundo**',
    createdAt: 1000,
  });

  const snapshot = validateBoardExportSnapshot({
    version: 1,
    exportedAt: 1000,
    title: '  Sprint 1  ',
    columns: [{ id: 'col-1', title: 'Por Hacer', orderKey: 'a0', color: '#3b82f6', createdAt: 1000 }],
    cards: [{ id: 'card-1', columnId: 'col-missing', title: 'Tarea 1', description: 'Desc', orderKey: 'a0', labels: [] }],
    comments: [{ id: 'cm-1', cardId: 'card-1', authorId: 'u1', authorName: 'Alex', authorColor: '#3b82f6', text: 'Ok', createdAt: 1001 }],
  });
  assert.ok(snapshot);
  assert.equal(snapshot.title, 'Sprint 1');
  assert.equal(snapshot.cards[0].columnId, 'col-1');
  assert.equal(snapshot.comments.length, 1);
  assert.equal(validateBoardExportSnapshot({ version: 2, columns: [], cards: [] }), null);
});

test('sanitizeActivity acepta dragging-column y BOARD_TEMPLATES no fuerza color inicial', () => {
  assert.deepEqual(
    sanitizeActivity({ action: 'dragging-column', columnId: 'col-1' }),
    { action: 'dragging-column', columnId: 'col-1' }
  );
  assert.equal(sanitizeActivity({ action: 'unknown-action' }), null);

  for (const tpl of BOARD_TEMPLATES) {
    for (const col of tpl.columns) {
      assert.equal(col.color, undefined, `Columna ${col.title} de ${tpl.id} no debe tener color por defecto`);
    }
  }
});

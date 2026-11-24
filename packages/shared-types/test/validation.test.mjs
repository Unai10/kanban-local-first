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
  computeOrderKeyRepairs,
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
    sanitizeBoardMember({ name: '  Marta  ', color: '#ec4899', updatedAt: 1234 }, 'usr-marta'),
    { userId: 'usr-marta', name: 'Marta', color: '#ec4899', updatedAt: 1234 }
  );
  assert.equal(sanitizeBoardMember({ name: 'Sin id' }, ''), null);
});

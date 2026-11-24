import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateFractionalKey,
  generateKeyBetween,
  generateNKeysBetween,
  validateOrderKey,
} from '../dist/index.js';

test('Fractional Indexing - Caso lista vacía', () => {
  const key = generateFractionalKey(null, null);
  assert.strictEqual(key, 'a0');
  const aliasKey = generateKeyBetween(null, null);
  assert.strictEqual(aliasKey, 'a0');
});

test('Fractional Indexing - Inserción al final consecutiva (50 elementos)', () => {
  const keys = ['a0'];
  for (let i = 0; i < 50; i++) {
    const lastKey = keys[keys.length - 1];
    const newKey = generateFractionalKey(lastKey, null);
    keys.push(newKey);
  }

  // Verificar que la lista esté estrictamente ordenada de forma creciente
  for (let i = 0; i < keys.length - 1; i++) {
    assert.ok(
      keys[i] < keys[i + 1],
      `Error de orden: ${keys[i]} no es menor que ${keys[i + 1]}`
    );
  }
  assert.strictEqual(keys.length, 51);
});

test('Fractional Indexing - Inserción al inicio consecutiva (50 elementos sin desordenar)', () => {
  const keys = ['a0'];
  for (let i = 0; i < 50; i++) {
    const firstKey = keys[0];
    const newKey = generateFractionalKey(null, firstKey);
    keys.unshift(newKey);
  }

  // Verificar que la lista esté estrictamente ordenada de forma creciente
  for (let i = 0; i < keys.length - 1; i++) {
    assert.ok(
      keys[i] < keys[i + 1],
      `Error de orden al inicio: ${keys[i]} no es menor que ${keys[i + 1]}`
    );
  }
  assert.strictEqual(keys.length, 51);
});

test('Fractional Indexing - Inserciones intermedias continuas (50 midpoints sin colisión)', () => {
  const left = 'a0';
  const right = 'a1';
  let currentLeft = left;
  const mids = [];

  for (let i = 0; i < 50; i++) {
    const mid = generateFractionalKey(currentLeft, right);
    assert.ok(currentLeft < mid, `mid (${mid}) debe ser mayor que currentLeft (${currentLeft})`);
    assert.ok(mid < right, `mid (${mid}) debe ser menor que right (${right})`);
    mids.push(mid);
    currentLeft = mid; // insertar repetidamente entre el nuevo punto medio y el límite derecho
  }

  // Verificar que todos los midpoints sean únicos y crecientes
  for (let i = 0; i < mids.length - 1; i++) {
    assert.ok(mids[i] < mids[i + 1], `Colisión o desorden: ${mids[i]} vs ${mids[i + 1]}`);
  }
});

test('Fractional Indexing - Caso crítico que fallaba en la versión previa (entre a0V y a1)', () => {
  const mid1 = generateFractionalKey('a0', 'a1'); // "a0V"
  assert.strictEqual(mid1, 'a0V');

  // En la versión antigua, esto devolvía "a0V" duplicado
  const mid2 = generateFractionalKey(mid1, 'a1');
  assert.ok(mid1 < mid2, `mid2 (${mid2}) debe ser mayor que mid1 (${mid1})`);
  assert.ok(mid2 < 'a1', `mid2 (${mid2}) debe ser menor que a1`);
});

test('Fractional Indexing - Inserción por lotes con generateNKeysBetween', () => {
  const batchInitial = generateNKeysBetween(null, null, 5);
  assert.strictEqual(batchInitial.length, 5);
  assert.deepStrictEqual(batchInitial, ['a0', 'a1', 'a2', 'a3', 'a4']);

  const batchMid = generateNKeysBetween('a0', 'a1', 5);
  assert.strictEqual(batchMid.length, 5);
  for (let i = 0; i < batchMid.length; i++) {
    assert.ok(batchMid[i] > 'a0');
    assert.ok(batchMid[i] < 'a1');
    if (i > 0) {
      assert.ok(batchMid[i - 1] < batchMid[i]);
    }
  }
});

test('Fractional Indexing - Validaciones de error', () => {
  assert.throws(() => {
    generateFractionalKey('a1', 'a0');
  }, /debe ser estrictamente menor/);

  assert.throws(() => {
    generateFractionalKey('a0', 'a0');
  }, /debe ser estrictamente menor/);

  assert.throws(() => {
    validateOrderKey('a00'); // trailing zero en la parte fraccionaria
  }, /termina en cero/);
});

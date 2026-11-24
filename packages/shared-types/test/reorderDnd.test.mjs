import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateFractionalKey,
  generateNKeysBetween,
  compareOrderKeys,
  compareCards,
} from '../dist/index.js';

// Implementación de arrayMove idéntica a @dnd-kit/sortable
function arrayMove(array, from, to) {
  const newArray = array.slice();
  newArray.splice(to < 0 ? newArray.length + to : to, 0, newArray.splice(from, 1)[0]);
  return newArray;
}

test('DnD Engine - Comparación crítica: compareOrderKeys vs localeCompare', () => {
  // En Base62 de Fractional Indexing, las claves que cruzan el límite inferior de 'a0' empiezan por 'Z'.
  const keyA0 = 'a0';
  const keyBeforeA0 = generateFractionalKey(null, keyA0); // 'Zz'

  // 1. En orden numérico/ASCII canónico, 'Zz' DEBE ser menor que 'a0'
  assert.strictEqual(
    compareOrderKeys(keyBeforeA0, keyA0),
    -1,
    `compareOrderKeys debe indicar que "${keyBeforeA0}" es menor que "${keyA0}"`
  );

  // 2. Demostración del bug de localeCompare: localeCompare considera 'Zz' > 'a0'
  const localeCompareResult = keyBeforeA0.localeCompare(keyA0);
  assert.ok(
    localeCompareResult > 0,
    'localeCompare erróneamente coloca Zz después de a0'
  );

  // 3. Demostración en ordenación de arrays:
  const array = [{ id: '1', orderKey: keyA0 }, { id: '2', orderKey: keyBeforeA0 }];
  
  // Ordenar con localeCompare corrompe el orden:
  const localeSorted = [...array].sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  assert.strictEqual(localeSorted[0].orderKey, keyA0); // 'a0' queda primero erróneamente

  // Ordenar con compareCards restaura el orden canónico:
  const correctlySorted = [...array].sort(compareCards);
  assert.strictEqual(correctlySorted[0].orderKey, keyBeforeA0); // 'Zz' queda primero correctamente
});

test('DnD Engine - Simulación de arrastre continuo hacia arriba (50 iteraciones)', () => {
  let cards = [
    { id: 'card-1', orderKey: 'a0' },
    { id: 'card-2', orderKey: 'a1' },
    { id: 'card-3', orderKey: 'a2' },
  ];

  for (let iteration = 0; iteration < 50; iteration++) {
    // Tomamos la última tarjeta y la arrastramos a la primera posición
    const lastCard = cards[cards.length - 1];
    const prevFirstCard = cards[0];

    const newKey = generateFractionalKey(null, prevFirstCard.orderKey);
    const movedCard = { ...lastCard, orderKey: newKey };

    cards = [movedCard, ...cards.slice(0, cards.length - 1)];

    // Verificar que todas las claves son estrictamente crecientes
    for (let i = 0; i < cards.length - 1; i++) {
      assert.strictEqual(
        compareOrderKeys(cards[i].orderKey, cards[i + 1].orderKey),
        -1,
        `Iteración ${iteration}: orden roto entre ${cards[i].orderKey} y ${cards[i + 1].orderKey}`
      );
    }

    // Verificar que re-ordenar con compareCards produce exactamente la misma lista
    const sorted = [...cards].sort(compareCards);
    assert.deepStrictEqual(sorted.map(c => c.id), cards.map(c => c.id));
  }
});

test('DnD Engine - Simulación de arrastre continuo hacia abajo (50 iteraciones)', () => {
  let cards = [
    { id: 'card-1', orderKey: 'a0' },
    { id: 'card-2', orderKey: 'a1' },
    { id: 'card-3', orderKey: 'a2' },
  ];

  for (let iteration = 0; iteration < 50; iteration++) {
    // Tomamos la primera tarjeta y la arrastramos al final
    const firstCard = cards[0];
    const lastCard = cards[cards.length - 1];

    const newKey = generateFractionalKey(lastCard.orderKey, null);
    const movedCard = { ...firstCard, orderKey: newKey };

    cards = [...cards.slice(1), movedCard];

    // Verificar orden estrictamente creciente
    for (let i = 0; i < cards.length - 1; i++) {
      assert.strictEqual(
        compareOrderKeys(cards[i].orderKey, cards[i + 1].orderKey),
        -1,
        `Iteración ${iteration}: orden roto entre ${cards[i].orderKey} y ${cards[i + 1].orderKey}`
      );
    }

    // Verificar que re-ordenar con compareCards produce exactamente la misma lista
    const sorted = [...cards].sort(compareCards);
    assert.deepStrictEqual(sorted.map(c => c.id), cards.map(c => c.id));
  }
});

test('DnD Engine - Intercambio Ping-Pong de 2 tarjetas (50 swaps consecutivos)', () => {
  let cards = [
    { id: 'card-A', orderKey: 'a0' },
    { id: 'card-B', orderKey: 'a1' },
  ];

  for (let iteration = 0; iteration < 50; iteration++) {
    const activeIndex = 1; // mover la segunda a la primera
    const overIndex = 0;
    const active = cards[activeIndex];

    const reordered = arrayMove(cards, activeIndex, overIndex);
    const finalIndex = 0;

    const prevKey = finalIndex > 0 ? reordered[finalIndex - 1].orderKey : null;
    const nextKey = finalIndex < reordered.length - 1 ? reordered[finalIndex + 1].orderKey : null;

    const newKey = generateFractionalKey(prevKey, nextKey);
    reordered[finalIndex] = { ...active, orderKey: newKey };

    cards = reordered;

    // Verificar que el orden visual es estrictamente [card-B, card-A] o [card-A, card-B]
    const expectedFirst = iteration % 2 === 0 ? 'card-B' : 'card-A';
    assert.strictEqual(cards[0].id, expectedFirst, `Error en iteración ${iteration}: se esperaba primero ${expectedFirst}`);

    // Verificar que al ordenar con compareCards se mantiene exactamente igual
    const sorted = [...cards].sort(compareCards);
    assert.deepStrictEqual(sorted.map(c => c.id), cards.map(c => c.id));
  }
});

test('DnD Engine - Simulación de permutaciones aleatorias en columna de 6 tarjetas (100 operaciones)', () => {
  const initialKeys = generateNKeysBetween(null, null, 6);
  let cards = initialKeys.map((key, i) => ({
    id: `card-${i}`,
    orderKey: key,
  }));

  for (let step = 0; step < 100; step++) {
    // Elegir origen y destino aleatorio
    const fromIndex = Math.floor(Math.random() * cards.length);
    let toIndex = Math.floor(Math.random() * cards.length);
    while (toIndex === fromIndex) {
      toIndex = Math.floor(Math.random() * cards.length);
    }

    const activeCard = cards[fromIndex];
    const reordered = arrayMove(cards, fromIndex, toIndex);
    const finalIndex = toIndex;

    const prevKey = finalIndex > 0 ? reordered[finalIndex - 1].orderKey : null;
    const nextKey = finalIndex < reordered.length - 1 ? reordered[finalIndex + 1].orderKey : null;

    // Asegurarse de que prevKey < nextKey antes de llamar al algoritmo
    if (prevKey && nextKey) {
      assert.ok(
        compareOrderKeys(prevKey, nextKey) < 0,
        `Invariante rota en paso ${step}: prevKey ("${prevKey}") no es menor que nextKey ("${nextKey}")`
      );
    }

    const newKey = generateFractionalKey(prevKey, nextKey);
    reordered[finalIndex] = { ...activeCard, orderKey: newKey };

    cards = reordered;

    // Comprobar que ordenar con compareCards devuelve exactamente el orden esperado del arrayMove
    const sorted = [...cards].sort(compareCards);
    assert.deepStrictEqual(
      sorted.map(c => c.id),
      cards.map(c => c.id),
      `Paso ${step}: Desincronización entre orden visual de arrayMove y compareCards`
    );
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESKTOP_FINE_POINTER_QUERY,
  isDesktopFinePointer,
  shouldBroadcastPointerMove,
} from '../src/features/presence/utils/pointerAwareness.ts';

test('shouldBroadcastPointerMove - Bloquea entrada táctil/pen y viewports móviles', () => {
  assert.equal(shouldBroadcastPointerMove('touch', true), false);
  assert.equal(shouldBroadcastPointerMove('pen', true), false);
  assert.equal(shouldBroadcastPointerMove('', true), false);
  assert.equal(shouldBroadcastPointerMove('mouse', false), false);
  assert.equal(shouldBroadcastPointerMove('touch', false), false);

  assert.equal(shouldBroadcastPointerMove('mouse', true), true);
});

test('isDesktopFinePointer - Evalúa de forma segura matchMedia para escritorio vs móvil', () => {
  const prevWindow = globalThis.window;

  try {
    // Sin window (entorno Node/SSR) debe devolver false
    // @ts-expect-error simulación de entorno sin window
    delete globalThis.window;
    assert.equal(isDesktopFinePointer(), false);

    // Simular móvil (pointer coarse / viewport < 768px)
    globalThis.window = {
      matchMedia: (query: string) => ({
        matches: false,
        media: query,
      }),
    } as unknown as Window & typeof globalThis;
    assert.equal(isDesktopFinePointer(), false);

    // Simular escritorio con ratón y viewport >= 768px
    globalThis.window = {
      matchMedia: (query: string) => ({
        matches: query === DESKTOP_FINE_POINTER_QUERY,
        media: query,
      }),
    } as unknown as Window & typeof globalThis;
    assert.equal(isDesktopFinePointer(), true);
  } finally {
    if (prevWindow === undefined) {
      // @ts-expect-error restaurar ausencia de window
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});

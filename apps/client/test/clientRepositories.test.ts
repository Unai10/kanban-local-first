import test from 'node:test';
import assert from 'node:assert/strict';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    clear: () => store.clear(),
  };
}

function setupBrowserGlobals(initialHref = 'http://localhost:5173/') {
  const url = new URL(initialHref);
  const historyCalls = [];
  globalThis.localStorage = createMemoryStorage();
  globalThis.window = {
    location: {
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      protocol: url.protocol,
      hostname: url.hostname,
    },
    history: {
      replaceState: (_state, _title, newUrl) => {
        historyCalls.push({ method: 'replaceState', newUrl });
        const updated = new URL(newUrl, url.origin);
        globalThis.window.location.pathname = updated.pathname;
        globalThis.window.location.search = updated.search;
        globalThis.window.location.hash = updated.hash;
      },
      pushState: (_state, _title, newUrl) => {
        historyCalls.push({ method: 'pushState', newUrl });
        const updated = new URL(newUrl, url.origin);
        globalThis.window.location.pathname = updated.pathname;
        globalThis.window.location.search = updated.search;
        globalThis.window.location.hash = updated.hash;
      },
    },
  };
  return historyCalls;
}

test('LocalUserRepository - Ignora overrides inseguros por URL y sanitiza perfil', async () => {
  setupBrowserGlobals('http://localhost:5173/?userId=usr-admin&userName=Hacker&userColor=red');
  const { LocalUserRepository } = await import('../src/core/storage/localUserRepository.ts');

  const profile = LocalUserRepository.getUserProfile();
  assert.notEqual(profile.id, 'usr-admin');
  assert.notEqual(profile.name, 'Hacker');
  assert.match(profile.color, /^#[0-9a-fA-F]{6}$/);

  const saved = LocalUserRepository.saveUserProfile({
    id: profile.id,
    name: '  Elena\u0000 Dev  ',
    color: 'not-a-color',
  });
  assert.equal(saved.name, 'Elena Dev');
  assert.match(saved.color, /^#[0-9a-fA-F]{6}$/);
});

test('LocalBoardRepository - Lee enlace con fragmento # y limpia token de la barra URL', async () => {
  const historyCalls = setupBrowserGlobals(
    'http://localhost:5173/#board=sprint-2026&token=sec-0123456789abcdef0123456789abcdef&ownerId=usr-owner&ownerName=Luis'
  );
  const { LocalBoardRepository } = await import('../src/core/storage/localBoardRepository.ts');

  const resolved = LocalBoardRepository.resolveInitialBoard();
  assert.equal(resolved.boardId, 'sprint-2026');
  assert.equal(resolved.inviteToken, 'sec-0123456789abcdef0123456789abcdef');
  assert.equal(resolved.role, 'member');
  assert.equal(resolved.ownerToken, undefined);

  // Verificar que el token fue eliminado de la barra de direcciones
  assert.equal(globalThis.window.location.hash, '');
  assert.equal(globalThis.window.location.search, '?board=sprint-2026');
  assert.ok(historyCalls.some(c => c.method === 'replaceState' && c.newUrl === '/?board=sprint-2026'));
});

test('LocalBoardRepository - Rastrea cambios de título y dueño en tableros no activos y los limpia al entrar', async () => {
  setupBrowserGlobals('http://localhost:5173/');
  const { LocalBoardRepository } = await import('../src/core/storage/localBoardRepository.ts');

  LocalBoardRepository.saveRegisteredBoard({
    id: 'board-active',
    title: 'Tablero Activo',
    role: 'owner',
    ownerId: 'usr-1',
    ownerName: 'Yo',
    inviteToken: 'sec-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ownerToken: 'sec-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    lastOpenedAt: Date.now(),
  });

  LocalBoardRepository.saveRegisteredBoard({
    id: 'board-other',
    title: 'Sprint Q1',
    role: 'member',
    ownerId: 'usr-2',
    ownerName: 'Ana',
    inviteToken: 'sec-cccccccccccccccccccccccccccccccc',
    lastOpenedAt: Date.now(),
  });

  // Primer cambio remoto mientras el usuario está en 'board-active'
  LocalBoardRepository.applyRemoteBoardMetadata(
    [
      {
        boardId: 'board-other',
        title: 'Sprint Q2',
        ownerId: 'usr-2',
        ownerName: 'Ana Maria',
        role: 'member',
      },
    ],
    'board-active',
    true
  );

  // Segundo cambio encadenado antes de entrar: debe conservar el nombre original 'Sprint Q1' y 'Ana'
  LocalBoardRepository.applyRemoteBoardMetadata(
    [
      {
        boardId: 'board-other',
        title: 'Sprint Q3 Final',
        ownerId: 'usr-2',
        ownerName: 'Ana M.',
        role: 'member',
      },
    ],
    'board-active',
    true
  );

  const boardsAfterUpdate = LocalBoardRepository.getRegisteredBoards();
  const other = boardsAfterUpdate.find(b => b.id === 'board-other');
  assert.ok(other);
  assert.equal(other.title, 'Sprint Q3 Final');
  assert.equal(other.previousTitle, 'Sprint Q1');
  assert.equal(other.ownerName, 'Ana M.');
  assert.equal(other.previousOwnerName, 'Ana');

  // Al entrar al tablero, las notificaciones deben desaparecer
  LocalBoardRepository.clearBoardMetaNotifications('board-other');
  const boardsAfterEnter = LocalBoardRepository.getRegisteredBoards();
  const otherEntered = boardsAfterEnter.find(b => b.id === 'board-other');
  assert.ok(otherEntered);
  assert.equal(otherEntered.previousTitle, undefined);
  assert.equal(otherEntered.previousOwnerName, undefined);
});

test('LocalBoardRepository - Preserva rol admin localmente y al sincronizar metadatos', async () => {
  setupBrowserGlobals('http://localhost:5173/');
  const { LocalBoardRepository } = await import('../src/core/storage/localBoardRepository.ts');

  LocalBoardRepository.saveRegisteredBoard({
    id: 'board-admin-1',
    title: 'Tablero Admin',
    role: 'admin',
    ownerId: 'usr-owner',
    ownerName: 'Dueño',
    inviteToken: 'sec-dddddddddddddddddddddddddddddddd',
    lastOpenedAt: Date.now(),
  });

  const saved = LocalBoardRepository.getRegisteredBoards().find(b => b.id === 'board-admin-1');
  assert.equal(saved?.role, 'admin');

  // Si el propietario degrada a member en servidor, applyRemoteBoardMetadata actualiza el rol
  LocalBoardRepository.applyRemoteBoardMetadata(
    [{ boardId: 'board-admin-1', title: 'Tablero Admin', ownerName: 'Dueño', role: 'member' }],
    'other-board',
    true
  );
  const demoted = LocalBoardRepository.getRegisteredBoards().find(b => b.id === 'board-admin-1');
  assert.equal(demoted?.role, 'member');
});

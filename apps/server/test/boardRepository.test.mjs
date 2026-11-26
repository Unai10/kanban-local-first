import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { generateSecureToken, ROOM_NAME_REGEX } from '@kanban/shared-types';
import { createBoardRepository } from '../dist/infrastructure/db/boardRepository.js';

test('BoardRepository - Separación ownerToken vs inviteToken, joinCode y anti-resurrección', () => {
  const repo = createBoardRepository(':memory:');
  try {
    const boardId = 'test-board-' + Math.random().toString(36).substring(2, 7);
    const inviteToken = generateSecureToken();
    const ownerToken = generateSecureToken();
    const ownerId = 'usr-owner-1';
    const ownerName = 'Alice';

    // 1. Invitado sin ownerToken no puede crear tablero nuevo
    const unauthCreate = repo.authorizeOrRegisterBoard({
      boardId,
      title: 'Tablero Robado',
      inviteToken,
    });
    assert.equal(unauthCreate.valid, false);
    assert.equal(unauthCreate.reason, 'not_found');

    // 2. Propietario con ownerToken + inviteToken registra el tablero y obtiene joinCode
    const created = repo.authorizeOrRegisterBoard({
      boardId,
      title: 'Tablero Alice',
      inviteToken,
      ownerToken,
      ownerId,
      ownerName,
    });
    assert.equal(created.valid, true);
    assert.equal(created.role, 'owner');
    assert.ok(created.joinCode);

    // 3. Búsqueda por joinCode funciona sin exponer tokens secretos
    const lookup = repo.findBoardByJoinCode(created.joinCode.toLowerCase().replace('-', ''));
    assert.equal(lookup.valid, true);
    if (lookup.valid) {
      assert.equal(lookup.boardId, boardId);
      assert.equal('inviteToken' in lookup, false);
      assert.equal('ownerToken' in lookup, false);
    }

    // 4. Invitado autentica como member con inviteToken o con joinCode
    const memberByToken = repo.authorizeOrRegisterBoard({ boardId, inviteToken });
    assert.equal(memberByToken.valid, true);
    assert.equal(memberByToken.role, 'member');

    const memberByCode = repo.authorizeOrRegisterBoard({ boardId, inviteToken: '', joinCode: created.joinCode });
    assert.equal(memberByCode.valid, true);
    assert.equal(memberByCode.role, 'member');

    // 5. Token incorrecto rechazado
    const wrongAuth = repo.authorizeOrRegisterBoard({
      boardId,
      inviteToken: generateSecureToken(),
    });
    assert.equal(wrongAuth.valid, false);

    // 6. Un colaborador con inviteToken NO puede borrar el tablero
    assert.equal(repo.deleteBoard(boardId, inviteToken), 'forbidden');
    assert.ok(repo.getBoard(boardId));

    // 7. Solo el propietario con ownerToken puede borrar el tablero
    assert.equal(repo.deleteBoard(boardId, ownerToken), 'deleted');
    assert.equal(repo.getBoard(boardId), null);
    assert.equal(repo.isBoardDeleted(boardId), true);

    // 8. Anti-resurrección por boardId y detección de borrado por joinCode
    const deletedLookup = repo.findBoardByJoinCode(created.joinCode);
    assert.deepEqual(deletedLookup, { valid: false, deleted: true });

    const resurrect = repo.authorizeOrRegisterBoard({
      boardId,
      title: 'Resucitado',
      inviteToken,
      ownerToken,
      ownerId,
      ownerName,
    });
    assert.equal(resurrect.valid, false);
    assert.equal(resurrect.reason, 'deleted');

    // 9. allocateJoinCode no debe reutilizar un joinCode de un tablero eliminado
    const newInvite = generateSecureToken();
    const newOwner = generateSecureToken();
    const reused = repo.registerBoard({
      boardId: 'new-board-after-delete',
      title: 'Nuevo Tablero',
      inviteToken: newInvite,
      ownerToken: newOwner,
      ownerId,
      ownerName,
      joinCode: created.joinCode,
    });
    assert.equal(reused.ok, true);
    if (reused.ok) {
      assert.notEqual(reused.board.joinCode, created.joinCode);
    }
  } finally {
    repo.close();
  }
});

test('BoardRepository - updateBoardTitle, updateOwnerNameForBoards y getBoardsMetadata', () => {
  const repo = createBoardRepository(':memory:');
  try {
    const inviteA = generateSecureToken();
    const ownerA = generateSecureToken();
    const inviteB = generateSecureToken();
    const ownerB = generateSecureToken();

    repo.registerBoard({
      boardId: 'board-meta-a',
      title: 'Original A',
      inviteToken: inviteA,
      ownerToken: ownerA,
      ownerId: 'usr-owner-a',
      ownerName: 'Ana',
    });

    repo.registerBoard({
      boardId: 'board-meta-b',
      title: 'Original B',
      inviteToken: inviteB,
      ownerToken: ownerB,
      ownerId: 'usr-owner-b',
      ownerName: 'Luis',
    });

    // Solo el propietario puede renombrar el tablero
    assert.equal(repo.updateBoardTitle('board-meta-a', inviteA, 'Hackeado').ok, false);
    const renamed = repo.updateBoardTitle('board-meta-a', ownerA, 'Renombrado A');
    assert.equal(renamed.ok, true);
    if (renamed.ok) {
      assert.equal(renamed.board.title, 'Renombrado A');
    }

    // Actualizar nombre del propietario solo afecta a los tableros de ese ownerId + ownerToken válido
    const updatedOwnerBoards = repo.updateOwnerNameForBoards('usr-owner-a', 'Ana Maria', [
      { boardId: 'board-meta-a', ownerToken: ownerA },
      { boardId: 'board-meta-b', ownerToken: ownerB }, // distinto ownerId -> ignorado
    ]);
    assert.equal(updatedOwnerBoards.length, 1);
    assert.equal(updatedOwnerBoards[0].ownerName, 'Ana Maria');

    // Sincronización de metadatos filtra no autorizados y reporta borrados
    repo.deleteBoard('board-meta-b', ownerB);
    const metaList = repo.getBoardsMetadata([
      { boardId: 'board-meta-a', inviteToken: inviteA },
      { boardId: 'board-meta-b', inviteToken: inviteB },
      { boardId: 'board-meta-a', inviteToken: generateSecureToken() }, // duplicado / inválido
    ]);
    assert.equal(metaList.length, 2);
    assert.deepEqual(
      { title: metaList[0].title, ownerName: metaList[0].ownerName, role: metaList[0].role },
      { title: 'Renombrado A', ownerName: 'Ana Maria', role: 'member' }
    );
    assert.deepEqual(metaList[1], { boardId: 'board-meta-b', deleted: true });
  } finally {
    repo.close();
  }
});

test('BoardRepository - Compactación de deltas Yjs', () => {
  const repo = createBoardRepository(':memory:');
  try {
    const doc = new Y.Doc();
    doc.on('update', update => repo.saveUpdate('room-compact-1', update));

    const map = doc.getMap('cards');
    for (let i = 0; i < 60; i++) {
      map.set(`k-${i}`, i);
    }

    const loadedDoc = new Y.Doc();
    const remainingRows = repo.loadDocument('room-compact-1', loadedDoc);
    assert.equal(remainingRows, 1, 'Debe compactar >50 deltas a un único snapshot');
    assert.equal(loadedDoc.getMap('cards').get('k-59'), 59);
  } finally {
    repo.close();
  }
});

test('Seguridad - Sanitización estricta de nombres de sala (ROOM_NAME_REGEX)', () => {
  assert.equal(ROOM_NAME_REGEX.test('roadmap-2026'), true);
  assert.equal(ROOM_NAME_REGEX.test('sprint_01'), true);
  assert.equal(ROOM_NAME_REGEX.test('../secret'), false);
  assert.equal(ROOM_NAME_REGEX.test('board/with/slash'), false);
  assert.equal(ROOM_NAME_REGEX.test('board with spaces'), false);
  assert.equal(ROOM_NAME_REGEX.test('board<script>'), false);
  assert.equal(ROOM_NAME_REGEX.test('ab'), false);
});

test('BoardRepository - Gestión de roles admin/member y limpieza', () => {
  const repo = createBoardRepository(':memory:');
  try {
    const boardId = 'board-roles-1';
    const inviteToken = generateSecureToken();
    const ownerToken = generateSecureToken();

    repo.registerBoard({
      boardId,
      title: 'Roles Board',
      inviteToken,
      ownerToken,
      ownerId: 'usr-owner',
      ownerName: 'Owner',
    });

    // Colaborador sin rol asignado entra como member
    const initialAuth = repo.authorizeOrRegisterBoard({
      boardId,
      inviteToken,
      userId: 'usr-collab',
    });
    assert.equal(initialAuth.valid, true);
    assert.equal(initialAuth.role, 'member');

    // Solo el propietario puede asignar admin
    const forbid = repo.setBoardMemberRole(boardId, inviteToken, 'usr-collab', 'admin');
    assert.deepEqual(forbid, { ok: false, reason: 'forbidden' });

    const selfDemote = repo.setBoardMemberRole(boardId, ownerToken, 'usr-owner', 'admin');
    assert.deepEqual(selfDemote, { ok: false, reason: 'invalid_input' });

    const promoted = repo.setBoardMemberRole(boardId, ownerToken, 'usr-collab', 'admin');
    assert.equal(promoted.ok, true);
    assert.equal(repo.authorizeOrRegisterBoard({ boardId, inviteToken, userId: 'usr-collab' }).role, 'admin');

    const meta = repo.getBoardsMetadata([{ boardId, inviteToken, userId: 'usr-collab' }]);
    assert.equal(meta[0].role, 'admin');

    // Revocar rol vuelve a member
    const demoted = repo.setBoardMemberRole(boardId, ownerToken, 'usr-collab', 'member');
    assert.equal(demoted.ok, true);
    assert.equal(repo.authorizeOrRegisterBoard({ boardId, inviteToken, userId: 'usr-collab' }).role, 'member');
  } finally {
    repo.close();
  }
});

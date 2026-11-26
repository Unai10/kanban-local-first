import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  generateSecureToken,
  WS_MESSAGE_TYPE,
  WS_CLOSE_CODE,
} from '@kanban/shared-types';
import { createServerApp } from '../dist/index.js';

function startTestServer(overrides = {}) {
  const appInstance = createServerApp({
    port: 0,
    nodeEnv: 'test',
    dbPath: ':memory:',
    allowedOrigins: 'http://allowed-one.test, http://allowed-two.test',
    trustProxy: false,
    maxWsPayloadBytes: 64 * 1024,
    roomIdleTtlMs: 120,
    wsHeartbeatIntervalMs: 30_000,
    ...overrides,
  });

  return new Promise(resolve => {
    appInstance.server.listen(0, '127.0.0.1', () => {
      const addr = appInstance.server.address();
      resolve({
        appInstance,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        wsBaseUrl: `ws://127.0.0.1:${addr.port}`,
      });
    });
  });
}

test('Integración HTTP - Cabeceras de seguridad, multi-origen CORS y permisos DELETE', async () => {
  const { appInstance, baseUrl } = await startTestServer();
  try {
    // 1. Health check y cabeceras de seguridad
    const healthRes = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://allowed-two.test' },
    });
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.headers.get('x-powered-by'), null);
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
    assert.equal(healthRes.headers.get('access-control-allow-origin'), 'http://allowed-two.test');

    // 2. CORS bloquea origen no autorizado
    const badOriginRes = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://evil.test' },
    });
    assert.equal(badOriginRes.status, 403);

    // 3. Crear tablero vía POST /api/boards
    const boardId = 'board-integ-1';
    const inviteToken = generateSecureToken();
    const ownerToken = generateSecureToken();
    const createRes = await fetch(`${baseUrl}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boardId,
        title: 'Sprint Seguro',
        inviteToken,
        ownerToken,
        ownerId: 'usr-1',
        ownerName: 'Ana',
      }),
    });
    assert.equal(createRes.status, 201);

    // 4. Miembro con inviteToken NO puede borrar el tablero
    const memberDeleteRes = await fetch(`${baseUrl}/api/boards/${boardId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${inviteToken}` },
    });
    assert.equal(memberDeleteRes.status, 403);

    // 5. Propietario con Bearer ownerToken SÍ puede borrar el tablero
    const ownerDeleteRes = await fetch(`${baseUrl}/api/boards/${boardId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(ownerDeleteRes.status, 200);

    // 6. No se puede volver a crear un tablero eliminado (410 Gone)
    const recreateRes = await fetch(`${baseUrl}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boardId,
        title: 'Resucitado',
        inviteToken,
        ownerToken,
        ownerId: 'usr-1',
        ownerName: 'Ana',
      }),
    });
    assert.equal(recreateRes.status, 410);
  } finally {
    await appInstance.close();
  }
});

test('Integración WS - CSWSH, Subprotocol Auth, Sync, BOARD_META y cierre al borrar', async () => {
  const { appInstance, baseUrl, wsBaseUrl } = await startTestServer();
  try {
    const boardId = 'ws-room-1';
    const inviteToken = generateSecureToken();
    const ownerToken = generateSecureToken();

    await fetch(`${baseUrl}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boardId,
        title: 'Sala WS',
        inviteToken,
        ownerToken,
        ownerId: 'usr-owner',
        ownerName: 'Carlos',
      }),
    });

    // 1. Rechazo CSWSH por Origin no permitido
    await assert.rejects(async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsBaseUrl}/rooms/${boardId}`, ['yjs-v1', `invite.${inviteToken}`], {
          headers: { Origin: 'http://evil-site.test' },
        });
        ws.on('open', () => reject(new Error('No debería haber conectado')));
        ws.on('error', err => reject(err));
        ws.on('unexpected-response', (_req, res) => {
          assert.equal(res.statusCode, 403);
          resolve(undefined);
        });
      }).then(() => {
        throw new Error('rejected-as-expected');
      });
    }, /rejected-as-expected/);

    // 2. Conexión válida con subprotocolo y recepción de BOARD_META autoritativo
    const ownerMessages = [];
    const ownerWs = new WebSocket(
      `${wsBaseUrl}/rooms/${boardId}`,
      ['yjs-v1', `invite.${inviteToken}`, `owner.${ownerToken}`],
      { headers: { Origin: 'http://allowed-one.test' } }
    );

    const ownerMeta = await new Promise((resolve, reject) => {
      ownerWs.on('error', reject);
      ownerWs.on('message', data => {
        const buf = new Uint8Array(data);
        ownerMessages.push(buf);
        const decoder = decoding.createDecoder(buf);
        const msgType = decoding.readVarUint(decoder);
        if (msgType === WS_MESSAGE_TYPE.BOARD_META) {
          resolve(JSON.parse(decoding.readVarString(decoder)));
        }
      });
    });

    assert.equal(ownerMeta.role, 'owner');
    assert.equal(ownerMeta.ownerId, 'usr-owner');

    // 3. Conectar segundo cliente como miembro y sincronizar un update Yjs
    const memberWs = new WebSocket(
      `${wsBaseUrl}/rooms/${boardId}`,
      ['yjs-v1', `invite.${inviteToken}`],
      { headers: { Origin: 'http://allowed-two.test' } }
    );

    const memberMeta = await new Promise((resolve, reject) => {
      memberWs.on('error', reject);
      memberWs.on('message', data => {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const msgType = decoding.readVarUint(decoder);
        if (msgType === WS_MESSAGE_TYPE.BOARD_META) {
          resolve(JSON.parse(decoding.readVarString(decoder)));
        }
      });
    });
    assert.equal(memberMeta.role, 'member');

    // Enviar update desde ownerWs
    const doc = new Y.Doc();
    const memberDoc = new Y.Doc();
    const updatePromise = new Promise(resolve => {
      const handler = data => {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const msgType = decoding.readVarUint(decoder);
        if (msgType === WS_MESSAGE_TYPE.SYNC) {
          const reply = encoding.createEncoder();
          syncProtocol.readSyncMessage(decoder, reply, memberDoc, 'test');
          if (memberDoc.getMap('cards').get('card-1') === 'hello') {
            memberWs.off('message', handler);
            resolve(true);
          }
        }
      };
      memberWs.on('message', handler);
    });

    doc.on('update', (u, origin) => {
      if (origin === 'remote-sync') return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, WS_MESSAGE_TYPE.SYNC);
      syncProtocol.writeUpdate(enc, u);
      ownerWs.send(encoding.toUint8Array(enc));
    });
    doc.getMap('cards').set('card-1', 'hello');
    assert.equal(await updatePromise, true);

    // 3a. POST /api/boards/:boardId/leave limpia el assignee del usuario saliente y lo propaga vía Yjs
    const memberReceivedCardsPromise = new Promise(resolve => {
      const handler = data => {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const msgType = decoding.readVarUint(decoder);
        if (msgType === WS_MESSAGE_TYPE.SYNC) {
          const reply = encoding.createEncoder();
          syncProtocol.readSyncMessage(decoder, reply, memberDoc, 'test');
          if (memberDoc.getMap('cards').has('card-assigned')) {
            memberWs.off('message', handler);
            resolve(true);
          }
        }
      };
      memberWs.on('message', handler);
    });

    const assignedCard = new Y.Map();
    assignedCard.set('id', 'card-assigned');
    assignedCard.set('assignee', { userId: 'usr-leaving', name: 'Mario', color: '#3b82f6' });
    const otherCard = new Y.Map();
    otherCard.set('id', 'card-other');
    otherCard.set('assignee', { userId: 'usr-owner', name: 'Carlos', color: '#10b981' });
    doc.transact(() => {
      doc.getMap('cards').set('card-assigned', assignedCard);
      doc.getMap('cards').set('card-other', otherCard);
    });
    assert.equal(await memberReceivedCardsPromise, true);

    const leaveBroadcastPromise = new Promise(resolve => {
      const handler = data => {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const msgType = decoding.readVarUint(decoder);
        if (msgType === WS_MESSAGE_TYPE.SYNC) {
          const reply = encoding.createEncoder();
          syncProtocol.readSyncMessage(decoder, reply, doc, 'remote-sync');
          const c = doc.getMap('cards').get('card-assigned');
          if (c instanceof Y.Map && c.get('assignee') === null) {
            ownerWs.off('message', handler);
            resolve(true);
          }
        }
      };
      ownerWs.on('message', handler);
    });

    const leaveRes = await fetch(`${baseUrl}/api/boards/${boardId}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-leaving',
        inviteToken,
      }),
    });
    assert.equal(leaveRes.status, 200);
    assert.equal(await leaveBroadcastPromise, true);

    const remainingOther = doc.getMap('cards').get('card-other');
    assert.ok(remainingOther instanceof Y.Map);
    assert.deepEqual(remainingOther.get('assignee'), { userId: 'usr-owner', name: 'Carlos', color: '#10b981' });
    const leftMember = doc.getMap('members').get('usr-leaving');
    assert.ok(leftMember instanceof Y.Map);
    assert.equal(leftMember.get('left'), true);

    // 4. Al borrar el tablero vía DELETE, ambos WS reciben cierre 4410
    const memberClosePromise = new Promise(resolve => {
      memberWs.on('close', code => resolve(code));
    });
    const ownerClosePromise = new Promise(resolve => {
      ownerWs.on('close', code => resolve(code));
    });

    // 3b. Renombrar tablero vía PATCH y cambiar nombre de propietario emite BOARD_META en vivo
    const memberRenamedMetaPromise = new Promise(resolve => {
      const handler = data => {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const msgType = decoding.readVarUint(decoder);
        if (msgType === WS_MESSAGE_TYPE.BOARD_META) {
          const parsed = JSON.parse(decoding.readVarString(decoder));
          if (parsed.title === 'Sala WS Renombrada') {
            memberWs.off('message', handler);
            resolve(parsed);
          }
        }
      };
      memberWs.on('message', handler);
    });

    const renameRes = await fetch(`${baseUrl}/api/boards/${boardId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ title: 'Sala WS Renombrada' }),
    });
    assert.equal(renameRes.status, 200);
    const renamedMeta = await memberRenamedMetaPromise;
    assert.equal(renamedMeta.title, 'Sala WS Renombrada');
    assert.equal(renamedMeta.role, 'member');

    const memberOwnerRenamedPromise = new Promise(resolve => {
      const handler = data => {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const msgType = decoding.readVarUint(decoder);
        if (msgType === WS_MESSAGE_TYPE.BOARD_META) {
          const parsed = JSON.parse(decoding.readVarString(decoder));
          if (parsed.ownerName === 'Carlos Pro') {
            memberWs.off('message', handler);
            resolve(parsed);
          }
        }
      };
      memberWs.on('message', handler);
    });

    const ownerNameRes = await fetch(`${baseUrl}/api/boards/owner-name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerId: 'usr-owner',
        ownerName: 'Carlos Pro',
        boards: [{ boardId, ownerToken }],
      }),
    });
    assert.equal(ownerNameRes.status, 200);
    const ownerUpdatedMeta = await memberOwnerRenamedPromise;
    assert.equal(ownerUpdatedMeta.ownerName, 'Carlos Pro');

    // 3c. POST /api/boards/metadata devuelve metadatos actualizados para el sidebar
    const batchMetaRes = await fetch(`${baseUrl}/api/boards/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boards: [{ boardId, inviteToken }],
      }),
    });
    assert.equal(batchMetaRes.status, 200);
    const batchMetaBody = await batchMetaRes.json();
    assert.equal(batchMetaBody.boards.length, 1);
    assert.equal(batchMetaBody.boards[0].title, 'Sala WS Renombrada');
    assert.equal(batchMetaBody.boards[0].ownerName, 'Carlos Pro');

    const delRes = await fetch(`${baseUrl}/api/boards/${boardId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(delRes.status, 200);
    assert.equal(await memberClosePromise, WS_CLOSE_CODE.BOARD_DELETED);
    assert.equal(await ownerClosePromise, WS_CLOSE_CODE.BOARD_DELETED);
  } finally {
    await appInstance.close();
  }
});

test('Integración WS - Evicción de sala tras TTL y Rate Limit', async () => {
  const { appInstance, baseUrl, wsBaseUrl } = await startTestServer({ roomIdleTtlMs: 50 });
  try {
    const boardId = 'ttl-room-1';
    const inviteToken = generateSecureToken();
    const ownerToken = generateSecureToken();

    await fetch(`${baseUrl}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boardId,
        title: 'TTL Room',
        inviteToken,
        ownerToken,
        ownerId: 'usr-1',
        ownerName: 'Eva',
      }),
    });

    const ws = new WebSocket(
      `${wsBaseUrl}/rooms/${boardId}`,
      ['yjs-v1', `invite.${inviteToken}`],
      { headers: { Origin: 'http://allowed-one.test' } }
    );
    await new Promise(resolve => ws.on('open', resolve));
    assert.equal(appInstance.roomManager.getRoomCount(), 1);

    const wsClosed = new Promise(resolve => ws.once('close', resolve));
    ws.close();
    await wsClosed;
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(appInstance.roomManager.getRoomCount(), 0, 'La sala vacía debe liberarse tras el TTL');

    // Cabecera Host inválida en raw HTTP upgrade no debe tumbar el servidor
    await new Promise(resolve => {
      const addr = appInstance.server.address();
      const sock = net.connect(addr.port, '127.0.0.1', () => {
        sock.write(
          `GET /rooms/${boardId} HTTP/1.1\r\nHost: invalid host with spaces\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`
        );
      });
      sock.setTimeout(1000);
      sock.on('data', () => {
        sock.destroy();
        resolve(undefined);
      });
      sock.on('close', () => resolve(undefined));
      sock.on('error', () => resolve(undefined));
      sock.on('timeout', () => {
        sock.destroy();
        resolve(undefined);
      });
    });

    // Rate limiting tras 15 intentos fallidos de token inválido -> 4429
    const wrongToken = generateSecureToken();
    for (let i = 0; i < 15; i++) {
      const badWs = new WebSocket(
        `${wsBaseUrl}/rooms/${boardId}`,
        ['yjs-v1', `invite.${wrongToken}`],
        { headers: { Origin: 'http://allowed-one.test' } }
      );
      await new Promise(resolve => badWs.once('close', resolve));
    }
    const limitedWs = new WebSocket(
      `${wsBaseUrl}/rooms/${boardId}`,
      ['yjs-v1', `invite.${wrongToken}`],
      { headers: { Origin: 'http://allowed-one.test' } }
    );
    const limitedCode = await new Promise(resolve => limitedWs.once('close', code => resolve(code)));
    assert.equal(limitedCode, WS_CLOSE_CODE.RATE_LIMITED);

    const stillAliveRes = await fetch(`${baseUrl}/health`);
    assert.equal(stillAliveRes.status, 200);
  } finally {
    await appInstance.close();
  }
});

test('Producción todo-en-uno - Sirve SPA estática, CSP diferenciada y same-host CSWSH', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-static-'));
  fs.writeFileSync(path.join(tmpDir, 'index.html'), '<!doctype html><html><body>SPA OK</body></html>');

  const { appInstance, baseUrl, wsBaseUrl } = await startTestServer({
    nodeEnv: 'production',
    allowedOrigins: '',
    staticDir: tmpDir,
  });

  try {
    const port = appInstance.server.address().port;
    const sameOrigin = `http://127.0.0.1:${port}`;

    // 1. SPA en / devuelve index.html con CSP de aplicación
    const spaRes = await fetch(`${baseUrl}/`);
    assert.equal(spaRes.status, 200);
    assert.match(await spaRes.text(), /SPA OK/);
    assert.match(spaRes.headers.get('content-security-policy') || '', /default-src 'self'/);

    // 2. /health devuelve activeRooms y mantiene CSP estricta de API
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.status, 'ok');
    assert.equal(typeof healthJson.activeRooms, 'number');
    assert.match(healthRes.headers.get('content-security-policy') || '', /default-src 'none'/);

    // 3. Same-host Origin permitido y Origin externo bloqueado
    const inviteToken = generateSecureToken();
    const ownerToken = generateSecureToken();
    const boardId = 'prod-samehost-1';

    const okCreate = await fetch(`${baseUrl}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: sameOrigin },
      body: JSON.stringify({
        boardId,
        title: 'Prod Demo',
        inviteToken,
        ownerToken,
        ownerId: 'usr-prod',
        ownerName: 'Demo',
      }),
    });
    assert.equal(okCreate.status, 201);

    const evilHttp = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://evil-origin.test' },
    });
    assert.equal(evilHttp.status, 403);

    const wsOk = new WebSocket(
      `${wsBaseUrl}/rooms/${boardId}`,
      ['yjs-v1', `invite.${inviteToken}`],
      { headers: { Origin: sameOrigin } }
    );
    await new Promise((resolve, reject) => {
      wsOk.on('open', resolve);
      wsOk.on('error', reject);
    });
    wsOk.close();
  } finally {
    await appInstance.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Integración Roles - Promoción en vivo y descarte de cambios de columnas offline tras degradación', async () => {
  const { appInstance, baseUrl, wsBaseUrl } = await startTestServer();
  try {
    const boardId = 'roles-sync-1';
    const inviteToken = generateSecureToken();
    const ownerToken = generateSecureToken();

    await fetch(`${baseUrl}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boardId,
        title: 'Tablero Roles',
        inviteToken,
        ownerToken,
        ownerId: 'usr-owner',
        ownerName: 'Jefe',
      }),
    });

    // Helper mínimo para sincronizar un Y.Doc con un WebSocket
    function attachDocSync(ws, ydoc, onBoardMeta) {
      ws.on('message', data => {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const msgType = decoding.readVarUint(decoder);
        if (msgType === WS_MESSAGE_TYPE.SYNC) {
          const reply = encoding.createEncoder();
          encoding.writeVarUint(reply, WS_MESSAGE_TYPE.SYNC);
          syncProtocol.readSyncMessage(decoder, reply, ydoc, 'remote-sync');
          if (encoding.length(reply) > 1) {
            ws.send(encoding.toUint8Array(reply));
          }
        } else if (msgType === WS_MESSAGE_TYPE.BOARD_META) {
          onBoardMeta?.(JSON.parse(decoding.readVarString(decoder)));
        }
      });
    }

    const ownerDoc = new Y.Doc();
    const ownerWs = new WebSocket(
      `${wsBaseUrl}/rooms/${boardId}?userId=usr-owner`,
      ['yjs-v1', `invite.${inviteToken}`, `owner.${ownerToken}`],
      { headers: { Origin: 'http://allowed-one.test' } }
    );
    ownerWs.on('message', data => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      if (decoding.readVarUint(decoder) === WS_MESSAGE_TYPE.SYNC) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, WS_MESSAGE_TYPE.SYNC);
        syncProtocol.readSyncMessage(decoder, reply, ownerDoc, 'remote-sync');
        if (encoding.length(reply) > 1) {
          ownerWs.send(encoding.toUint8Array(reply));
        }
      }
    });
    await new Promise(resolve => ownerWs.once('open', resolve));
    {
      const step1 = encoding.createEncoder();
      encoding.writeVarUint(step1, WS_MESSAGE_TYPE.SYNC);
      syncProtocol.writeSyncStep1(step1, ownerDoc);
      ownerWs.send(encoding.toUint8Array(step1));
    }

    ownerDoc.on('update', (u, origin) => {
      if (origin === 'remote-sync') return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, WS_MESSAGE_TYPE.SYNC);
      syncProtocol.writeUpdate(enc, u);
      ownerWs.send(encoding.toUint8Array(enc));
    });

    // Crear columna base como owner
    ownerDoc.transact(() => {
      const col = new Y.Map();
      col.set('id', 'col-1');
      col.set('title', 'Por Hacer');
      col.set('orderKey', 'a0');
      ownerDoc.getMap('columns').set('col-1', col);
    });

    // Conectar colaborador
    const collabDoc = new Y.Doc();
    const collabMetas = [];
    let collabWs = new WebSocket(
      `${wsBaseUrl}/rooms/${boardId}?userId=usr-collab`,
      ['yjs-v1', `invite.${inviteToken}`],
      { headers: { Origin: 'http://allowed-two.test' } }
    );
    attachDocSync(collabWs, collabDoc, meta => collabMetas.push(meta));
    await new Promise(resolve => collabWs.once('open', resolve));
    {
      const step1 = encoding.createEncoder();
      encoding.writeVarUint(step1, WS_MESSAGE_TYPE.SYNC);
      syncProtocol.writeSyncStep1(step1, collabDoc);
      collabWs.send(encoding.toUint8Array(step1));
    }

    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(collabMetas[0].role, 'member');

    // 1. Un miembro NO puede asignar roles (403)
    const unauthRoleRes = await fetch(`${baseUrl}/api/boards/${boardId}/roles`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${inviteToken}`,
      },
      body: JSON.stringify({ userId: 'usr-collab', role: 'admin' }),
    });
    assert.equal(unauthRoleRes.status, 403);

    // 2. Owner asciende a usr-collab a admin y llega BOARD_META en vivo
    const promoteRes = await fetch(`${baseUrl}/api/boards/${boardId}/roles`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ userId: 'usr-collab', role: 'admin' }),
    });
    assert.equal(promoteRes.status, 200);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(collabMetas.at(-1).role, 'admin');

    // 3. Colaborador desconecta (pasa a offline)
    const closedPromise = new Promise(resolve => collabWs.once('close', resolve));
    collabWs.close();
    await closedPromise;

    // 4. Owner revoca rol admin mientras colaborador está offline
    const demoteRes = await fetch(`${baseUrl}/api/boards/${boardId}/roles`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ userId: 'usr-collab', role: 'member' }),
    });
    assert.equal(demoteRes.status, 200);

    // 5. Colaborador offline modifica col-1, crea col-unauth y crea una tarjeta válida
    collabDoc.transact(() => {
      const col1 = collabDoc.getMap('columns').get('col-1');
      col1.set('title', 'Hackeada Offline');

      const badCol = new Y.Map();
      badCol.set('id', 'col-unauth');
      badCol.set('title', 'Columna Ilegal');
      badCol.set('orderKey', 'a1');
      collabDoc.getMap('columns').set('col-unauth', badCol);

      const validCard = new Y.Map();
      validCard.set('id', 'card-offline-valid');
      validCard.set('columnId', 'col-unauth');
      validCard.set('title', 'Tarjeta Válida');
      collabDoc.getMap('cards').set('card-offline-valid', validCard);
    });

    // 6. Colaborador reconecta y sincroniza su delta offline
    const reconnectMetas = [];
    collabWs = new WebSocket(
      `${wsBaseUrl}/rooms/${boardId}?userId=usr-collab`,
      ['yjs-v1', `invite.${inviteToken}`],
      { headers: { Origin: 'http://allowed-two.test' } }
    );
    attachDocSync(collabWs, collabDoc, meta => reconnectMetas.push(meta));
    await new Promise(resolve => collabWs.once('open', resolve));
    {
      const step1 = encoding.createEncoder();
      encoding.writeVarUint(step1, WS_MESSAGE_TYPE.SYNC);
      syncProtocol.writeSyncStep1(step1, collabDoc);
      collabWs.send(encoding.toUint8Array(step1));
    }

    // Enviar estado completo offline hacia el servidor (como hace y-websocket en SyncStep2)
    const sync2 = encoding.createEncoder();
    encoding.writeVarUint(sync2, WS_MESSAGE_TYPE.SYNC);
    syncProtocol.writeUpdate(sync2, Y.encodeStateAsUpdate(collabDoc));
    collabWs.send(encoding.toUint8Array(sync2));

    await new Promise(resolve => setTimeout(resolve, 120));

    // Verificar que el servidor advirtió columnsReverted y restauró columnas en ambos docs
    assert.equal(reconnectMetas.some(m => m.role === 'member' && m.columnsReverted === true), true);
    assert.equal(ownerDoc.getMap('columns').has('col-unauth'), false);
    assert.equal(ownerDoc.getMap('columns').get('col-1').get('title'), 'Por Hacer');
    assert.equal(collabDoc.getMap('columns').has('col-unauth'), false);
    assert.equal(collabDoc.getMap('columns').get('col-1').get('title'), 'Por Hacer');

    // Verificar que la tarjeta válida NO se perdió y fue reubicada a col-1
    const syncedCard = ownerDoc.getMap('cards').get('card-offline-valid');
    assert.ok(syncedCard instanceof Y.Map);
    assert.equal(syncedCard.get('title'), 'Tarjeta Válida');
    assert.equal(syncedCard.get('columnId'), 'col-1');

    collabWs.close();
    ownerWs.close();
  } finally {
    await appInstance.close();
  }
});

test('Integración 3 Usuarios - Comentarios concurrentes offline y convergencia tras borrado de columna', async () => {
  const { appInstance, baseUrl, wsBaseUrl } = await startTestServer();
  try {
    const boardId = 'three-users-offline-1';
    const inviteToken = generateSecureToken();
    const ownerToken = generateSecureToken();

    await fetch(`${baseUrl}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boardId,
        title: 'Tablero 3 Usuarios',
        inviteToken,
        ownerToken,
        ownerId: 'usr-owner',
        ownerName: 'User1 Owner',
      }),
    });

    function connectClient(userId, extraProtocols = []) {
      const ydoc = new Y.Doc();
      const ws = new WebSocket(
        `${wsBaseUrl}/rooms/${boardId}?userId=${encodeURIComponent(userId)}`,
        ['yjs-v1', `invite.${inviteToken}`, ...extraProtocols],
        { headers: { Origin: 'http://allowed-one.test' } }
      );
      ws.on('message', data => {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        if (decoding.readVarUint(decoder) === WS_MESSAGE_TYPE.SYNC) {
          const reply = encoding.createEncoder();
          encoding.writeVarUint(reply, WS_MESSAGE_TYPE.SYNC);
          syncProtocol.readSyncMessage(decoder, reply, ydoc, 'remote-sync');
          if (encoding.length(reply) > 1 && ws.readyState === WebSocket.OPEN) {
            ws.send(encoding.toUint8Array(reply));
          }
        }
      });
      ydoc.on('update', (u, origin) => {
        if (origin === 'remote-sync' || ws.readyState !== WebSocket.OPEN) return;
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, WS_MESSAGE_TYPE.SYNC);
        syncProtocol.writeUpdate(enc, u);
        ws.send(encoding.toUint8Array(enc));
      });
      return { ydoc, ws };
    }

    const u1 = connectClient('usr-owner', [`owner.${ownerToken}`]);
    const u2 = connectClient('usr-admin');
    const u3 = connectClient('usr-member');

    await Promise.all([
      new Promise(r => u1.ws.once('open', r)),
      new Promise(r => u2.ws.once('open', r)),
      new Promise(r => u3.ws.once('open', r)),
    ]);

    for (const c of [u1, u2, u3]) {
      const step1 = encoding.createEncoder();
      encoding.writeVarUint(step1, WS_MESSAGE_TYPE.SYNC);
      syncProtocol.writeSyncStep1(step1, c.ydoc);
      c.ws.send(encoding.toUint8Array(step1));
    }

    await fetch(`${baseUrl}/api/boards/${boardId}/roles`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ userId: 'usr-admin', role: 'admin' }),
    });

    // Estado base creado por Owner (u1)
    u1.ydoc.transact(() => {
      for (const [id, title, key] of [
        ['col-1', 'Por Hacer', 'a0'],
        ['col-2', 'En Progreso', 'a1'],
        ['col-3', 'Terminado', 'a2'],
      ]) {
        const col = new Y.Map();
        col.set('id', id);
        col.set('title', title);
        col.set('orderKey', key);
        u1.ydoc.getMap('columns').set(id, col);
      }
      const card = new Y.Map();
      card.set('id', 'card-shared');
      card.set('columnId', 'col-1');
      card.set('title', 'Tarjeta Compartida');
      u1.ydoc.getMap('cards').set('card-shared', card);
    });

    await new Promise(r => setTimeout(r, 120));

    // Desconectar u1 (Owner) y u3 (Member) simultáneamente para comentar offline
    await Promise.all([
      new Promise(r => {
        u1.ws.once('close', r);
        u1.ws.close();
      }),
      new Promise(r => {
        u3.ws.once('close', r);
        u3.ws.close();
      }),
    ]);

    // Ambos comentan offline sobre card-shared; u3 también crea tarjeta offline en col-2
    u1.ydoc.transact(() => {
      const cm1 = new Y.Map();
      cm1.set('id', 'cmt-u1');
      cm1.set('cardId', 'card-shared');
      cm1.set('authorId', 'usr-owner');
      cm1.set('text', 'Comentario offline Owner');
      cm1.set('createdAt', 1000);
      u1.ydoc.getMap('comments').set('cmt-u1', cm1);
    });
    u3.ydoc.transact(() => {
      const cm3 = new Y.Map();
      cm3.set('id', 'cmt-u3');
      cm3.set('cardId', 'card-shared');
      cm3.set('authorId', 'usr-member');
      cm3.set('text', 'Comentario offline Member');
      cm3.set('createdAt', 1001);
      u3.ydoc.getMap('comments').set('cmt-u3', cm3);

      const cOffline = new Y.Map();
      cOffline.set('id', 'card-u3-col2');
      cOffline.set('columnId', 'col-2');
      cOffline.set('title', 'Card en col-2');
      u3.ydoc.getMap('cards').set('card-u3-col2', cOffline);
    });

    // Mientras tanto, u2 (Admin) sigue online y elimina col-2 reubicando hacia col-3
    u2.ydoc.transact(() => {
      const col2 = u2.ydoc.getMap('columns').get('col-2');
      col2.set('deleted', true);
      col2.set('deletedTargetColumnId', 'col-3');
    });

    await new Promise(r => setTimeout(r, 80));

    // Reconectar u1 y u3 con su estado offline
    const u1Re = connectClient('usr-owner', [`owner.${ownerToken}`]);
    const u3Re = connectClient('usr-member');
    await Promise.all([
      new Promise(r => u1Re.ws.once('open', r)),
      new Promise(r => u3Re.ws.once('open', r)),
    ]);

    for (const [re, orig] of [
      [u1Re, u1],
      [u3Re, u3],
    ]) {
      Y.applyUpdate(re.ydoc, Y.encodeStateAsUpdate(orig.ydoc), 'remote-sync');
      const step1 = encoding.createEncoder();
      encoding.writeVarUint(step1, WS_MESSAGE_TYPE.SYNC);
      syncProtocol.writeSyncStep1(step1, re.ydoc);
      re.ws.send(encoding.toUint8Array(step1));

      const syncUpd = encoding.createEncoder();
      encoding.writeVarUint(syncUpd, WS_MESSAGE_TYPE.SYNC);
      syncProtocol.writeUpdate(syncUpd, Y.encodeStateAsUpdate(re.ydoc));
      re.ws.send(encoding.toUint8Array(syncUpd));
    }

    await new Promise(r => setTimeout(r, 150));

    // Los 3 usuarios tienen ambos comentarios y la columna col-2 eliminada con deletedTargetColumnId = col-3
    for (const client of [u1Re, u2, u3Re]) {
      assert.equal(client.ydoc.getMap('comments').has('cmt-u1'), true);
      assert.equal(client.ydoc.getMap('comments').has('cmt-u3'), true);
      assert.equal(client.ydoc.getMap('cards').has('card-u3-col2'), true);
      const col2 = client.ydoc.getMap('columns').get('col-2');
      assert.equal(col2.get('deleted'), true);
      assert.equal(col2.get('deletedTargetColumnId'), 'col-3');
    }

    u1Re.ws.close();
    u2.ws.close();
    u3Re.ws.close();
  } finally {
    await appInstance.close();
  }
});

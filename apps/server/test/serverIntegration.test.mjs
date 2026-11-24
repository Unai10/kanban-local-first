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

import type http from 'http';
import { WebSocket } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  ROOM_NAME_REGEX,
  WS_MESSAGE_TYPE,
  WS_CLOSE_CODE,
  LIMITS,
  type ServerBoardMetaPayload,
} from '@kanban/shared-types';
import type { BoardRepository } from '../infrastructure/db/boardRepository.js';
import type { RoomManager } from '../rooms/roomManager.js';
import type { RateLimiter } from '../security/rateLimiter.js';

export interface WsHandlerDeps {
  boardRepo: BoardRepository;
  roomManager: RoomManager;
  authRateLimiter: RateLimiter;
  trustProxy: boolean;
}

export function getClientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0].trim();
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Extrae las credenciales del handshake WebSocket priorizando `Sec-WebSocket-Protocol`
 * para evitar exponer tokens en logs HTTP de query strings.
 */
function parseWsCredentials(req: http.IncomingMessage, url: URL): {
  inviteToken: string;
  ownerToken: string;
  joinCode: string;
  title: string;
  ownerId: string;
  ownerName: string;
} {
  let inviteToken = (url.searchParams.get('token') || '').trim();
  let ownerToken = (url.searchParams.get('ownerToken') || '').trim();
  let joinCode = (url.searchParams.get('joinCode') || '').trim();

  const protoHeader = req.headers['sec-websocket-protocol'];
  if (typeof protoHeader === 'string') {
    const parts = protoHeader.split(',').map(p => p.trim());
    for (const part of parts) {
      if (part.startsWith('invite.')) {
        inviteToken = part.slice('invite.'.length);
      } else if (part.startsWith('owner.')) {
        ownerToken = part.slice('owner.'.length);
      } else if (part.startsWith('joincode.')) {
        joinCode = part.slice('joincode.'.length);
      }
    }
  }

  return {
    inviteToken,
    ownerToken,
    joinCode,
    title: (url.searchParams.get('title') || 'Tablero Kanban').trim(),
    ownerId: (url.searchParams.get('ownerId') || '').trim(),
    ownerName: (url.searchParams.get('ownerName') || '').trim(),
  };
}

/**
 * Crea el manejador de conexiones WebSocket autenticadas para sincronización Yjs,
 * Awareness de presencia y metadatos autoritativos de tablero.
 */
export function createWsConnectionHandler(deps: WsHandlerDeps) {
  const { boardRepo, roomManager, authRateLimiter, trustProxy } = deps;

  return function setupConnection(conn: WebSocket, req: http.IncomingMessage): void {
    const clientIp = getClientIp(req, trustProxy);

    if (authRateLimiter.isLimited(clientIp)) {
      conn.close(WS_CLOSE_CODE.RATE_LIMITED, 'Too Many Requests: Demasiados intentos fallidos.');
      return;
    }

    let url: URL;
    try {
      url = new URL(req.url || '', 'http://localhost');
    } catch {
      conn.close(WS_CLOSE_CODE.BAD_REQUEST, 'Bad Request: URL inválida');
      return;
    }

    const roomName = url.pathname.replace(/^\/rooms\//, '');
    if (!ROOM_NAME_REGEX.test(roomName)) {
      conn.close(WS_CLOSE_CODE.BAD_REQUEST, 'Bad Request: Nombre de sala inválido');
      return;
    }

    const creds = parseWsCredentials(req, url);
    const auth = boardRepo.authorizeOrRegisterBoard({
      boardId: roomName,
      title: creds.title,
      inviteToken: creds.inviteToken,
      ownerToken: creds.ownerToken,
      joinCode: creds.joinCode,
      ownerId: creds.ownerId,
      ownerName: creds.ownerName,
    });

    if (!auth.valid || !auth.role) {
      if (auth.reason === 'deleted') {
        conn.close(WS_CLOSE_CODE.BOARD_DELETED, 'Este tablero ha sido eliminado');
        return;
      }
      authRateLimiter.recordFailure(clientIp);
      conn.close(WS_CLOSE_CODE.FORBIDDEN, 'Forbidden: Token de acceso inválido');
      return;
    }

    const room = roomManager.addConnection(roomName, conn, auth.role);

    (conn as WebSocket & { isAlive?: boolean }).isAlive = true;
    conn.on('pong', () => {
      (conn as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    let msgWindowStart = Date.now();
    let msgCount = 0;

    // Enviar metadatos autoritativos del servidor
    const metaPayload: ServerBoardMetaPayload = {
      boardId: roomName,
      title: auth.title || 'Tablero Kanban',
      ownerId: auth.ownerId || '',
      ownerName: auth.ownerName || 'Propietario',
      joinCode: auth.joinCode,
      role: auth.role,
    };
    const metaEncoder = encoding.createEncoder();
    encoding.writeVarUint(metaEncoder, WS_MESSAGE_TYPE.BOARD_META);
    encoding.writeVarString(metaEncoder, JSON.stringify(metaPayload));
    conn.send(encoding.toUint8Array(metaEncoder));

    // SyncStep1 del servidor al cliente
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, WS_MESSAGE_TYPE.SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, room.doc);
    conn.send(encoding.toUint8Array(syncEncoder));

    // Estado inicial de awareness
    const awarenessStates = room.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awEncoder = encoding.createEncoder();
      encoding.writeVarUint(awEncoder, WS_MESSAGE_TYPE.AWARENESS);
      encoding.writeVarUint8Array(
        awEncoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys()))
      );
      conn.send(encoding.toUint8Array(awEncoder));
    }

    conn.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const now = Date.now();
      if (now - msgWindowStart > 1000) {
        msgWindowStart = now;
        msgCount = 0;
      }
      msgCount += 1;
      if (msgCount > 120) {
        conn.close(WS_CLOSE_CODE.RATE_LIMITED, 'Too Many Messages');
        return;
      }

      try {
        const uint8Msg = Array.isArray(data)
          ? new Uint8Array(Buffer.concat(data))
          : new Uint8Array(data);
        const decoder = decoding.createDecoder(uint8Msg);
        const messageType = decoding.readVarUint(decoder);

        if (messageType === WS_MESSAGE_TYPE.SYNC) {
          const replyEncoder = encoding.createEncoder();
          encoding.writeVarUint(replyEncoder, WS_MESSAGE_TYPE.SYNC);
          syncProtocol.readSyncMessage(decoder, replyEncoder, room.doc, conn);
          if (encoding.length(replyEncoder) > 1) {
            conn.send(encoding.toUint8Array(replyEncoder));
          }

          if (
            room.doc.getMap('cards').size > LIMITS.MAX_CARDS_PER_BOARD ||
            room.doc.getMap('columns').size > LIMITS.MAX_COLUMNS_PER_BOARD
          ) {
            conn.close(WS_CLOSE_CODE.BAD_REQUEST, 'Límite de elementos del tablero excedido');
          }
        } else if (messageType === WS_MESSAGE_TYPE.AWARENESS) {
          const update = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(room.awareness, update, conn);
        }
      } catch (err) {
        console.error('[WebSocket Error al procesar mensaje]:', err);
      }
    });

    conn.on('close', () => {
      roomManager.removeConnection(roomName, conn);
    });
  };
}

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import { WebSocket } from 'ws';
import {
  WS_MESSAGE_TYPE,
  WS_CLOSE_CODE,
  sanitizeSingleLineText,
  type ServerBoardMetaPayload,
} from '@kanban/shared-types';
import type { BoardRepository } from '../infrastructure/db/boardRepository.js';
import type { BoardRole, Room } from '../types.js';

export interface RoomManagerOptions {
  roomIdleTtlMs?: number;
  compactThreshold?: number;
}

export interface RoomManager {
  getOrCreateRoom(roomName: string): Room;
  addConnection(roomName: string, conn: WebSocket, role: BoardRole): Room;
  removeConnection(roomName: string, conn: WebSocket): void;
  removeMemberFromBoard(roomName: string, userId: string): boolean;
  broadcastBoardMeta(
    roomName: string,
    meta: { title: string; ownerId: string; ownerName: string; joinCode?: string }
  ): void;
  destroyRoomAndNotify(roomName: string, closeCode?: number, reason?: string): void;
  getRoomCount(): number;
  closeAll(): void;
}

/**
 * Gestiona el ciclo de vida en memoria de las salas Yjs activas:
 * carga/compactación desde SQLite, difusión binaria, limpieza de Awareness y evicción por inactividad.
 */
export function createRoomManager(
  boardRepo: BoardRepository,
  options: RoomManagerOptions = {}
): RoomManager {
  const roomIdleTtlMs = options.roomIdleTtlMs ?? 5 * 60 * 1000;
  const compactThreshold = options.compactThreshold ?? 50;
  const rooms = new Map<string, Room>();

  function broadcastBinary(room: Room, payload: Uint8Array, exclude?: unknown): void {
    room.conns.forEach(otherConn => {
      if (otherConn !== exclude && otherConn.readyState === WebSocket.OPEN) {
        otherConn.send(payload);
      }
    });
  }

  function evictRoom(roomName: string): void {
    const room = rooms.get(roomName);
    if (!room || room.conns.size > 0 || room.destroyed) return;

    room.destroyed = true;
    if (room.idleTimer) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }

    try {
      if (room.updatesSinceCompact > 0 && !boardRepo.isBoardDeleted(roomName)) {
        boardRepo.compactRoomUpdates(roomName, room.doc);
      }
    } catch (err) {
      console.error(`[RoomManager] Error compactando sala '${roomName}' al evictar:`, err);
    }

    room.awareness.destroy();
    room.doc.destroy();
    rooms.delete(roomName);
  }

  function getOrCreateRoom(roomName: string): Room {
    let room = rooms.get(roomName);
    if (room && !room.destroyed) {
      if (room.idleTimer) {
        clearTimeout(room.idleTimer);
        room.idleTimer = null;
      }
      return room;
    }

    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);

    const loadedRows = boardRepo.loadDocument(roomName, doc);

    const newRoom: Room = {
      name: roomName,
      doc,
      awareness,
      conns: new Set(),
      connRoles: new Map(),
      connClientIds: new Map(),
      updatesSinceCompact: loadedRows > 1 ? loadedRows : 0,
      idleTimer: null,
      destroyed: false,
    };

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (newRoom.destroyed || origin === 'db-load') return;

      try {
        boardRepo.saveUpdate(roomName, update);
        newRoom.updatesSinceCompact += 1;
        if (newRoom.updatesSinceCompact >= compactThreshold) {
          boardRepo.compactRoomUpdates(roomName, doc);
          newRoom.updatesSinceCompact = 0;
        }
      } catch (err) {
        console.error(`[RoomManager] Error persistiendo update en '${roomName}':`, err);
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, WS_MESSAGE_TYPE.SYNC);
      syncProtocol.writeUpdate(encoder, update);
      broadcastBinary(newRoom, encoding.toUint8Array(encoder), origin);
    });

    awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown
      ) => {
        if (newRoom.destroyed) return;

        if (origin instanceof WebSocket) {
          let controlledIds = newRoom.connClientIds.get(origin);
          if (!controlledIds) {
            controlledIds = new Set<number>();
            newRoom.connClientIds.set(origin, controlledIds);
          }
          added.forEach(id => controlledIds!.add(id));
          updated.forEach(id => controlledIds!.add(id));
          removed.forEach(id => controlledIds!.delete(id));
        }

        const changedClients = added.concat(updated, removed);
        if (changedClients.length === 0) return;

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, WS_MESSAGE_TYPE.AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
        );
        broadcastBinary(newRoom, encoding.toUint8Array(encoder), origin);
      }
    );

    rooms.set(roomName, newRoom);
    return newRoom;
  }

  function addConnection(roomName: string, conn: WebSocket, role: BoardRole): Room {
    const room = getOrCreateRoom(roomName);
    if (room.idleTimer) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }
    room.conns.add(conn);
    room.connRoles.set(conn, role);
    room.connClientIds.set(conn, new Set());
    return room;
  }

  function removeConnection(roomName: string, conn: WebSocket): void {
    const room = rooms.get(roomName);
    if (!room || room.destroyed) return;

    const controlledIds = room.connClientIds.get(conn);
    room.conns.delete(conn);
    room.connRoles.delete(conn);
    room.connClientIds.delete(conn);

    if (controlledIds && controlledIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(controlledIds), 'disconnect');
    }

    if (room.conns.size === 0 && !room.idleTimer) {
      room.idleTimer = setTimeout(() => {
        evictRoom(roomName);
      }, roomIdleTtlMs);
      room.idleTimer.unref?.();
    }
  }

  /**
   * Marca al miembro saliente en `members` y limpia su asignación en todas las tarjetas del tablero.
   */
  function removeMemberFromBoard(roomName: string, userId: string): boolean {
    const cleanUserId = sanitizeSingleLineText(userId, 64);
    if (!cleanUserId) return false;

    const room = getOrCreateRoom(roomName);
    if (room.destroyed) return false;

    const now = Date.now();
    room.doc.transact(() => {
      const membersMap = room.doc.getMap<Y.Map<unknown> | Record<string, unknown>>('members');
      const existingMember = membersMap.get(cleanUserId);
      if (existingMember instanceof Y.Map) {
        existingMember.set('left', true);
        existingMember.set('leftAt', now);
        existingMember.set('updatedAt', now);
      } else {
        const yMember = new Y.Map<unknown>();
        const prevObj = existingMember && typeof existingMember === 'object'
          ? (existingMember as Record<string, unknown>)
          : {};
        yMember.set('userId', cleanUserId);
        yMember.set('name', typeof prevObj.name === 'string' ? prevObj.name : 'Exmiembro');
        yMember.set('color', typeof prevObj.color === 'string' ? prevObj.color : '#6366f1');
        yMember.set('left', true);
        yMember.set('leftAt', now);
        yMember.set('updatedAt', now);
        membersMap.set(cleanUserId, yMember);
      }

      const cardsMap = room.doc.getMap<Y.Map<unknown> | Record<string, unknown>>('cards');
      for (const [cardId, rawCard] of cardsMap.entries()) {
        if (!rawCard || typeof rawCard !== 'object') continue;
        if (rawCard instanceof Y.Map) {
          const assignee = rawCard.get('assignee') as { userId?: string } | null | undefined;
          if (assignee && typeof assignee === 'object' && assignee.userId === cleanUserId) {
            rawCard.set('assignee', null);
            rawCard.set('updatedAt', now);
            if (rawCard.get('deleted') !== true) {
              rawCard.set('editCount', ((rawCard.get('editCount') as number) || 1) + 1);
            }
          }
        } else {
          const obj = rawCard as Record<string, unknown>;
          const assignee = obj.assignee as { userId?: string } | null | undefined;
          if (assignee && typeof assignee === 'object' && assignee.userId === cleanUserId) {
            cardsMap.set(cardId, {
              ...obj,
              assignee: null,
              updatedAt: now,
              ...(obj.deleted !== true
                ? { editCount: (typeof obj.editCount === 'number' ? obj.editCount : 1) + 1 }
                : {}),
            });
          }
        }
      }
    }, 'member-leave');

    if (room.conns.size === 0 && !room.idleTimer) {
      room.idleTimer = setTimeout(() => {
        evictRoom(roomName);
      }, roomIdleTtlMs);
      room.idleTimer.unref?.();
    }

    return true;
  }

  function broadcastBoardMeta(
    roomName: string,
    meta: { title: string; ownerId: string; ownerName: string; joinCode?: string }
  ): void {
    const room = rooms.get(roomName);
    if (!room || room.destroyed) return;

    room.conns.forEach(conn => {
      if (conn.readyState !== WebSocket.OPEN) return;
      const role = room.connRoles.get(conn) ?? 'member';
      const payload: ServerBoardMetaPayload = {
        boardId: roomName,
        title: meta.title,
        ownerId: meta.ownerId,
        ownerName: meta.ownerName,
        joinCode: meta.joinCode,
        role,
      };
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, WS_MESSAGE_TYPE.BOARD_META);
      encoding.writeVarString(encoder, JSON.stringify(payload));
      conn.send(encoding.toUint8Array(encoder));
    });
  }

  function destroyRoomAndNotify(
    roomName: string,
    closeCode: number = WS_CLOSE_CODE.BOARD_DELETED,
    reason: string = 'Tablero eliminado por su propietario'
  ): void {
    const room = rooms.get(roomName);
    if (!room || room.destroyed) return;

    room.destroyed = true;
    if (room.idleTimer) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }

    room.conns.forEach(conn => {
      try {
        if (conn.readyState === WebSocket.OPEN || conn.readyState === WebSocket.CONNECTING) {
          conn.close(closeCode, reason);
        }
      } catch {
        // Ignorar errores al cerrar sockets ya rotos
      }
    });

    room.conns.clear();
    room.connRoles.clear();
    room.connClientIds.clear();
    room.awareness.destroy();
    room.doc.destroy();
    rooms.delete(roomName);
  }

  function getRoomCount(): number {
    return rooms.size;
  }

  function closeAll(): void {
    for (const [roomName, room] of rooms.entries()) {
      room.destroyed = true;
      if (room.idleTimer) {
        clearTimeout(room.idleTimer);
        room.idleTimer = null;
      }
      try {
        if (room.updatesSinceCompact > 0 && !boardRepo.isBoardDeleted(roomName)) {
          boardRepo.compactRoomUpdates(roomName, room.doc);
        }
      } catch {
        // Ignorar en apagado
      }
      room.conns.forEach(conn => {
        try {
          conn.close(1001, 'Server shutting down');
        } catch {
          // Ignorar
        }
      });
      room.conns.clear();
      room.awareness.destroy();
      room.doc.destroy();
    }
    rooms.clear();
  }

  return {
    getOrCreateRoom,
    addConnection,
    removeConnection,
    removeMemberFromBoard,
    broadcastBoardMeta,
    destroyRoomAndNotify,
    getRoomCount,
    closeAll,
  };
}

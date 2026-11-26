import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import type * as decoding from 'lib0/decoding';
import { WebSocket } from 'ws';
import {
  WS_MESSAGE_TYPE,
  WS_CLOSE_CODE,
  sanitizeSingleLineText,
  type AssignableBoardRole,
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
  addConnection(roomName: string, conn: WebSocket, role: BoardRole, userId?: string): Room;
  removeConnection(roomName: string, conn: WebSocket): void;
  applyAuthorizedSyncMessage(
    roomName: string,
    conn: WebSocket,
    decoder: decoding.Decoder,
    replyEncoder: encoding.Encoder
  ): boolean;
  updateMemberRoleInBoard(
    roomName: string,
    userId: string,
    role: AssignableBoardRole,
    meta: { title: string; ownerId: string; ownerName: string; joinCode?: string }
  ): void;
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
      connUserIds: new Map(),
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

  function addConnection(roomName: string, conn: WebSocket, role: BoardRole, userId: string = ''): Room {
    const room = getOrCreateRoom(roomName);
    if (room.idleTimer) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }
    room.conns.add(conn);
    room.connRoles.set(conn, role);
    if (userId) {
      room.connUserIds.set(conn, userId);
    }
    room.connClientIds.set(conn, new Set());
    return room;
  }

  function removeConnection(roomName: string, conn: WebSocket): void {
    const room = rooms.get(roomName);
    if (!room || room.destroyed) return;

    const controlledIds = room.connClientIds.get(conn);
    room.conns.delete(conn);
    room.connRoles.delete(conn);
    room.connUserIds.delete(conn);
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

  function snapshotColumnsMap(
    columnsMap: Y.Map<Y.Map<unknown> | Record<string, unknown>>
  ): Map<string, Record<string, unknown>> {
    const snapshot = new Map<string, Record<string, unknown>>();
    for (const [colId, raw] of columnsMap.entries()) {
      if (!raw || typeof raw !== 'object') continue;
      const plain = raw instanceof Y.Map ? Object.fromEntries(raw.entries()) : { ...raw };
      snapshot.set(colId, plain);
    }
    return snapshot;
  }

  function areColumnsModified(
    prevSnapshot: Map<string, Record<string, unknown>>,
    columnsMap: Y.Map<Y.Map<unknown> | Record<string, unknown>>
  ): boolean {
    if (columnsMap.size !== prevSnapshot.size) return true;
    for (const [colId, prevPlain] of prevSnapshot.entries()) {
      const currentRaw = columnsMap.get(colId);
      if (!currentRaw || typeof currentRaw !== 'object') return true;
      const currentPlain =
        currentRaw instanceof Y.Map ? Object.fromEntries(currentRaw.entries()) : currentRaw;
      const prevKeys = Object.keys(prevPlain);
      const currKeys = Object.keys(currentPlain);
      if (prevKeys.length !== currKeys.length) return true;
      for (const k of prevKeys) {
        if (currentPlain[k] !== prevPlain[k]) return true;
      }
    }
    return false;
  }

  /**
   * Aplica un mensaje Yjs SYNC verificando permisos de escritura en `columnsMap`:
   * los usuarios con rol `member` no pueden alterar columnas; si llegan cambios offline
   * tras una degradación de rol, se revierten de forma autoritativa conservando tarjetas y comentarios.
   */
  function applyAuthorizedSyncMessage(
    roomName: string,
    conn: WebSocket,
    decoder: decoding.Decoder,
    replyEncoder: encoding.Encoder
  ): boolean {
    const room = rooms.get(roomName);
    if (!room || room.destroyed) return false;

    const role = room.connRoles.get(conn) ?? 'member';
    if (role === 'owner' || role === 'admin') {
      syncProtocol.readSyncMessage(decoder, replyEncoder, room.doc, conn);
      return false;
    }

    const columnsMap = room.doc.getMap<Y.Map<unknown> | Record<string, unknown>>('columns');
    const prevSnapshot = snapshotColumnsMap(columnsMap);

    syncProtocol.readSyncMessage(decoder, replyEncoder, room.doc, conn);

    if (!areColumnsModified(prevSnapshot, columnsMap)) {
      return false;
    }

    const fallbackColumnId = Array.from(prevSnapshot.entries()).find(
      ([, col]) => col.deleted !== true
    )?.[0];

    room.doc.transact(() => {
      for (const existingKey of Array.from(columnsMap.keys())) {
        if (!prevSnapshot.has(existingKey)) {
          columnsMap.delete(existingKey);
        }
      }

      for (const [colId, prevPlain] of prevSnapshot.entries()) {
        const yCol = new Y.Map<unknown>();
        for (const [field, val] of Object.entries(prevPlain)) {
          yCol.set(field, val);
        }
        columnsMap.set(colId, yCol);
      }

      if (fallbackColumnId) {
        const cardsMap = room.doc.getMap<Y.Map<unknown> | Record<string, unknown>>('cards');
        for (const [cardId, rawCard] of cardsMap.entries()) {
          if (!rawCard || typeof rawCard !== 'object') continue;
          const colId = rawCard instanceof Y.Map
            ? (rawCard.get('columnId') as string | undefined)
            : (rawCard.columnId as string | undefined);
          if (colId && !prevSnapshot.has(colId)) {
            if (rawCard instanceof Y.Map) {
              rawCard.set('columnId', fallbackColumnId);
            } else {
              cardsMap.set(cardId, { ...rawCard, columnId: fallbackColumnId });
            }
          }
        }
      }
    }, 'role-revert');

    return true;
  }

  /**
   * Actualiza en vivo el rol de un miembro en `membersMap` y en sus conexiones WebSocket activas.
   */
  function updateMemberRoleInBoard(
    roomName: string,
    userId: string,
    role: AssignableBoardRole,
    meta: { title: string; ownerId: string; ownerName: string; joinCode?: string }
  ): void {
    const cleanUserId = sanitizeSingleLineText(userId, 64);
    if (!cleanUserId) return;

    const room = getOrCreateRoom(roomName);
    if (room.destroyed) return;

    const now = Date.now();
    room.doc.transact(() => {
      const membersMap = room.doc.getMap<Y.Map<unknown> | Record<string, unknown>>('members');
      const existingMember = membersMap.get(cleanUserId);
      if (existingMember instanceof Y.Map) {
        existingMember.set('role', role);
        existingMember.set('updatedAt', now);
      } else if (existingMember && typeof existingMember === 'object') {
        const yMember = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(existingMember)) {
          yMember.set(k, v);
        }
        yMember.set('userId', cleanUserId);
        yMember.set('role', role);
        yMember.set('updatedAt', now);
        membersMap.set(cleanUserId, yMember);
      }
    }, 'role-update');

    room.conns.forEach(conn => {
      if (room.connUserIds.get(conn) !== cleanUserId) return;
      if (room.connRoles.get(conn) === 'owner') return;
      room.connRoles.set(conn, role);
      if (conn.readyState === WebSocket.OPEN) {
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
      }
    });

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
        existingMember.set('role', 'member');
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
    room.connUserIds.clear();
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
    applyAuthorizedSyncMessage,
    updateMemberRoleInBoard,
    removeMemberFromBoard,
    broadcastBoardMeta,
    destroyRoomAndNotify,
    getRoomCount,
    closeAll,
  };
}

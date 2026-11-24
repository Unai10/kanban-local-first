import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as Y from 'yjs';
import {
  ROOM_NAME_REGEX,
  LIMITS,
  generateJoinCode,
  isValidJoinCode,
  isValidTokenFormat,
  normalizeJoinCode,
  sanitizeSingleLineText,
  type BoardMetaSyncItem,
  type BoardMetaSyncRequestItem,
} from '@kanban/shared-types';
import type { BoardRole } from '../../types.js';

export interface BoardRecord {
  id: string;
  title: string;
  ownerId: string;
  ownerName: string;
  joinCode: string;
  createdAt: number;
}

export interface RegisterBoardInput {
  boardId: string;
  title?: string;
  inviteToken: string;
  ownerToken: string;
  ownerId: string;
  ownerName?: string;
  joinCode?: string;
}

export interface AuthorizeResult {
  valid: boolean;
  reason?: 'deleted' | 'invalid_token' | 'forbidden' | 'not_found';
  role?: BoardRole;
  title?: string;
  ownerId?: string;
  ownerName?: string;
  joinCode?: string;
}

export type FindByJoinCodeResult =
  | { valid: true; boardId: string; title: string; ownerName: string; joinCode: string }
  | { valid: false; deleted: boolean };

export type DeleteBoardResult = 'deleted' | 'forbidden' | 'not_found';

export type VerifyBoardAccessResult =
  | { valid: true; role: BoardRole; board: BoardRecord }
  | { valid: false; reason: 'deleted' | 'not_found' | 'forbidden' };

export type UpdateBoardTitleResult =
  | { ok: true; board: BoardRecord }
  | { ok: false; reason: 'invalid_input' | 'forbidden' | 'not_found' };

function hashToken(token: string): Buffer {
  return crypto.createHash('sha256').update(token, 'utf8').digest();
}

function timingSafeEqualBuffer(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function timingSafeEqualString(a: string, b: string): boolean {
  return timingSafeEqualBuffer(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export interface BoardRepository {
  registerBoard(input: RegisterBoardInput): { ok: true; board: BoardRecord } | { ok: false; reason: 'invalid_input' | 'deleted' | 'exists' };
  authorizeOrRegisterBoard(input: {
    boardId: string;
    title?: string;
    inviteToken: string;
    ownerToken?: string;
    joinCode?: string;
    ownerId?: string;
    ownerName?: string;
  }): AuthorizeResult;
  findBoardByJoinCode(code: string): FindByJoinCodeResult;
  verifyBoardAccess(
    boardId: string,
    creds: { ownerToken?: string; inviteToken?: string; joinCode?: string }
  ): VerifyBoardAccessResult;
  updateBoardTitle(boardId: string, ownerToken: string, title: string): UpdateBoardTitleResult;
  updateOwnerNameForBoards(
    ownerId: string,
    ownerName: string,
    credentials: Array<{ boardId: string; ownerToken: string }>
  ): BoardRecord[];
  getBoardsMetadata(items: BoardMetaSyncRequestItem[]): BoardMetaSyncItem[];
  deleteBoard(boardId: string, ownerToken: string): DeleteBoardResult;
  getBoard(boardId: string): BoardRecord | null;
  isBoardDeleted(boardId: string): boolean;
  saveUpdate(roomName: string, update: Uint8Array): void;
  loadDocument(roomName: string, ydoc: Y.Doc): number;
  compactRoomUpdates(roomName: string, ydoc: Y.Doc): void;
  close(): void;
}

/**
 * Crea el repositorio SQLite para tableros, tokens hasheados (SHA-256),
 * lista negra de tableros eliminados y deltas/snapshots binarios de Yjs.
 */
export function createBoardRepository(dbPath: string): BoardRepository {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS document_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_name TEXT NOT NULL,
      update_data BLOB NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_room_name ON document_updates(room_name);

    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      invite_token_hash BLOB NOT NULL,
      owner_token_hash BLOB NOT NULL,
      owner_id TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      join_code TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deleted_boards (
      id TEXT PRIMARY KEY,
      join_code TEXT,
      deleted_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deleted_join_code ON deleted_boards(join_code);
  `);

  const insertBoardStmt = db.prepare<[string, string, Buffer, Buffer, string, string, string, number]>(`
    INSERT INTO boards (id, title, invite_token_hash, owner_token_hash, owner_id, owner_name, join_code, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getBoardRowStmt = db.prepare<[string], {
    id: string;
    title: string;
    invite_token_hash: Buffer;
    owner_token_hash: Buffer;
    owner_id: string;
    owner_name: string;
    join_code: string;
    created_at: number;
  }>(`
    SELECT id, title, invite_token_hash, owner_token_hash, owner_id, owner_name, join_code, created_at
    FROM boards WHERE id = ?
  `);

  const getBoardByJoinCodeStmt = db.prepare<[string], {
    id: string;
    title: string;
    owner_name: string;
    join_code: string;
  }>(`
    SELECT id, title, owner_name, join_code FROM boards WHERE join_code = ?
  `);

  const getDeletedBoardStmt = db.prepare<[string], { id: string }>(`
    SELECT id FROM deleted_boards WHERE id = ?
  `);

  const getDeletedByJoinCodeStmt = db.prepare<[string], { id: string }>(`
    SELECT id FROM deleted_boards WHERE join_code = ?
  `);

  const insertDeletedBoardStmt = db.prepare<[string, string | null, number]>(`
    INSERT OR REPLACE INTO deleted_boards (id, join_code, deleted_at) VALUES (?, ?, ?)
  `);

  const deleteBoardStmt = db.prepare<[string]>(`
    DELETE FROM boards WHERE id = ?
  `);

  const updateBoardTitleStmt = db.prepare<[string, string]>(`
    UPDATE boards SET title = ? WHERE id = ?
  `);

  const updateBoardOwnerNameStmt = db.prepare<[string, string]>(`
    UPDATE boards SET owner_name = ? WHERE id = ?
  `);

  const insertUpdateStmt = db.prepare<[string, Buffer, number]>(`
    INSERT INTO document_updates (room_name, update_data, created_at) VALUES (?, ?, ?)
  `);

  const getUpdatesByRoomStmt = db.prepare<[string], { update_data: Buffer }>(`
    SELECT update_data FROM document_updates WHERE room_name = ? ORDER BY id ASC
  `);

  const deleteUpdatesByRoomStmt = db.prepare<[string]>(`
    DELETE FROM document_updates WHERE room_name = ?
  `);

  function allocateJoinCode(preferred?: string): string {
    if (preferred) {
      const normalized = normalizeJoinCode(preferred);
      if (
        isValidJoinCode(normalized) &&
        !getBoardByJoinCodeStmt.get(normalized) &&
        !getDeletedByJoinCodeStmt.get(normalized)
      ) {
        return normalized;
      }
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateJoinCode();
      if (!getBoardByJoinCodeStmt.get(candidate) && !getDeletedByJoinCodeStmt.get(candidate)) {
        return candidate;
      }
    }
    return generateJoinCode();
  }

  function registerBoard(input: RegisterBoardInput): { ok: true; board: BoardRecord } | { ok: false; reason: 'invalid_input' | 'deleted' | 'exists' } {
    if (!ROOM_NAME_REGEX.test(input.boardId)) {
      return { ok: false, reason: 'invalid_input' };
    }
    if (!isValidTokenFormat(input.inviteToken) || !isValidTokenFormat(input.ownerToken)) {
      return { ok: false, reason: 'invalid_input' };
    }
    if (input.inviteToken === input.ownerToken) {
      return { ok: false, reason: 'invalid_input' };
    }
    const cleanOwnerId = sanitizeSingleLineText(input.ownerId, 64);
    if (!cleanOwnerId) {
      return { ok: false, reason: 'invalid_input' };
    }

    if (getDeletedBoardStmt.get(input.boardId)) {
      return { ok: false, reason: 'deleted' };
    }
    if (getBoardRowStmt.get(input.boardId)) {
      return { ok: false, reason: 'exists' };
    }

    const cleanTitle = sanitizeSingleLineText(input.title, LIMITS.BOARD_TITLE_MAX, 'Tablero Kanban');
    const cleanOwnerName = sanitizeSingleLineText(input.ownerName, LIMITS.USER_NAME_MAX, 'Propietario');
    const joinCode = allocateJoinCode(input.joinCode);
    const now = Date.now();

    insertBoardStmt.run(
      input.boardId,
      cleanTitle,
      hashToken(input.inviteToken),
      hashToken(input.ownerToken),
      cleanOwnerId,
      cleanOwnerName,
      joinCode,
      now
    );

    return {
      ok: true,
      board: {
        id: input.boardId,
        title: cleanTitle,
        ownerId: cleanOwnerId,
        ownerName: cleanOwnerName,
        joinCode,
        createdAt: now,
      },
    };
  }

  function authorizeOrRegisterBoard(input: {
    boardId: string;
    title?: string;
    inviteToken: string;
    ownerToken?: string;
    joinCode?: string;
    ownerId?: string;
    ownerName?: string;
  }): AuthorizeResult {
    if (!ROOM_NAME_REGEX.test(input.boardId)) {
      return { valid: false, reason: 'forbidden' };
    }

    if (getDeletedBoardStmt.get(input.boardId)) {
      return { valid: false, reason: 'deleted' };
    }

    const existing = getBoardRowStmt.get(input.boardId);
    if (!existing) {
      if (!input.ownerToken || !input.ownerId) {
        return { valid: false, reason: 'not_found' };
      }
      const created = registerBoard({
        boardId: input.boardId,
        title: input.title,
        inviteToken: input.inviteToken,
        ownerToken: input.ownerToken,
        ownerId: input.ownerId,
        ownerName: input.ownerName,
        joinCode: input.joinCode,
      });
      if (!created.ok) {
        return { valid: false, reason: created.reason === 'deleted' ? 'deleted' : 'invalid_token' };
      }
      return {
        valid: true,
        role: 'owner',
        title: created.board.title,
        ownerId: created.board.ownerId,
        ownerName: created.board.ownerName,
        joinCode: created.board.joinCode,
      };
    }

    const role = verifyBoardCredential(existing, input);
    if (role) {
      return {
        valid: true,
        role,
        title: existing.title,
        ownerId: existing.owner_id,
        ownerName: existing.owner_name,
        joinCode: existing.join_code,
      };
    }

    return { valid: false, reason: 'forbidden' };
  }

  function verifyBoardCredential(
    existing: { owner_token_hash: Buffer; invite_token_hash: Buffer; join_code: string },
    creds: { ownerToken?: string; inviteToken?: string; joinCode?: string }
  ): BoardRole | null {
    if (creds.ownerToken && isValidTokenFormat(creds.ownerToken)) {
      const providedOwnerHash = hashToken(creds.ownerToken);
      if (timingSafeEqualBuffer(providedOwnerHash, existing.owner_token_hash)) {
        return 'owner';
      }
    }

    if (creds.inviteToken && isValidTokenFormat(creds.inviteToken)) {
      const providedInviteHash = hashToken(creds.inviteToken);
      if (timingSafeEqualBuffer(providedInviteHash, existing.invite_token_hash)) {
        return 'member';
      }
    }

    if (creds.joinCode) {
      const normalized = normalizeJoinCode(creds.joinCode);
      if (isValidJoinCode(normalized) && timingSafeEqualString(normalized, existing.join_code)) {
        return 'member';
      }
    }

    return null;
  }

  /**
   * Verifica credenciales de acceso sobre un tablero existente sin crearlo.
   */
  function verifyBoardAccess(
    boardId: string,
    creds: { ownerToken?: string; inviteToken?: string; joinCode?: string }
  ): VerifyBoardAccessResult {
    if (!ROOM_NAME_REGEX.test(boardId)) {
      return { valid: false, reason: 'forbidden' };
    }
    if (getDeletedBoardStmt.get(boardId)) {
      return { valid: false, reason: 'deleted' };
    }
    const existing = getBoardRowStmt.get(boardId);
    if (!existing) {
      return { valid: false, reason: 'not_found' };
    }
    const role = verifyBoardCredential(existing, creds);
    if (!role) {
      return { valid: false, reason: 'forbidden' };
    }
    return {
      valid: true,
      role,
      board: {
        id: existing.id,
        title: existing.title,
        ownerId: existing.owner_id,
        ownerName: existing.owner_name,
        joinCode: existing.join_code,
        createdAt: existing.created_at,
      },
    };
  }

  function updateBoardTitle(boardId: string, ownerToken: string, rawTitle: string): UpdateBoardTitleResult {
    if (!ROOM_NAME_REGEX.test(boardId)) {
      return { ok: false, reason: 'invalid_input' };
    }
    if (!isValidTokenFormat(ownerToken)) {
      return { ok: false, reason: 'forbidden' };
    }

    const existing = getBoardRowStmt.get(boardId);
    if (!existing) {
      return { ok: false, reason: 'not_found' };
    }

    const providedHash = hashToken(ownerToken);
    if (!timingSafeEqualBuffer(providedHash, existing.owner_token_hash)) {
      return { ok: false, reason: 'forbidden' };
    }

    const cleanTitle = sanitizeSingleLineText(rawTitle, LIMITS.BOARD_TITLE_MAX, '');
    if (!cleanTitle) {
      return { ok: false, reason: 'invalid_input' };
    }

    updateBoardTitleStmt.run(cleanTitle, boardId);
    return {
      ok: true,
      board: {
        id: existing.id,
        title: cleanTitle,
        ownerId: existing.owner_id,
        ownerName: existing.owner_name,
        joinCode: existing.join_code,
        createdAt: existing.created_at,
      },
    };
  }

  function updateOwnerNameForBoards(
    ownerId: string,
    rawOwnerName: string,
    credentials: Array<{ boardId: string; ownerToken: string }>
  ): BoardRecord[] {
    const cleanOwnerId = sanitizeSingleLineText(ownerId, 64);
    const cleanOwnerName = sanitizeSingleLineText(rawOwnerName, LIMITS.USER_NAME_MAX, '');
    if (!cleanOwnerId || !cleanOwnerName || !Array.isArray(credentials) || credentials.length === 0) {
      return [];
    }

    const updated: BoardRecord[] = [];
    const seen = new Set<string>();

    db.transaction(() => {
      for (const item of credentials.slice(0, 100)) {
        if (!item || typeof item.boardId !== 'string' || typeof item.ownerToken !== 'string') continue;
        if (seen.has(item.boardId) || !ROOM_NAME_REGEX.test(item.boardId) || !isValidTokenFormat(item.ownerToken)) {
          continue;
        }
        seen.add(item.boardId);

        const existing = getBoardRowStmt.get(item.boardId);
        if (!existing || existing.owner_id !== cleanOwnerId) continue;

        const providedHash = hashToken(item.ownerToken);
        if (!timingSafeEqualBuffer(providedHash, existing.owner_token_hash)) continue;

        updateBoardOwnerNameStmt.run(cleanOwnerName, existing.id);
        updated.push({
          id: existing.id,
          title: existing.title,
          ownerId: existing.owner_id,
          ownerName: cleanOwnerName,
          joinCode: existing.join_code,
          createdAt: existing.created_at,
        });
      }
    })();

    return updated;
  }

  function getBoardsMetadata(items: BoardMetaSyncRequestItem[]): BoardMetaSyncItem[] {
    if (!Array.isArray(items) || items.length === 0) return [];
    const results: BoardMetaSyncItem[] = [];
    const seen = new Set<string>();

    for (const item of items.slice(0, 100)) {
      if (!item || typeof item.boardId !== 'string' || !ROOM_NAME_REGEX.test(item.boardId)) continue;
      if (seen.has(item.boardId)) continue;
      seen.add(item.boardId);

      if (getDeletedBoardStmt.get(item.boardId)) {
        results.push({ boardId: item.boardId, deleted: true });
        continue;
      }

      const existing = getBoardRowStmt.get(item.boardId);
      if (!existing) continue;

      const role = verifyBoardCredential(existing, item);
      if (!role) continue;

      results.push({
        boardId: existing.id,
        title: existing.title,
        ownerId: existing.owner_id,
        ownerName: existing.owner_name,
        joinCode: existing.join_code,
        role,
      });
    }

    return results;
  }

  function findBoardByJoinCode(code: string): FindByJoinCodeResult {
    const normalized = normalizeJoinCode(code);
    if (isValidJoinCode(normalized)) {
      if (getDeletedByJoinCodeStmt.get(normalized)) {
        return { valid: false, deleted: true };
      }
      const row = getBoardByJoinCodeStmt.get(normalized);
      if (row) {
        return {
          valid: true,
          boardId: row.id,
          title: row.title,
          ownerName: row.owner_name,
          joinCode: row.join_code,
        };
      }
    }
    return { valid: false, deleted: false };
  }

  function deleteBoard(boardId: string, ownerToken: string): DeleteBoardResult {
    const existing = getBoardRowStmt.get(boardId);
    if (!existing) return 'not_found';

    if (!isValidTokenFormat(ownerToken)) {
      return 'forbidden';
    }

    const providedHash = hashToken(ownerToken);
    if (!timingSafeEqualBuffer(providedHash, existing.owner_token_hash)) {
      return 'forbidden';
    }

    const now = Date.now();
    db.transaction(() => {
      deleteBoardStmt.run(boardId);
      deleteUpdatesByRoomStmt.run(boardId);
      insertDeletedBoardStmt.run(boardId, existing.join_code, now);
    })();

    return 'deleted';
  }

  function getBoard(boardId: string): BoardRecord | null {
    const row = getBoardRowStmt.get(boardId);
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      joinCode: row.join_code,
      createdAt: row.created_at,
    };
  }

  function isBoardDeleted(boardId: string): boolean {
    return Boolean(getDeletedBoardStmt.get(boardId));
  }

  function saveUpdate(roomName: string, update: Uint8Array): void {
    insertUpdateStmt.run(roomName, Buffer.from(update), Date.now());
  }

  function loadDocument(roomName: string, ydoc: Y.Doc): number {
    const rows = getUpdatesByRoomStmt.all(roomName);
    if (rows.length === 0) return 0;

    const updates = rows.map(r => new Uint8Array(r.update_data));
    const mergedUpdate = Y.mergeUpdates(updates);
    Y.applyUpdate(ydoc, mergedUpdate, 'db-load');

    if (rows.length > 50) {
      compactRoomUpdates(roomName, ydoc);
      return 1;
    }
    return rows.length;
  }

  function compactRoomUpdates(roomName: string, ydoc: Y.Doc): void {
    const snapshot = Y.encodeStateAsUpdate(ydoc);
    const now = Date.now();
    db.transaction(() => {
      deleteUpdatesByRoomStmt.run(roomName);
      insertUpdateStmt.run(roomName, Buffer.from(snapshot), now);
    })();
  }

  function close(): void {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // Ignorar si ya estaba cerrada
    }
    db.close();
  }

  return {
    registerBoard,
    authorizeOrRegisterBoard,
    findBoardByJoinCode,
    verifyBoardAccess,
    updateBoardTitle,
    updateOwnerNameForBoards,
    getBoardsMetadata,
    deleteBoard,
    getBoard,
    isBoardDeleted,
    saveUpdate,
    loadDocument,
    compactRoomUpdates,
    close,
  };
}

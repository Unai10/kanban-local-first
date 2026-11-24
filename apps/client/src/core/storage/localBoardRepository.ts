import {
  LIMITS,
  ROOM_NAME_REGEX,
  generateJoinCode,
  generateSecureId,
  generateSecureToken,
  isValidJoinCode,
  isValidTokenFormat,
  sanitizeSingleLineText,
  type BoardMetaSyncItem,
  type UserBoardEntry,
} from '@kanban/shared-types';
import { LocalUserRepository } from './localUserRepository.js';

const BOARDS_STORAGE_KEY = 'kanban_local_user_boards';
const ACTIVE_BOARD_KEY = 'kanban_active_board_id';

export interface InitialBoardResolution {
  boardId: string;
  inviteToken: string;
  ownerToken?: string;
  joinCode?: string;
  title: string;
  role: 'owner' | 'member';
  ownerId?: string;
  ownerName?: string;
  seedDemoCards?: boolean;
}

function parseBoardParamsFromLocation(): {
  boardId: string | null;
  token: string | null;
  ownerId: string;
  ownerName: string;
  hadSensitiveUrlParams: boolean;
} {
  const hashRaw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hashRaw);
  const searchParams = new URLSearchParams(window.location.search);

  const boardId = hashParams.get('board') || searchParams.get('board');
  const token = hashParams.get('token') || searchParams.get('token');
  const ownerId = sanitizeSingleLineText(hashParams.get('ownerId') || searchParams.get('ownerId') || '', 64);
  const ownerName = sanitizeSingleLineText(
    hashParams.get('ownerName') || searchParams.get('ownerName') || '',
    LIMITS.USER_NAME_MAX
  );

  const hadSensitiveUrlParams = Boolean(
    hashParams.has('token') ||
    searchParams.has('token') ||
    hashParams.has('ownerId') ||
    searchParams.has('ownerId') ||
    hashParams.has('ownerName') ||
    searchParams.has('ownerName')
  );

  return { boardId, token, ownerId, ownerName, hadSensitiveUrlParams };
}

/**
 * Repositorio local en `localStorage` para el historial de tableros del usuario,
 * tokens de acceso/propiedad y notificaciones de cambios pendientes para el sidebar.
 */
export const LocalBoardRepository = {
  getRegisteredBoards(): UserBoardEntry[] {
    try {
      const raw = localStorage.getItem(BOARDS_STORAGE_KEY);
      if (raw) {
        const user = LocalUserRepository.getUserProfile();
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return [];

        return list
          .filter((b): b is UserBoardEntry => Boolean(b && typeof b.id === 'string' && ROOM_NAME_REGEX.test(b.id)))
          .map(b => {
            const isOwner = isValidTokenFormat(b.ownerToken);
            const cleanPrevTitle = b.previousTitle
              ? sanitizeSingleLineText(b.previousTitle, LIMITS.BOARD_TITLE_MAX, '')
              : undefined;
            const cleanPrevOwner = b.previousOwnerName
              ? sanitizeSingleLineText(b.previousOwnerName, LIMITS.USER_NAME_MAX, '')
              : undefined;
            return {
              ...b,
              title: sanitizeSingleLineText(b.title, LIMITS.BOARD_TITLE_MAX, 'Tablero'),
              role: isOwner ? 'owner' : 'member',
              ownerName: isOwner
                ? user.name
                : sanitizeSingleLineText(b.ownerName, LIMITS.USER_NAME_MAX, 'Propietario'),
              ownerToken: isOwner ? b.ownerToken : undefined,
              joinCode: isValidJoinCode(b.joinCode) ? b.joinCode : undefined,
              previousTitle: cleanPrevTitle || undefined,
              previousOwnerName: isOwner ? undefined : (cleanPrevOwner || undefined),
              pendingTitleSync: isOwner ? Boolean(b.pendingTitleSync) : undefined,
            };
          });
      }
    } catch (err) {
      console.warn('[BoardRepository] Error leyendo tableros de localStorage', err);
    }
    return [];
  },

  saveRegisteredBoard(entry: UserBoardEntry): void {
    const current = LocalBoardRepository.getRegisteredBoards();
    const index = current.findIndex(b => b.id === entry.id);

    const sanitizedEntry: UserBoardEntry = {
      ...entry,
      title: sanitizeSingleLineText(entry.title, LIMITS.BOARD_TITLE_MAX, 'Tablero'),
      ownerName: entry.ownerName
        ? sanitizeSingleLineText(entry.ownerName, LIMITS.USER_NAME_MAX, 'Propietario')
        : undefined,
      lastOpenedAt: Date.now(),
    };

    if (index >= 0) {
      current[index] = {
        ...current[index],
        ...sanitizedEntry,
      };
    } else {
      current.unshift(sanitizedEntry);
    }

    localStorage.setItem(BOARDS_STORAGE_KEY, JSON.stringify(current));
  },

  updateBoardMetadata(
    boardId: string,
    meta: {
      title?: string;
      ownerId?: string;
      ownerName?: string;
      joinCode?: string;
      role?: 'owner' | 'member';
      previousTitle?: string | null;
      previousOwnerName?: string | null;
      pendingTitleSync?: boolean;
    }
  ): void {
    const current = LocalBoardRepository.getRegisteredBoards();
    const index = current.findIndex(b => b.id === boardId);
    if (index >= 0) {
      if (meta.title) {
        current[index].title = sanitizeSingleLineText(meta.title, LIMITS.BOARD_TITLE_MAX, current[index].title);
      }
      if (meta.ownerId !== undefined) {
        current[index].ownerId = meta.ownerId;
      }
      if (meta.ownerName !== undefined) {
        current[index].ownerName = sanitizeSingleLineText(meta.ownerName, LIMITS.USER_NAME_MAX, 'Propietario');
      }
      if (isValidJoinCode(meta.joinCode)) {
        current[index].joinCode = meta.joinCode;
      }
      if (meta.role !== undefined) {
        current[index].role = meta.role;
      }
      if (meta.previousTitle === null) {
        delete current[index].previousTitle;
      } else if (meta.previousTitle !== undefined) {
        current[index].previousTitle = sanitizeSingleLineText(meta.previousTitle, LIMITS.BOARD_TITLE_MAX, '') || undefined;
      }
      if (meta.previousOwnerName === null) {
        delete current[index].previousOwnerName;
      } else if (meta.previousOwnerName !== undefined) {
        current[index].previousOwnerName = sanitizeSingleLineText(meta.previousOwnerName, LIMITS.USER_NAME_MAX, '') || undefined;
      }
      if (meta.pendingTitleSync !== undefined) {
        current[index].pendingTitleSync = meta.pendingTitleSync;
      }
      localStorage.setItem(BOARDS_STORAGE_KEY, JSON.stringify(current));
    }
  },

  clearBoardMetaNotifications(boardId: string): void {
    const current = LocalBoardRepository.getRegisteredBoards();
    const index = current.findIndex(b => b.id === boardId);
    if (index >= 0 && (current[index].previousTitle || current[index].previousOwnerName)) {
      delete current[index].previousTitle;
      delete current[index].previousOwnerName;
      localStorage.setItem(BOARDS_STORAGE_KEY, JSON.stringify(current));
    }
  },

  applyRemoteBoardMetadata(
    items: BoardMetaSyncItem[],
    activeBoardId: string,
    isOnline: boolean
  ): {
    deletedBoardIds: string[];
    activeBoardChanged: {
      oldTitle?: string;
      newTitle?: string;
      oldOwnerName?: string;
      newOwnerName?: string;
    } | null;
  } {
    const current = LocalBoardRepository.getRegisteredBoards();
    const byId = new Map(items.map(item => [item.boardId, item]));
    const deletedBoardIds: string[] = [];
    let activeBoardChanged: {
      oldTitle?: string;
      newTitle?: string;
      oldOwnerName?: string;
      newOwnerName?: string;
    } | null = null;
    let dirty = false;

    const nextBoards: UserBoardEntry[] = [];

    for (const board of current) {
      const remote = byId.get(board.id);
      if (!remote) {
        nextBoards.push(board);
        continue;
      }

      if (remote.deleted) {
        deletedBoardIds.push(board.id);
        dirty = true;
        continue;
      }

      const updated: UserBoardEntry = { ...board };
      const nextTitle = remote.title
        ? sanitizeSingleLineText(remote.title, LIMITS.BOARD_TITLE_MAX, board.title)
        : board.title;
      const nextOwnerName = remote.ownerName
        ? sanitizeSingleLineText(remote.ownerName, LIMITS.USER_NAME_MAX, board.ownerName || 'Propietario')
        : board.ownerName;

      if (remote.ownerId !== undefined && remote.ownerId !== updated.ownerId) {
        updated.ownerId = remote.ownerId;
        dirty = true;
      }
      if (isValidJoinCode(remote.joinCode) && remote.joinCode !== updated.joinCode) {
        updated.joinCode = remote.joinCode;
        dirty = true;
      }

      const isActiveOnline = board.id === activeBoardId && isOnline;
      const skipTitleOverwrite = updated.role === 'owner' && updated.pendingTitleSync;

      if (!skipTitleOverwrite && nextTitle !== board.title) {
        dirty = true;
        if (isActiveOnline) {
          activeBoardChanged = {
            ...(activeBoardChanged ?? {}),
            oldTitle: board.previousTitle ?? board.title,
            newTitle: nextTitle,
          };
          delete updated.previousTitle;
        } else {
          const originalTitle = board.previousTitle ?? board.title;
          if (originalTitle === nextTitle) {
            delete updated.previousTitle;
          } else {
            updated.previousTitle = originalTitle;
          }
        }
        updated.title = nextTitle;
      } else if (isActiveOnline && updated.previousTitle) {
        delete updated.previousTitle;
        dirty = true;
      }

      if (updated.role === 'owner' && updated.pendingTitleSync && nextTitle === board.title) {
        updated.pendingTitleSync = false;
        dirty = true;
      }

      if (updated.role !== 'owner' && nextOwnerName && nextOwnerName !== board.ownerName) {
        dirty = true;
        if (isActiveOnline) {
          activeBoardChanged = {
            ...(activeBoardChanged ?? {}),
            oldOwnerName: board.previousOwnerName ?? board.ownerName,
            newOwnerName: nextOwnerName,
          };
          delete updated.previousOwnerName;
        } else {
          const originalOwner = board.previousOwnerName ?? board.ownerName;
          if (originalOwner === nextOwnerName) {
            delete updated.previousOwnerName;
          } else {
            updated.previousOwnerName = originalOwner;
          }
        }
        updated.ownerName = nextOwnerName;
      } else if (isActiveOnline && updated.previousOwnerName) {
        delete updated.previousOwnerName;
        dirty = true;
      }

      nextBoards.push(updated);
    }

    if (dirty) {
      localStorage.setItem(BOARDS_STORAGE_KEY, JSON.stringify(nextBoards));
    }

    return { deletedBoardIds, activeBoardChanged };
  },

  deleteRegisteredBoard(boardId: string): void {
    const current = LocalBoardRepository.getRegisteredBoards().filter(b => b.id !== boardId);
    localStorage.setItem(BOARDS_STORAGE_KEY, JSON.stringify(current));
  },

  resolveInitialBoard(): InitialBoardResolution {
    const user = LocalUserRepository.getUserProfile();
    const { boardId: urlBoard, token: urlToken, ownerId: urlOwnerId, ownerName: urlOwnerName, hadSensitiveUrlParams } =
      parseBoardParamsFromLocation();

    // CASO 1: Acceso mediante enlace (#board=...&token=... o fallback query)
    if (urlBoard && ROOM_NAME_REGEX.test(urlBoard)) {
      const boards = LocalBoardRepository.getRegisteredBoards();
      const existing = boards.find(b => b.id === urlBoard);

      if (existing || isValidTokenFormat(urlToken)) {
        const inviteToken = isValidTokenFormat(urlToken)
          ? urlToken
          : existing!.inviteToken;
        const ownerToken = isValidTokenFormat(existing?.ownerToken) ? existing!.ownerToken : undefined;
        const title = existing?.title || 'Tablero Compartido';
        const realOwnerId = existing?.ownerId || urlOwnerId || '';
        const realOwnerName = existing?.ownerName || urlOwnerName || (realOwnerId === user.id ? user.name : 'Propietario');
        const isOwner = Boolean(ownerToken);
        const role: 'owner' | 'member' = isOwner ? 'owner' : 'member';

        LocalBoardRepository.saveRegisteredBoard({
          id: urlBoard,
          title,
          role,
          ownerId: realOwnerId || (isOwner ? user.id : ''),
          ownerName: isOwner ? user.name : realOwnerName,
          inviteToken,
          ownerToken,
          joinCode: existing?.joinCode,
          lastOpenedAt: Date.now(),
        });

        localStorage.setItem(ACTIVE_BOARD_KEY, urlBoard);

        if (hadSensitiveUrlParams) {
          window.history.replaceState({}, '', `${window.location.pathname}?board=${encodeURIComponent(urlBoard)}`);
        }

        return {
          boardId: urlBoard,
          inviteToken,
          ownerToken,
          joinCode: existing?.joinCode,
          title,
          role,
          ownerId: realOwnerId,
          ownerName: isOwner ? user.name : realOwnerName,
        };
      }
    }

    // CASO 2: Último tablero activo del usuario local
    const lastActiveId = localStorage.getItem(ACTIVE_BOARD_KEY);
    const boards = LocalBoardRepository.getRegisteredBoards();
    const myOwnBoard = boards.find(b => b.role === 'owner');
    const lastBoard = boards.find(b => b.id === lastActiveId) || myOwnBoard || boards[0];

    if (lastBoard) {
      const isOwner = lastBoard.role === 'owner';
      return {
        boardId: lastBoard.id,
        inviteToken: lastBoard.inviteToken,
        ownerToken: lastBoard.ownerToken,
        joinCode: lastBoard.joinCode,
        title: lastBoard.title,
        role: isOwner ? 'owner' : 'member',
        ownerId: lastBoard.ownerId,
        ownerName: isOwner ? user.name : (lastBoard.ownerName || 'Propietario'),
      };
    }

    // CASO 3: Usuario nuevo -> Crea su propio tablero local privado con par de tokens separados y joinCode
    const myFirstBoard: UserBoardEntry = {
      id: generateSecureId('tablero'),
      title: 'Mi Tablero',
      role: 'owner',
      ownerId: user.id,
      ownerName: user.name,
      inviteToken: generateSecureToken(),
      ownerToken: generateSecureToken(),
      joinCode: generateJoinCode(),
      lastOpenedAt: Date.now(),
    };

    LocalBoardRepository.saveRegisteredBoard(myFirstBoard);
    localStorage.setItem(ACTIVE_BOARD_KEY, myFirstBoard.id);
    window.history.replaceState({}, '', `${window.location.pathname}?board=${encodeURIComponent(myFirstBoard.id)}`);

    return {
      boardId: myFirstBoard.id,
      inviteToken: myFirstBoard.inviteToken,
      ownerToken: myFirstBoard.ownerToken,
      joinCode: myFirstBoard.joinCode,
      title: myFirstBoard.title,
      role: 'owner',
      ownerId: user.id,
      ownerName: user.name,
      seedDemoCards: true,
    };
  },

  setActiveBoardId(boardId: string): void {
    localStorage.setItem(ACTIVE_BOARD_KEY, boardId);
  },

  navigateToBoard(boardId: string): void {
    localStorage.setItem(ACTIVE_BOARD_KEY, boardId);
    const newUrl = `${window.location.pathname}?board=${encodeURIComponent(boardId)}`;
    window.history.pushState({}, '', newUrl);
  },
};

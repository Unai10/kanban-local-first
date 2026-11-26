import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  LIMITS,
  generateJoinCode,
  generateNKeysBetween,
  generateSecureToken,
  generateUuid,
  isValidTokenFormat,
  sanitizeHexColor,
  sanitizeSingleLineText,
  type AssignableBoardRole,
  type BoardExportSnapshot,
  type BoardMetaSyncItem,
  type BoardRole,
  type BoardTemplateId,
  type ServerBoardMetaPayload,
  type UserBoardEntry,
  type UserProfile,
} from '@kanban/shared-types';
import {
  LocalBoardRepository,
  type InitialBoardResolution,
} from '../../../core/storage/localBoardRepository.js';
import { AVATAR_COLORS, LocalUserRepository } from '../../../core/storage/localUserRepository.js';
import { deleteBoardIndexedDb } from '../../../core/yjs/YjsRoomClient.js';
import { APP_CONFIG } from '../../../core/config/env.js';
import { BoardContext, type AppTheme, type BoardContextValue } from './BoardContext.js';

const THEME_STORAGE_KEY = 'kanban_theme';

const PENDING_OWNER_NAME_SYNC_KEY = 'kanban_pending_owner_name_sync';
const PENDING_BOARD_LEAVES_KEY = 'kanban_pending_board_leaves';

interface PendingBoardLeave {
  boardId: string;
  userId: string;
  inviteToken?: string;
  ownerToken?: string;
  joinCode?: string;
}

function readPendingBoardLeaves(): PendingBoardLeave[] {
  try {
    const raw = localStorage.getItem(PENDING_BOARD_LEAVES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingBoardLeaves(items: PendingBoardLeave[]): void {
  if (items.length === 0) {
    localStorage.removeItem(PENDING_BOARD_LEAVES_KEY);
    return;
  }
  localStorage.setItem(PENDING_BOARD_LEAVES_KEY, JSON.stringify(items));
}

async function sendBoardLeaveRequest(item: PendingBoardLeave): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  try {
    const response = await fetch(
      `${APP_CONFIG.getHttpApiUrl()}/api/boards/${encodeURIComponent(item.boardId)}/leave`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: item.userId,
          inviteToken: item.inviteToken || undefined,
          ownerToken: item.ownerToken || undefined,
          joinCode: item.joinCode || undefined,
        }),
      }
    );
    return response.ok || response.status === 403 || response.status === 404 || response.status === 410;
  } catch {
    return false;
  }
}

function formatBoardUpdateNotice(change: {
  oldTitle?: string;
  newTitle?: string;
  oldOwnerName?: string;
  newOwnerName?: string;
}): string | null {
  const titleChanged = Boolean(change.oldTitle && change.newTitle && change.oldTitle !== change.newTitle);
  const ownerChanged = Boolean(change.oldOwnerName && change.newOwnerName && change.oldOwnerName !== change.newOwnerName);
  if (titleChanged && ownerChanged) {
    return `El tablero "${change.oldTitle}" ahora se llama "${change.newTitle}" y su propietario pasó de "${change.oldOwnerName}" a "${change.newOwnerName}".`;
  }
  if (titleChanged) {
    return `El tablero "${change.oldTitle}" se actualizó a "${change.newTitle}".`;
  }
  if (ownerChanged) {
    return `El propietario de este tablero cambió su nombre de "${change.oldOwnerName}" a "${change.newOwnerName}".`;
  }
  return null;
}

/**
 * Proveedor de contexto global de tableros: gestiona el tablero activo, perfil local,
 * sincronización de metadatos del sidebar, renombrado, creación, unión y abandono/borrado.
 */
export function BoardProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserProfile>(() =>
    LocalUserRepository.getUserProfile()
  );
  const [boardInfo, setBoardInfo] = useState<InitialBoardResolution>(() =>
    LocalBoardRepository.resolveInitialBoard()
  );
  const [boards, setBoards] = useState<UserBoardEntry[]>(() =>
    LocalBoardRepository.getRegisteredBoards()
  );

  const [theme, setTheme] = useState<AppTheme>(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isCreateBoardModalOpen, setIsCreateBoardModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isRolesModalOpen, setIsRolesModalOpen] = useState(false);
  const [isMetricsModalOpen, setIsMetricsModalOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.dataset.theme = 'dark';
    } else {
      root.classList.remove('dark');
      root.dataset.theme = 'light';
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignorar si localStorage no está disponible
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const activeBoardIdRef = useRef(boardInfo.boardId);
  const boardInfoRef = useRef(boardInfo);
  const currentUserRef = useRef(currentUser);
  const deletingBoardIdsRef = useRef<Set<string>>(new Set());
  const syncInFlightRef = useRef(false);
  const wasOfflineRef = useRef(typeof navigator !== 'undefined' ? !navigator.onLine : false);

  useEffect(() => {
    activeBoardIdRef.current = boardInfo.boardId;
    boardInfoRef.current = boardInfo;
  }, [boardInfo]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const dismissNotification = useCallback(() => {
    setNotification(null);
  }, []);

  const applyBoardSelection = useCallback((
    newBoardId: string,
    token: string,
    pushHistory: boolean,
    extras?: {
      initialTemplateId?: BoardTemplateId;
      initialImportSnapshot?: BoardExportSnapshot;
    }
  ) => {
    const isOnline = typeof navigator === 'undefined' || navigator.onLine;
    if (isOnline) {
      LocalBoardRepository.clearBoardMetaNotifications(newBoardId);
    }

    const registered = LocalBoardRepository.getRegisteredBoards();
    const target = registered.find(b => b.id === newBoardId);
    const title = target?.title || 'Tablero';
    const isOwner = isValidTokenFormat(target?.ownerToken);
    const role: BoardRole = isOwner ? 'owner' : (target?.role === 'admin' ? 'admin' : 'member');
    const ownerId = target?.ownerId || (isOwner ? currentUser.id : '');
    const ownerName = isOwner ? currentUser.name : (target?.ownerName || 'Propietario');

    if (pushHistory) {
      LocalBoardRepository.navigateToBoard(newBoardId);
    } else {
      LocalBoardRepository.setActiveBoardId(newBoardId);
    }

    setBoardInfo({
      boardId: newBoardId,
      inviteToken: token || target?.inviteToken || '',
      ownerToken: target?.ownerToken,
      joinCode: target?.joinCode,
      title,
      role,
      ownerId,
      ownerName,
      ...(extras?.initialTemplateId ? { initialTemplateId: extras.initialTemplateId } : {}),
      ...(extras?.initialImportSnapshot ? { initialImportSnapshot: extras.initialImportSnapshot } : {}),
    });
    setBoards(registered);
    setIsSidebarOpen(false);
  }, [currentUser.id, currentUser.name]);

  const selectBoard = useCallback((newBoardId: string, token: string) => {
    applyBoardSelection(newBoardId, token, true);
  }, [applyBoardSelection]);

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const urlBoard = params.get('board');
      if (!urlBoard) return;
      const target = LocalBoardRepository.getRegisteredBoards().find(b => b.id === urlBoard);
      if (target) {
        applyBoardSelection(target.id, target.inviteToken, false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [applyBoardSelection]);

  const syncOwnerNameToServer = useCallback(async (ownerId: string, ownerName: string) => {
    const ownedBoards = LocalBoardRepository.getRegisteredBoards().filter(
      b => b.role === 'owner' && isValidTokenFormat(b.ownerToken)
    );
    if (ownedBoards.length === 0) {
      localStorage.removeItem(PENDING_OWNER_NAME_SYNC_KEY);
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      localStorage.setItem(PENDING_OWNER_NAME_SYNC_KEY, '1');
      return;
    }

    try {
      const response = await fetch(`${APP_CONFIG.getHttpApiUrl()}/api/boards/owner-name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId,
          ownerName,
          boards: ownedBoards.map(b => ({ boardId: b.id, ownerToken: b.ownerToken! })),
        }),
      });
      if (response.ok) {
        localStorage.removeItem(PENDING_OWNER_NAME_SYNC_KEY);
      } else {
        localStorage.setItem(PENDING_OWNER_NAME_SYNC_KEY, '1');
      }
    } catch {
      localStorage.setItem(PENDING_OWNER_NAME_SYNC_KEY, '1');
    }
  }, []);

  const updateUserProfile = useCallback((name: string, color: string) => {
    const updated = LocalUserRepository.saveUserProfile({
      id: currentUser.id,
      name: sanitizeSingleLineText(name, LIMITS.USER_NAME_MAX, currentUser.name),
      color: sanitizeHexColor(color, AVATAR_COLORS[0]),
    });
    setCurrentUser(updated);
    setBoards(LocalBoardRepository.getRegisteredBoards());
    setBoardInfo(prev =>
      prev.role === 'owner'
        ? { ...prev, ownerName: updated.name }
        : prev
    );
    void syncOwnerNameToServer(updated.id, updated.name);
  }, [currentUser.id, currentUser.name, syncOwnerNameToServer]);

  const renameBoard = useCallback(async (boardId: string, rawTitle: string) => {
    const cleanTitle = sanitizeSingleLineText(rawTitle, LIMITS.BOARD_TITLE_MAX, '');
    if (!cleanTitle) return;

    const registered = LocalBoardRepository.getRegisteredBoards();
    const target = registered.find(b => b.id === boardId);
    const ownerToken = target?.ownerToken || (activeBoardIdRef.current === boardId ? boardInfoRef.current.ownerToken : undefined);

    if (!isValidTokenFormat(ownerToken)) {
      setNotification('Solo el propietario puede cambiar el nombre del tablero.');
      return;
    }

    LocalBoardRepository.updateBoardMetadata(boardId, {
      title: cleanTitle,
      pendingTitleSync: true,
    });
    setBoards(LocalBoardRepository.getRegisteredBoards());
    if (activeBoardIdRef.current === boardId) {
      setBoardInfo(prev => (prev.boardId === boardId ? { ...prev, title: cleanTitle } : prev));
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    try {
      const response = await fetch(
        `${APP_CONFIG.getHttpApiUrl()}/api/boards/${encodeURIComponent(boardId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({ title: cleanTitle }),
        }
      );
      if (response.ok) {
        LocalBoardRepository.updateBoardMetadata(boardId, { pendingTitleSync: false });
        setBoards(LocalBoardRepository.getRegisteredBoards());
      } else if (response.status === 403) {
        setNotification('No tienes permisos para renombrar este tablero.');
      }
    } catch {
      // Queda marcado con pendingTitleSync para reintentar al reconectar
    }
  }, []);

  const createBoard = useCallback((rawTitle: string, templateId: BoardTemplateId = 'classic') => {
    const title = sanitizeSingleLineText(rawTitle, LIMITS.BOARD_TITLE_MAX, 'Tablero');
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'tablero';
    const newBoardId = `${slug}-${generateSecureToken('').substring(0, 8)}`;
    const inviteToken = generateSecureToken();
    const ownerToken = generateSecureToken();
    const joinCode = generateJoinCode();

    const newEntry: UserBoardEntry = {
      id: newBoardId,
      title,
      role: 'owner',
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      inviteToken,
      ownerToken,
      joinCode,
      lastOpenedAt: Date.now(),
    };

    LocalBoardRepository.saveRegisteredBoard(newEntry);
    setBoards(LocalBoardRepository.getRegisteredBoards());
    applyBoardSelection(newBoardId, inviteToken, true, { initialTemplateId: templateId });
  }, [currentUser.id, currentUser.name, applyBoardSelection]);

  const importBoardFromSnapshot = useCallback((snapshot: BoardExportSnapshot) => {
    const title = sanitizeSingleLineText(snapshot.title, LIMITS.BOARD_TITLE_MAX, 'Tablero Importado');
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'tablero';
    const newBoardId = `${slug}-${generateSecureToken('').substring(0, 8)}`;
    const inviteToken = generateSecureToken();
    const ownerToken = generateSecureToken();
    const joinCode = generateJoinCode();

    // Regenerar IDs y claves fraccionarias limpias para evitar colisiones
    const colKeys = generateNKeysBetween(null, null, snapshot.columns.length);
    const colIdMap = new Map<string, string>();
    const remappedColumns = snapshot.columns.map((col, idx) => {
      const nextId = `col-${generateUuid().slice(0, 8)}`;
      colIdMap.set(col.id, nextId);
      return {
        ...col,
        id: nextId,
        orderKey: colKeys[idx],
      };
    });

    const cardIdMap = new Map<string, string>();
    const cardsByTargetCol = new Map<string, typeof snapshot.cards>();
    for (const card of snapshot.cards) {
      const targetColId = colIdMap.get(card.columnId) ?? remappedColumns[0].id;
      const list = cardsByTargetCol.get(targetColId) ?? [];
      list.push(card);
      cardsByTargetCol.set(targetColId, list);
    }

    const remappedCards: BoardExportSnapshot['cards'] = [];
    for (const [targetColId, colCards] of cardsByTargetCol.entries()) {
      const cardKeys = generateNKeysBetween(null, null, colCards.length);
      colCards.forEach((card, idx) => {
        const nextCardId = generateUuid();
        cardIdMap.set(card.id, nextCardId);
        remappedCards.push({
          ...card,
          id: nextCardId,
          columnId: targetColId,
          orderKey: cardKeys[idx],
        });
      });
    }

    const remappedComments: BoardExportSnapshot['comments'] = [];
    for (const cm of snapshot.comments) {
      const targetCardId = cardIdMap.get(cm.cardId);
      if (!targetCardId) continue;
      remappedComments.push({
        ...cm,
        id: `cmt-${generateUuid().slice(0, 12)}`,
        cardId: targetCardId,
      });
    }

    const normalizedSnapshot: BoardExportSnapshot = {
      version: 1,
      exportedAt: Date.now(),
      title,
      columns: remappedColumns,
      cards: remappedCards,
      comments: remappedComments,
    };

    const newEntry: UserBoardEntry = {
      id: newBoardId,
      title,
      role: 'owner',
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      inviteToken,
      ownerToken,
      joinCode,
      lastOpenedAt: Date.now(),
    };

    LocalBoardRepository.saveRegisteredBoard(newEntry);
    setBoards(LocalBoardRepository.getRegisteredBoards());
    applyBoardSelection(newBoardId, inviteToken, true, { initialImportSnapshot: normalizedSnapshot });
  }, [currentUser.id, currentUser.name, applyBoardSelection]);

  const updateMemberRole = useCallback(async (
    boardId: string,
    targetUserId: string,
    role: AssignableBoardRole
  ): Promise<boolean> => {
    const registered = LocalBoardRepository.getRegisteredBoards();
    const target = registered.find(b => b.id === boardId);
    const ownerToken = target?.ownerToken || (activeBoardIdRef.current === boardId ? boardInfoRef.current.ownerToken : undefined);

    if (!isValidTokenFormat(ownerToken)) {
      setNotification('Solo el propietario puede gestionar los roles del tablero.');
      return false;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setNotification('Necesitas conexión a internet para asignar o revocar el rol de administrador.');
      return false;
    }

    try {
      const response = await fetch(
        `${APP_CONFIG.getHttpApiUrl()}/api/boards/${encodeURIComponent(boardId)}/roles`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({ userId: targetUserId, role }),
        }
      );
      if (!response.ok) {
        const errBody = (await response.json().catch(() => null)) as { error?: string } | null;
        setNotification(errBody?.error || 'No se pudo actualizar el rol del colaborador.');
        return false;
      }
      return true;
    } catch {
      setNotification('No se pudo contactar con el servidor para actualizar el rol.');
      return false;
    }
  }, []);

  const joinBoard = useCallback((
    targetBoardId: string,
    token: string,
    title?: string,
    ownerName?: string,
    joinCode?: string
  ) => {
    const existing = LocalBoardRepository.getRegisteredBoards().find(b => b.id === targetBoardId);
    if (existing) {
      if (title || ownerName || joinCode || isValidTokenFormat(token)) {
        LocalBoardRepository.updateBoardMetadata(targetBoardId, {
          title: title || undefined,
          ownerName: existing.role === 'owner' ? undefined : ownerName,
          joinCode,
        });
      }
      selectBoard(targetBoardId, isValidTokenFormat(token) ? token : existing.inviteToken);
      return;
    }

    LocalBoardRepository.saveRegisteredBoard({
      id: targetBoardId,
      title: title || 'Tablero Compartido',
      role: 'member',
      ownerId: '',
      ownerName: ownerName || 'Propietario',
      inviteToken: token,
      joinCode,
      lastOpenedAt: Date.now(),
    });
    selectBoard(targetBoardId, token);
  }, [selectBoard]);

  const navigateAwayFromRemovedBoard = useCallback((remaining: UserBoardEntry[]) => {
    const myOwnBoard = remaining.find(b => b.role === 'owner');
    if (myOwnBoard) {
      selectBoard(myOwnBoard.id, myOwnBoard.inviteToken);
    } else if (remaining.length > 0) {
      selectBoard(remaining[0].id, remaining[0].inviteToken);
    } else {
      const initial = LocalBoardRepository.resolveInitialBoard();
      setBoardInfo(initial);
      setBoards(LocalBoardRepository.getRegisteredBoards());
    }
  }, [selectBoard]);

  const deleteBoard = useCallback(async (boardIdToDelete: string) => {
    const registered = LocalBoardRepository.getRegisteredBoards();
    const target = registered.find(b => b.id === boardIdToDelete);
    const ownerToken = target?.ownerToken || (activeBoardIdRef.current === boardIdToDelete ? boardInfo.ownerToken : undefined);

    if (!ownerToken) {
      setNotification('No tienes permisos de propietario para eliminar este tablero.');
      return;
    }

    deletingBoardIdsRef.current.add(boardIdToDelete);
    try {
      const response = await fetch(
        `${APP_CONFIG.getHttpApiUrl()}/api/boards/${encodeURIComponent(boardIdToDelete)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${ownerToken}`,
          },
        }
      );
      if (!response.ok && response.status !== 404) {
        setNotification('No autorizado o error del servidor al eliminar el tablero.');
        return;
      }

      LocalBoardRepository.deleteRegisteredBoard(boardIdToDelete);
      await deleteBoardIndexedDb(boardIdToDelete);
      const remaining = LocalBoardRepository.getRegisteredBoards();
      setBoards(remaining);

      if (activeBoardIdRef.current === boardIdToDelete) {
        navigateAwayFromRemovedBoard(remaining);
      }
    } catch (err) {
      console.warn('[BoardContext] Error al eliminar tablero en servidor:', err);
      setNotification('No se pudo contactar con el servidor para eliminar el tablero.');
    } finally {
      deletingBoardIdsRef.current.delete(boardIdToDelete);
    }
  }, [boardInfo.ownerToken, navigateAwayFromRemovedBoard]);

  const leaveBoard = useCallback(async (boardIdToLeave: string) => {
    const target = LocalBoardRepository.getRegisteredBoards().find(b => b.id === boardIdToLeave);
    LocalBoardRepository.deleteRegisteredBoard(boardIdToLeave);
    await deleteBoardIndexedDb(boardIdToLeave);
    const remaining = LocalBoardRepository.getRegisteredBoards();
    setBoards(remaining);

    if (activeBoardIdRef.current === boardIdToLeave) {
      navigateAwayFromRemovedBoard(remaining);
    }

    if (target) {
      const payload: PendingBoardLeave = {
        boardId: target.id,
        userId: currentUserRef.current.id,
        inviteToken: target.inviteToken || undefined,
        ownerToken: target.ownerToken || undefined,
        joinCode: target.joinCode || undefined,
      };
      const delivered = await sendBoardLeaveRequest(payload);
      if (!delivered) {
        const pending = readPendingBoardLeaves().filter(p => p.boardId !== payload.boardId);
        pending.push(payload);
        writePendingBoardLeaves(pending);
      }
    }
  }, [navigateAwayFromRemovedBoard]);

  const handleRemoteBoardDeleted = useCallback(() => {
    const currentId = activeBoardIdRef.current;
    if (deletingBoardIdsRef.current.has(currentId)) return;

    LocalBoardRepository.deleteRegisteredBoard(currentId);
    void deleteBoardIndexedDb(currentId);
    const remaining = LocalBoardRepository.getRegisteredBoards();
    setBoards(remaining);
    setNotification('Este tablero ha sido eliminado por su propietario. Has sido redirigido.');
    navigateAwayFromRemovedBoard(remaining);
  }, [navigateAwayFromRemovedBoard]);

  const handleAuthError = useCallback((message: string) => {
    setNotification(`Acceso denegado: ${message}`);
  }, []);

  const handleOwnerResolved = useCallback((meta: ServerBoardMetaPayload) => {
    const prevInfo = boardInfoRef.current;
    const isSameActive = prevInfo.boardId === meta.boardId;
    const resolvedOwnerName = meta.role === 'owner' ? currentUser.name : meta.ownerName;

    if (isSameActive && meta.columnsReverted) {
      setNotification('Tu rol de administrador fue revocado. Se descartaron los cambios de columnas realizados sin conexión.');
    } else if (
      isSameActive &&
      prevInfo.role !== meta.role &&
      prevInfo.role !== 'owner' &&
      meta.role !== 'owner'
    ) {
      setNotification(
        meta.role === 'admin'
          ? 'El propietario te ha asignado el rol de Administrador: ahora puedes gestionar columnas.'
          : 'Tu rol de administrador ha sido revocado; ahora tienes permisos de Miembro.'
      );
    }

    if (isSameActive && meta.role !== 'owner') {
      const existingEntry = LocalBoardRepository.getRegisteredBoards().find(b => b.id === meta.boardId);
      const oldTitle = existingEntry?.previousTitle ?? prevInfo.title;
      const oldOwner = existingEntry?.previousOwnerName ?? prevInfo.ownerName;
      const hadPlaceholderMeta = prevInfo.title === 'Tablero Compartido' && prevInfo.ownerName === 'Propietario';

      if ((wasOfflineRef.current || existingEntry?.previousTitle || existingEntry?.previousOwnerName) && !hadPlaceholderMeta) {
        const notice = formatBoardUpdateNotice({
          oldTitle,
          newTitle: meta.title,
          oldOwnerName: oldOwner,
          newOwnerName: resolvedOwnerName,
        });
        if (notice) {
          setNotification(notice);
        }
      }
      wasOfflineRef.current = false;
    }

    setBoardInfo(prev => {
      if (prev.boardId !== meta.boardId) return prev;
      const resolvedJoinCode = meta.joinCode || prev.joinCode;
      if (
        prev.role === meta.role &&
        prev.ownerId === meta.ownerId &&
        prev.ownerName === resolvedOwnerName &&
        prev.title === meta.title &&
        prev.joinCode === resolvedJoinCode
      ) {
        return prev;
      }
      return {
        ...prev,
        title: meta.title || prev.title,
        role: meta.role,
        ownerId: meta.ownerId,
        ownerName: resolvedOwnerName,
        joinCode: resolvedJoinCode,
      };
    });

    const localBoard = LocalBoardRepository.getRegisteredBoards().find(b => b.id === meta.boardId);
    const keepLocalPendingTitle = meta.role === 'owner' && localBoard?.pendingTitleSync;

    LocalBoardRepository.updateBoardMetadata(meta.boardId, {
      title: keepLocalPendingTitle ? undefined : meta.title,
      ownerId: meta.ownerId,
      ownerName: meta.role === 'owner' ? currentUser.name : meta.ownerName,
      joinCode: meta.joinCode,
      role: meta.role,
      previousTitle: null,
      previousOwnerName: null,
    });
    setBoards(LocalBoardRepository.getRegisteredBoards());

    if (keepLocalPendingTitle && localBoard && meta.title !== localBoard.title) {
      void renameBoard(meta.boardId, localBoard.title);
    }
  }, [currentUser.name, renameBoard]);

  const syncBoardsMetadata = useCallback(async () => {
    if (syncInFlightRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const registered = LocalBoardRepository.getRegisteredBoards();
    if (registered.length === 0) return;

    syncInFlightRef.current = true;
    try {
      const response = await fetch(`${APP_CONFIG.getHttpApiUrl()}/api/boards/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boards: registered.map(b => ({
            boardId: b.id,
            userId: currentUserRef.current.id,
            inviteToken: b.inviteToken || undefined,
            ownerToken: b.ownerToken || undefined,
            joinCode: b.joinCode || undefined,
          })),
        }),
      });
      if (!response.ok) return;

      const data = (await response.json()) as { boards?: BoardMetaSyncItem[] };
      if (!Array.isArray(data.boards)) return;

      const isOnline = typeof navigator === 'undefined' || navigator.onLine;
      const { deletedBoardIds, activeBoardChanged } = LocalBoardRepository.applyRemoteBoardMetadata(
        data.boards,
        activeBoardIdRef.current,
        isOnline
      );

      for (const deletedId of deletedBoardIds) {
        void deleteBoardIndexedDb(deletedId);
      }

      const updatedList = LocalBoardRepository.getRegisteredBoards();
      setBoards(updatedList);

      if (deletedBoardIds.includes(activeBoardIdRef.current) && !deletingBoardIdsRef.current.has(activeBoardIdRef.current)) {
        setNotification('Este tablero ha sido eliminado por su propietario. Has sido redirigido.');
        navigateAwayFromRemovedBoard(updatedList);
        return;
      }

      if (activeBoardChanged) {
        const currentActive = updatedList.find(b => b.id === activeBoardIdRef.current);
        if (currentActive) {
          setBoardInfo(prev =>
            prev.boardId === currentActive.id
              ? {
                  ...prev,
                  title: currentActive.title,
                  role: currentActive.role,
                  ownerName: currentActive.role === 'owner' ? currentUserRef.current.name : currentActive.ownerName,
                  joinCode: currentActive.joinCode || prev.joinCode,
                }
              : prev
          );
        }
        const notice = formatBoardUpdateNotice(activeBoardChanged);
        if (notice) setNotification(notice);
      }
    } catch {
      // Silenciar errores transitorios de red durante sincronización de metadatos
    } finally {
      syncInFlightRef.current = false;
    }
  }, [navigateAwayFromRemovedBoard]);

  const flushPendingOwnerUpdatesAndSync = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const pendingBoards = LocalBoardRepository.getRegisteredBoards().filter(
      b => b.role === 'owner' && b.pendingTitleSync && isValidTokenFormat(b.ownerToken)
    );
    for (const board of pendingBoards) {
      try {
        const res = await fetch(
          `${APP_CONFIG.getHttpApiUrl()}/api/boards/${encodeURIComponent(board.id)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${board.ownerToken!}`,
            },
            body: JSON.stringify({ title: board.title }),
          }
        );
        if (res.ok) {
          LocalBoardRepository.updateBoardMetadata(board.id, { pendingTitleSync: false });
        }
      } catch {
        // Reintentar en la siguiente reconexión
      }
    }

    if (localStorage.getItem(PENDING_OWNER_NAME_SYNC_KEY) === '1') {
      await syncOwnerNameToServer(currentUserRef.current.id, currentUserRef.current.name);
    }

    const pendingLeaves = readPendingBoardLeaves();
    if (pendingLeaves.length > 0) {
      const remainingLeaves: PendingBoardLeave[] = [];
      for (const leaveItem of pendingLeaves) {
        const delivered = await sendBoardLeaveRequest(leaveItem);
        if (!delivered) {
          remainingLeaves.push(leaveItem);
        }
      }
      writePendingBoardLeaves(remainingLeaves);
    }

    await syncBoardsMetadata();
  }, [syncBoardsMetadata, syncOwnerNameToServer]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void flushPendingOwnerUpdatesAndSync();
    }, 0);

    const handleOffline = () => {
      wasOfflineRef.current = true;
    };
    const handleOnline = () => {
      void flushPendingOwnerUpdatesAndSync();
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.clearTimeout(initialTimer);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [flushPendingOwnerUpdatesAndSync]);

  useEffect(() => {
    if (!isSidebarOpen) return;
    const interval = window.setInterval(() => {
      void syncBoardsMetadata();
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [isSidebarOpen, syncBoardsMetadata]);

  const openSidebar = useCallback(() => {
    setIsSidebarOpen(true);
    void syncBoardsMetadata();
  }, [syncBoardsMetadata]);

  const value: BoardContextValue = {
    boardInfo,
    boards,
    currentUser,
    theme,
    toggleTheme,
    isSidebarOpen,
    isShareModalOpen,
    isCreateBoardModalOpen,
    isJoinModalOpen,
    isProfileModalOpen,
    isRolesModalOpen,
    isMetricsModalOpen,
    isShortcutsModalOpen,
    notification,
    dismissNotification,
    openSidebar,
    closeSidebar: () => setIsSidebarOpen(false),
    openShareModal: () => setIsShareModalOpen(true),
    closeShareModal: () => setIsShareModalOpen(false),
    openCreateBoardModal: () => setIsCreateBoardModalOpen(true),
    closeCreateBoardModal: () => setIsCreateBoardModalOpen(false),
    openJoinModal: () => setIsJoinModalOpen(true),
    closeJoinModal: () => setIsJoinModalOpen(false),
    openProfileModal: () => setIsProfileModalOpen(true),
    closeProfileModal: () => setIsProfileModalOpen(false),
    openRolesModal: () => setIsRolesModalOpen(true),
    closeRolesModal: () => setIsRolesModalOpen(false),
    openMetricsModal: () => setIsMetricsModalOpen(true),
    closeMetricsModal: () => setIsMetricsModalOpen(false),
    openShortcutsModal: () => setIsShortcutsModalOpen(true),
    closeShortcutsModal: () => setIsShortcutsModalOpen(false),
    updateUserProfile,
    selectBoard,
    createBoard,
    importBoardFromSnapshot,
    renameBoard,
    updateMemberRole,
    joinBoard,
    deleteBoard,
    leaveBoard,
    handleRemoteBoardDeleted,
    handleAuthError,
    handleOwnerResolved,
  };

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { removeAwarenessStates } from 'y-protocols/awareness';
import {
  LIMITS,
  WS_CLOSE_CODE,
  WS_MESSAGE_TYPE,
  computeOrderKeyRepairs,
  generateNKeysBetween,
  isValidOrderKey,
  sanitizeActivity,
  sanitizeAssignee,
  sanitizeBoardMember,
  sanitizeChecklist,
  sanitizeDueDate,
  sanitizeHexColor,
  sanitizeMultilineText,
  sanitizePriority,
  sanitizeSingleLineText,
  sanitizeStoryPoints,
  type BoardMember,
  type Card,
  type Column,
  type CursorPosition,
  type Label,
  type ServerBoardMetaPayload,
  type UserActivity,
  type UserPresence,
  type UserProfile,
  validateCursor,
  validateLabel,
} from '@kanban/shared-types';
import { APP_CONFIG } from '../config/env.js';

export type SyncStatus = 'online' | 'syncing' | 'offline';

const RECONCILE_ORIGIN = 'order-reconcile';

export interface YjsRoomClientOptions {
  boardId: string;
  boardTitle?: string;
  currentUser: UserProfile;
  inviteToken?: string;
  ownerToken?: string;
  joinCode?: string;
  initialOwnerId?: string;
  initialOwnerName?: string;
  seedDemoCards?: boolean;
  onSyncStatusChange?: (status: SyncStatus) => void;
  onCollaboratorsChange?: (collaborators: UserPresence[]) => void;
  onDataChange?: () => void;
  onBoardDeleted?: () => void;
  onAuthError?: (message: string) => void;
  onOwnerResolved?: (meta: ServerBoardMetaPayload) => void;
}

interface AwarenessEnvelope {
  user?: Partial<UserPresence>;
}

function createAuthWebSocketClass(protocols: string[]): typeof WebSocket {
  return class AuthWebSocket extends WebSocket {
    constructor(url: string | URL) {
      super(url, protocols);
    }
  } as unknown as typeof WebSocket;
}

export async function deleteBoardIndexedDb(boardId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>(resolve => {
    try {
      const req = indexedDB.deleteDatabase(`kanban-board-${boardId}`);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

function readField<T>(source: Y.Map<unknown> | Record<string, unknown>, key: string): T | undefined {
  if (source instanceof Y.Map) {
    return source.get(key) as T | undefined;
  }
  return source[key] as T | undefined;
}

function writeColumnFields(yCol: Y.Map<unknown>, col: Column): void {
  yCol.set('id', col.id);
  yCol.set('boardId', col.boardId);
  yCol.set('title', col.title);
  yCol.set('orderKey', col.orderKey);
  if (col.color) yCol.set('color', col.color);
  yCol.set('createdAt', col.createdAt);
}

function writeCardFields(yCard: Y.Map<unknown>, card: Card): void {
  yCard.set('id', card.id);
  yCard.set('boardId', card.boardId);
  yCard.set('columnId', card.columnId);
  yCard.set('title', card.title);
  yCard.set('description', card.description);
  yCard.set('orderKey', card.orderKey);
  yCard.set('labels', card.labels);
  yCard.set('priority', card.priority ?? null);
  yCard.set('dueDate', card.dueDate ?? null);
  yCard.set('assignee', card.assignee ?? null);
  yCard.set('checklist', card.checklist ?? []);
  yCard.set('storyPoints', card.storyPoints ?? null);
  yCard.set('createdAt', card.createdAt);
  yCard.set('updatedAt', card.updatedAt);
  if (card.editCount !== undefined) yCard.set('editCount', card.editCount);
  if (card.deleted !== undefined) yCard.set('deleted', card.deleted);
  if (card.deletedAtEditCount !== undefined) yCard.set('deletedAtEditCount', card.deletedAtEditCount);
  if (card.deletedAt !== undefined) yCard.set('deletedAt', card.deletedAt);
}

/**
 * Determina si una tarjeta en el Y.Doc sigue activa aplicando la regla CRDT Edit-Wins:
 * una edición concurrente o posterior al borrado prevalece sobre el tombstone.
 */
export function isCardActive(raw: Y.Map<unknown> | Card | Record<string, unknown>): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const source = raw as Y.Map<unknown> | Record<string, unknown>;
  const isDeleted = readField<boolean>(source, 'deleted') === true;
  if (!isDeleted) return true;
  const editCount = readField<number>(source, 'editCount') ?? 1;
  const deletedAtEditCount = readField<number>(source, 'deletedAtEditCount') ?? 0;
  const updatedAt = readField<number>(source, 'updatedAt') ?? 0;
  const deletedAt = readField<number | null>(source, 'deletedAt') ?? 0;
  // Edit-Wins: si hubo edición concurrente o posterior al borrado, preservar la tarjeta
  return editCount > deletedAtEditCount || updatedAt > (deletedAt ?? 0);
}

/**
 * Extrae el diccionario de miembros conocidos (activos y salientes) desde `membersMap`.
 */
export function extractMembersMap(
  membersMap?: Y.Map<Y.Map<unknown> | BoardMember>
): Map<string, BoardMember> {
  const result = new Map<string, BoardMember>();
  if (!membersMap) return result;
  for (const [key, raw] of membersMap.entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const plain = raw instanceof Y.Map ? Object.fromEntries(raw.entries()) : raw;
    const member = sanitizeBoardMember(plain, key);
    if (member) {
      result.set(member.userId, member);
    }
  }
  return result;
}

/**
 * Extrae todas las tarjetas activas del mapa Yjs, resolviendo el responsable
 * más reciente desde `membersMap` (y limpiándolo si el miembro abandonó el tablero).
 */
export function extractCardsFromMap(
  cardsMap: Y.Map<Y.Map<unknown> | Card>,
  membersMap?: Y.Map<Y.Map<unknown> | BoardMember>
): Card[] {
  const membersById = membersMap ? extractMembersMap(membersMap) : null;
  const result: Card[] = [];
  for (const [key, raw] of cardsMap.entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const source = raw as Y.Map<unknown> | Record<string, unknown>;
    if (!isCardActive(source)) continue;

    const id = sanitizeSingleLineText(readField<string>(source, 'id') ?? key, 64);
    const boardId = sanitizeSingleLineText(readField<string>(source, 'boardId') ?? '', 64);
    const columnId = sanitizeSingleLineText(readField<string>(source, 'columnId') ?? '', 64);
    const title = sanitizeSingleLineText(readField<string>(source, 'title'), LIMITS.CARD_TITLE_MAX, 'Sin título');
    const description = sanitizeMultilineText(readField<string>(source, 'description'), LIMITS.CARD_DESC_MAX, '');
    const rawOrderKey = readField<string>(source, 'orderKey');
    const orderKey = isValidOrderKey(rawOrderKey) ? rawOrderKey : 'a0';
    const rawLabels = readField<unknown[]>(source, 'labels');
    const labels: Label[] = Array.isArray(rawLabels)
      ? rawLabels.filter(validateLabel).slice(0, LIMITS.MAX_LABELS_PER_CARD)
      : [];
    const priority = sanitizePriority(readField(source, 'priority'));
    const dueDate = sanitizeDueDate(readField(source, 'dueDate'));
    let assignee = sanitizeAssignee(readField(source, 'assignee'));
    if (assignee?.userId && membersById) {
      const member = membersById.get(assignee.userId);
      if (member) {
        assignee = member.left
          ? null
          : { userId: member.userId, name: member.name, color: member.color };
      }
    }
    const checklist = sanitizeChecklist(readField(source, 'checklist'));
    const storyPoints = sanitizeStoryPoints(readField(source, 'storyPoints'));
    const createdAt = readField<number>(source, 'createdAt');
    const updatedAt = readField<number>(source, 'updatedAt');
    const editCount = readField<number>(source, 'editCount');

    if (!id || !columnId) continue;

    result.push({
      id,
      boardId,
      columnId,
      title,
      description,
      orderKey,
      labels,
      priority,
      dueDate,
      assignee,
      checklist,
      storyPoints,
      createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
      updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0,
      editCount: typeof editCount === 'number' && Number.isFinite(editCount) ? editCount : 1,
    });
  }
  return result;
}

/**
 * Resuelve de forma determinista colisiones de `orderKey` entre tarjetas activas en el Y.Doc compartido.
 */
export function reconcileCardsInDoc(
  ydoc: Y.Doc,
  cardsMap: Y.Map<Y.Map<unknown> | Card>
): boolean {
  const cards = extractCardsFromMap(cardsMap);
  const repairs = computeOrderKeyRepairs(cards);
  if (repairs.length === 0) return false;

  ydoc.transact(() => {
    for (const repair of repairs) {
      const existing = cardsMap.get(repair.id);
      if (!existing) continue;
      if (existing instanceof Y.Map) {
        existing.set('orderKey', repair.orderKey);
      } else {
        const yCard = new Y.Map<unknown>();
        writeCardFields(yCard, { ...(existing as Card), orderKey: repair.orderKey });
        cardsMap.set(repair.id, yCard);
      }
    }
  }, RECONCILE_ORIGIN);

  return true;
}

/**
 * Cliente de sala local-first sobre Yjs: coordina IndexedDB, WebSocket autenticado,
 * reconciliación determinista de `orderKey`, miembros del tablero y presencia en tiempo real.
 */
export class YjsRoomClient {
  public readonly ydoc: Y.Doc;
  public readonly cardsMap: Y.Map<Y.Map<unknown> | Card>;
  public readonly columnsMap: Y.Map<Y.Map<unknown> | Column>;
  public readonly membersMap: Y.Map<Y.Map<unknown> | BoardMember>;
  private readonly idbProvider: IndexeddbPersistence;
  private readonly wsProvider: WebsocketProvider;
  private isDestroyed = false;
  private hasLocalDocSynced = false;
  private latestUser: UserProfile;
  private isOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
  private readonly onSyncStatusChangeCb?: (status: SyncStatus) => void;

  private clearRemoteAwareness(reason: string): void {
    try {
      const awareness = this.wsProvider.awareness;
      const remoteClients = Array.from(awareness.getStates().keys()).filter(
        id => id !== awareness.clientID
      );
      if (remoteClients.length > 0) {
        removeAwarenessStates(awareness, remoteClients, reason);
      }
    } catch {
      // Ignorar si awareness ya fue destruido
    }
  }

  private handleBrowserOffline = () => {
    this.isOffline = true;
    try {
      this.wsProvider.disconnect();
    } catch {
      // Ignorar si provider ya fue destruido
    }
    this.clearRemoteAwareness('offline');
    this.onSyncStatusChangeCb?.('offline');
  };

  private handleBrowserOnline = () => {
    this.isOffline = false;
    this.onSyncStatusChangeCb?.('syncing');
    if (!this.isDestroyed && !this.wsProvider.wsconnected) {
      this.wsProvider.connect();
    }
  };

  private handlePageHide = () => {
    if (this.isDestroyed) return;
    try {
      this.wsProvider.disconnect();
    } catch {
      // Ignorar si provider ya fue destruido
    }
  };

  private handlePageShow = (event: PageTransitionEvent) => {
    if (this.isDestroyed || !event.persisted) return;
    this.isOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
    if (this.isOffline) {
      this.onSyncStatusChangeCb?.('offline');
    } else if (!this.wsProvider.wsconnected) {
      this.onSyncStatusChangeCb?.('syncing');
      this.wsProvider.connect();
    }
  };

  constructor(options: YjsRoomClientOptions) {
    const {
      boardId,
      boardTitle,
      currentUser,
      inviteToken,
      ownerToken,
      joinCode,
      initialOwnerId,
      initialOwnerName,
      seedDemoCards = false,
      onSyncStatusChange,
      onCollaboratorsChange,
      onDataChange,
      onBoardDeleted,
      onAuthError,
      onOwnerResolved,
    } = options;

    this.onSyncStatusChangeCb = onSyncStatusChange;
    this.latestUser = { ...currentUser };
    this.ydoc = new Y.Doc();
    this.cardsMap = this.ydoc.getMap<Y.Map<unknown> | Card>('cards');
    this.columnsMap = this.ydoc.getMap<Y.Map<unknown> | Column>('columns');
    this.membersMap = this.ydoc.getMap<Y.Map<unknown> | BoardMember>('members');

    const ensureDefaultColumns = () => {
      if (this.isDestroyed || this.columnsMap.size > 0) return;
      const [keyTodo, keyProgress, keyDone] = generateNKeysBetween(null, null, 3);
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const defaultCols: Column[] = [
        { id: 'col-todo', boardId, title: 'Por Hacer', orderKey: keyTodo, createdAt: now },
        { id: 'col-progress', boardId, title: 'En Progreso', orderKey: keyProgress, createdAt: now },
        { id: 'col-done', boardId, title: 'Terminado', orderKey: keyDone, createdAt: now },
      ];
      this.ydoc.transact(() => {
        defaultCols.forEach(col => this.setColumnInternal(col));

        if (seedDemoCards && this.cardsMap.size === 0) {
          const [k1, k2] = generateNKeysBetween(null, null, 2);
          const demoCards: Card[] = [
            {
              id: `demo-1-${boardId.slice(-6)}`,
              boardId,
              columnId: 'col-todo',
              title: 'Probar colaboración en tiempo real',
              description: 'Pulsa "Compartir" arriba y abre el enlace o código de sala en otra pestaña/navegador para ver cursores y cambios en vivo.',
              orderKey: k1,
              labels: [{ id: 'lbl-demo-feat', name: 'Feature', color: '#3b82f6' }],
              priority: 'high',
              dueDate: now + 2 * dayMs,
              assignee: { userId: currentUser.id, name: currentUser.name, color: currentUser.color },
              checklist: [
                { id: 'chk-demo-1', text: 'Copiar código de sala rápido', completed: true },
                { id: 'chk-demo-2', text: 'Arrastrar una tarjeta entre columnas', completed: false },
              ],
              storyPoints: 3,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: `demo-2-${boardId.slice(-6)}`,
              boardId,
              columnId: 'col-todo',
              title: 'Simular modo Offline (IndexedDB)',
              description: 'Activa "Sin conexión" en DevTools, edita o mueve tarjetas y vuelve online para ver la reconciliación automática CRDT.',
              orderKey: k2,
              labels: [{ id: 'lbl-demo-doc', name: 'Documentación', color: '#10b981' }],
              priority: 'medium',
              dueDate: now + 5 * dayMs,
              checklist: [],
              storyPoints: 2,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: `demo-3-${boardId.slice(-6)}`,
              boardId,
              columnId: 'col-progress',
              title: 'Configurar prioridades, fechas y subtareas',
              description: 'Haz clic sobre cualquier tarjeta para abrir el editor completo o edita el título del tablero desde la cabecera.',
              orderKey: k1,
              labels: [{ id: 'lbl-demo-urg', name: 'Urgente', color: '#f59e0b' }],
              priority: 'urgent',
              dueDate: now + dayMs,
              assignee: { userId: currentUser.id, name: currentUser.name, color: currentUser.color },
              checklist: [
                { id: 'chk-demo-3', text: 'Definir prioridad y puntos', completed: true },
                { id: 'chk-demo-4', text: 'Asignar responsable', completed: false },
              ],
              storyPoints: 5,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: `demo-4-${boardId.slice(-6)}`,
              boardId,
              columnId: 'col-done',
              title: 'Arquitectura Local-First con Yjs + SQLite',
              description: 'Sincronización binaria mediante deltas CRDT, Fractional Indexing y persistencia local instantánea.',
              orderKey: k1,
              labels: [{ id: 'lbl-demo-done', name: 'Feature', color: '#3b82f6' }],
              priority: 'low',
              checklist: [{ id: 'chk-demo-5', text: 'Desplegado como PWA instalable', completed: true }],
              storyPoints: 8,
              createdAt: now,
              updatedAt: now,
            },
          ];

          for (const card of demoCards) {
            const yCard = new Y.Map<unknown>();
            writeCardFields(yCard, {
              ...card,
              deleted: false,
              deletedAt: null,
              deletedAtEditCount: 0,
              editCount: 1,
            });
            this.cardsMap.set(card.id, yCard);
          }
        }
      });
    };

    // 1. Persistencia local IndexedDB
    this.idbProvider = new IndexeddbPersistence(`kanban-board-${boardId}`, this.ydoc);
    this.idbProvider.on('synced', () => {
      if (this.isDestroyed) return;
      this.hasLocalDocSynced = true;
      if (ownerToken) {
        ensureDefaultColumns();
      }
      reconcileCardsInDoc(this.ydoc, this.cardsMap);
      this.syncCurrentUserInDoc(this.latestUser);
      onDataChange?.();
    });

    // 2. Conexión WebSocket segura vía Sec-WebSocket-Protocol
    const wsUrl = APP_CONFIG.getWsUrl();
    const protocols = ['yjs-v1'];
    if (inviteToken) protocols.push(`invite.${inviteToken}`);
    if (ownerToken) protocols.push(`owner.${ownerToken}`);
    if (joinCode) protocols.push(`joincode.${joinCode}`);

    const wsParams: Record<string, string> = {};
    if (ownerToken) {
      if (boardTitle) wsParams.title = boardTitle;
      if (initialOwnerId) wsParams.ownerId = initialOwnerId;
      if (initialOwnerName) wsParams.ownerName = initialOwnerName;
    }

    // disableBc evita que dos pestañas del mismo navegador sigan sincronizando por BroadcastChannel al desconectarse
    this.wsProvider = new WebsocketProvider(wsUrl, boardId, this.ydoc, {
      connect: !this.isOffline,
      disableBc: true,
      params: wsParams,
      WebSocketPolyfill: createAuthWebSocketClass(protocols),
    });

    if (this.isOffline) {
      onSyncStatusChange?.('offline');
    }

    this.wsProvider.messageHandlers[WS_MESSAGE_TYPE.BOARD_META] = (
      _encoder,
      decoder
    ) => {
      if (this.isDestroyed) return;
      try {
        const raw = decoding.readVarString(decoder);
        const parsed = JSON.parse(raw) as ServerBoardMetaPayload;
        if (parsed && parsed.boardId === boardId && (parsed.role === 'owner' || parsed.role === 'member')) {
          onOwnerResolved?.({
            boardId: parsed.boardId,
            title: sanitizeSingleLineText(parsed.title, LIMITS.BOARD_TITLE_MAX, 'Tablero Kanban'),
            ownerId: sanitizeSingleLineText(parsed.ownerId, 64),
            ownerName: sanitizeSingleLineText(parsed.ownerName, LIMITS.USER_NAME_MAX, 'Propietario'),
            joinCode: parsed.joinCode,
            role: parsed.role,
          });
        }
      } catch (err) {
        console.warn('[YjsRoomClient] Metadatos de servidor inválidos', err);
      }
    };

    this.wsProvider.on('sync', (isSynced: boolean) => {
      if (this.isDestroyed || !isSynced) return;
      this.hasLocalDocSynced = true;
      ensureDefaultColumns();
      reconcileCardsInDoc(this.ydoc, this.cardsMap);
      this.syncCurrentUserInDoc(this.latestUser);
      onDataChange?.();
    });

    this.wsProvider.on('connection-close', (event: CloseEvent | null) => {
      if (this.isDestroyed) return;
      if (event?.code === WS_CLOSE_CODE.BOARD_DELETED) {
        this.wsProvider.disconnect();
        this.clearRemoteAwareness('board-deleted');
        onBoardDeleted?.();
      } else if (
        event &&
        (event.code === WS_CLOSE_CODE.FORBIDDEN ||
          event.code === WS_CLOSE_CODE.UNAUTHORIZED ||
          event.code === WS_CLOSE_CODE.RATE_LIMITED)
      ) {
        this.wsProvider.disconnect();
        this.clearRemoteAwareness('auth-error');
        onSyncStatusChange?.('offline');
        onAuthError?.(event.reason || 'Acceso rechazado por el servidor');
      } else if (this.isOffline || !this.wsProvider.wsconnected) {
        this.clearRemoteAwareness('disconnected');
        onSyncStatusChange?.('offline');
      }
    });

    this.wsProvider.on('connection-error', () => {
      if (this.isDestroyed) return;
      if (this.isOffline || !this.wsProvider.wsconnected) {
        onSyncStatusChange?.('offline');
      }
    });

    this.wsProvider.on('status', (event: { status: string }) => {
      if (this.isDestroyed) return;
      if (this.isOffline) {
        onSyncStatusChange?.('offline');
        return;
      }
      if (event.status === 'connected') {
        onSyncStatusChange?.('online');
      } else if (event.status === 'connecting') {
        onSyncStatusChange?.('syncing');
      } else {
        this.clearRemoteAwareness('disconnected');
        onSyncStatusChange?.('offline');
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('offline', this.handleBrowserOffline);
      window.addEventListener('online', this.handleBrowserOnline);
      window.addEventListener('pagehide', this.handlePageHide);
      window.addEventListener('pageshow', this.handlePageShow);
    }

    // 3. Awareness de usuarios y actividad en tiempo real
    const awareness = this.wsProvider.awareness;
    awareness.setLocalStateField('user', {
      userId: currentUser.id,
      userName: currentUser.name,
      avatarColor: currentUser.color,
      cursor: null,
      activity: null,
      lastActive: Date.now(),
    });

    awareness.on('change', () => {
      if (this.isDestroyed) return;
      const rawStates = Array.from(awareness.getStates().values()) as AwarenessEnvelope[];
      const sanitizedUsers: UserPresence[] = [];

      for (const state of rawStates) {
        const u = state?.user;
        if (!u || typeof u.userId !== 'string' || !u.userId) continue;
        sanitizedUsers.push({
          userId: sanitizeSingleLineText(u.userId, 64),
          userName: sanitizeSingleLineText(u.userName, LIMITS.USER_NAME_MAX, 'Colaborador'),
          avatarColor: sanitizeHexColor(u.avatarColor, '#3b82f6'),
          cursor: validateCursor(u.cursor) ? u.cursor : null,
          activity: sanitizeActivity(u.activity),
          lastActive: typeof u.lastActive === 'number' && Number.isFinite(u.lastActive) ? u.lastActive : Date.now(),
        });
      }

      const userMap = new Map<string, UserPresence>();
      for (const u of sanitizedUsers) {
        const prev = userMap.get(u.userId);
        if (
          !prev ||
          u.lastActive > prev.lastActive ||
          (u.lastActive === prev.lastActive && Boolean(u.cursor || u.activity) && !(prev.cursor || prev.activity))
        ) {
          userMap.set(u.userId, u);
        }
      }
      onCollaboratorsChange?.(Array.from(userMap.values()));
    });

    // 4. Observadores profundos con reconciliación determinista de orderKey
    if (onDataChange) {
      this.cardsMap.observeDeep((_events, transaction) => {
        if (this.isDestroyed) return;
        if (transaction.origin !== RECONCILE_ORIGIN) {
          const repaired = reconcileCardsInDoc(this.ydoc, this.cardsMap);
          if (repaired) return;
        }
        onDataChange();
      });
      this.columnsMap.observeDeep(() => {
        if (!this.isDestroyed) onDataChange();
      });
      this.membersMap.observeDeep(() => {
        if (!this.isDestroyed) onDataChange();
      });
    }
  }

  /**
   * Sincroniza el perfil del usuario local dentro de `membersMap` y actualiza el nombre/color
   * en todas las tarjetas activas del tablero donde figure como responsable.
   */
  private syncCurrentUserInDoc(user: UserProfile): void {
    if (this.isDestroyed || !user.id) return;

    const existingMemberRaw = this.membersMap.get(user.id);
    const existingMemberPlain =
      existingMemberRaw instanceof Y.Map
        ? Object.fromEntries(existingMemberRaw.entries())
        : existingMemberRaw;
    const existingMember = sanitizeBoardMember(existingMemberPlain, user.id);

    const memberNeedsUpdate =
      !existingMember ||
      existingMember.left === true ||
      existingMember.name !== user.name ||
      existingMember.color !== user.color;

    const cardsToUpdate: Array<{ id: string; raw: Y.Map<unknown> | Card }> = [];
    for (const [cardId, raw] of this.cardsMap.entries()) {
      if (!raw || typeof raw !== 'object' || !isCardActive(raw)) continue;
      const assignee = sanitizeAssignee(readField(raw as Y.Map<unknown> | Record<string, unknown>, 'assignee'));
      if (
        assignee?.userId === user.id &&
        (assignee.name !== user.name || assignee.color !== user.color)
      ) {
        cardsToUpdate.push({ id: cardId, raw });
      }
    }

    if (!memberNeedsUpdate && cardsToUpdate.length === 0) return;

    const now = Date.now();
    const updatedAssignee = { userId: user.id, name: user.name, color: user.color };

    this.ydoc.transact(() => {
      if (memberNeedsUpdate) {
        const yMember =
          existingMemberRaw instanceof Y.Map ? existingMemberRaw : new Y.Map<unknown>();
        yMember.set('userId', user.id);
        yMember.set('name', user.name);
        yMember.set('color', user.color);
        yMember.set('left', false);
        yMember.set('leftAt', null);
        yMember.set('updatedAt', now);
        if (!(existingMemberRaw instanceof Y.Map)) {
          this.membersMap.set(user.id, yMember);
        }
      }

      for (const { id, raw } of cardsToUpdate) {
        if (raw instanceof Y.Map) {
          raw.set('assignee', updatedAssignee);
          raw.set('updatedAt', now);
        } else {
          const yCard = new Y.Map<unknown>();
          writeCardFields(yCard, { ...(raw as Card), assignee: updatedAssignee, updatedAt: now });
          this.cardsMap.set(id, yCard);
        }
      }
    });
  }

  private setColumnInternal(col: Column): void {
    const existing = this.columnsMap.get(col.id);
    if (existing instanceof Y.Map) {
      writeColumnFields(existing, col);
      return;
    }
    const yCol = new Y.Map<unknown>();
    writeColumnFields(yCol, col);
    this.columnsMap.set(col.id, yCol);
  }

  public getCards(): Card[] {
    return extractCardsFromMap(this.cardsMap, this.membersMap);
  }

  /** Devuelve los miembros activos del tablero (excluye a quienes lo abandonaron). */
  public getMembers(): BoardMember[] {
    return Array.from(extractMembersMap(this.membersMap).values()).filter(m => !m.left);
  }

  public getColumns(): Column[] {
    const result: Column[] = [];
    for (const [key, raw] of this.columnsMap.entries()) {
      if (!raw || typeof raw !== 'object') continue;
      const source = raw as Y.Map<unknown> | Record<string, unknown>;
      const id = sanitizeSingleLineText(readField<string>(source, 'id') ?? key, 64);
      const boardId = sanitizeSingleLineText(readField<string>(source, 'boardId') ?? '', 64);
      const title = sanitizeSingleLineText(readField<string>(source, 'title'), LIMITS.COLUMN_TITLE_MAX, 'Columna');
      const rawOrderKey = readField<string>(source, 'orderKey');
      const orderKey = isValidOrderKey(rawOrderKey) ? rawOrderKey : 'a0';
      const rawColor = readField<string>(source, 'color');
      const createdAt = readField<number>(source, 'createdAt');

      if (!id) continue;

      result.push({
        id,
        boardId,
        title,
        orderKey,
        color: rawColor ? sanitizeHexColor(rawColor) : undefined,
        createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
      });
    }
    return result;
  }

  public createCard(card: Card): void {
    if (this.isDestroyed) return;
    this.ydoc.transact(() => {
      const yCard = new Y.Map<unknown>();
      writeCardFields(yCard, {
        ...card,
        deleted: false,
        deletedAt: null,
        deletedAtEditCount: 0,
        editCount: 1,
      });
      this.cardsMap.set(card.id, yCard);
    });
  }

  public updateCardFields(cardId: string, updates: Partial<Card>): void {
    if (this.isDestroyed) return;
    const existing = this.cardsMap.get(cardId);
    if (!existing) return;

    this.ydoc.transact(() => {
      let yCard: Y.Map<unknown>;
      if (existing instanceof Y.Map) {
        yCard = existing;
      } else {
        yCard = new Y.Map<unknown>();
        writeCardFields(yCard, existing as Card);
        this.cardsMap.set(cardId, yCard);
      }

      if (updates.columnId !== undefined) yCard.set('columnId', updates.columnId);
      if (updates.title !== undefined) yCard.set('title', updates.title);
      if (updates.description !== undefined) yCard.set('description', updates.description);
      if (updates.orderKey !== undefined) yCard.set('orderKey', updates.orderKey);
      if (updates.labels !== undefined) yCard.set('labels', updates.labels);
      if (updates.priority !== undefined) yCard.set('priority', updates.priority);
      if (updates.dueDate !== undefined) yCard.set('dueDate', updates.dueDate);
      if (updates.assignee !== undefined) yCard.set('assignee', updates.assignee);
      if (updates.checklist !== undefined) yCard.set('checklist', updates.checklist);
      if (updates.storyPoints !== undefined) yCard.set('storyPoints', updates.storyPoints);
      yCard.set('deleted', false);
      yCard.set('deletedAt', null);
      yCard.set('deletedAtEditCount', 0);
      yCard.set('editCount', ((yCard.get('editCount') as number) || 1) + 1);
      yCard.set('updatedAt', updates.updatedAt ?? Date.now());
    });
  }

  public deleteCard(cardId: string): void {
    if (this.isDestroyed) return;
    this.ydoc.transact(() => {
      const existing = this.cardsMap.get(cardId);
      if (existing instanceof Y.Map) {
        const currentEditCount = (existing.get('editCount') as number) || 1;
        existing.set('deleted', true);
        existing.set('deletedAtEditCount', currentEditCount);
        existing.set('deletedAt', Date.now());
      } else {
        this.cardsMap.delete(cardId);
      }
    });
  }

  public updateCurrentUser(user: UserProfile): void {
    if (this.isDestroyed) return;
    this.latestUser = { ...user };
    const prev = (this.wsProvider.awareness.getLocalState() as AwarenessEnvelope | null)?.user;
    this.wsProvider.awareness.setLocalStateField('user', {
      userId: user.id,
      userName: user.name,
      avatarColor: user.color,
      cursor: prev?.cursor ?? null,
      activity: prev?.activity ?? null,
      lastActive: Date.now(),
    });
    if (this.hasLocalDocSynced) {
      this.syncCurrentUserInDoc(user);
    }
  }

  public updateCursor(cursor: CursorPosition | null): void {
    if (this.isDestroyed || this.isOffline) return;
    const user = (this.wsProvider.awareness.getLocalState() as AwarenessEnvelope | null)?.user;
    if (user) {
      this.wsProvider.awareness.setLocalStateField('user', {
        ...user,
        cursor,
        lastActive: Date.now(),
      });
    }
  }

  public updateActivity(activity: UserActivity | null): void {
    if (this.isDestroyed || this.isOffline) return;
    const user = (this.wsProvider.awareness.getLocalState() as AwarenessEnvelope | null)?.user;
    if (user) {
      this.wsProvider.awareness.setLocalStateField('user', {
        ...user,
        activity,
        lastActive: Date.now(),
      });
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', this.handleBrowserOffline);
      window.removeEventListener('online', this.handleBrowserOnline);
      window.removeEventListener('pagehide', this.handlePageHide);
      window.removeEventListener('pageshow', this.handlePageShow);
    }
    this.idbProvider.destroy();
    this.wsProvider.destroy();
    this.ydoc.destroy();
  }
}

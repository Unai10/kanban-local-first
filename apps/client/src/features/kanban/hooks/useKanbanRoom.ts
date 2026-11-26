import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  LIMITS,
  generateFractionalKey,
  generateUuid,
  compareOrderKeys,
  compareCards,
  compareColumns,
  sanitizeAssignee,
  sanitizeChecklist,
  sanitizeDueDate,
  sanitizeHexColor,
  sanitizeMultilineText,
  sanitizePriority,
  sanitizeSingleLineText,
  sanitizeStoryPoints,
  type BoardExportSnapshot,
  type BoardMember,
  type BoardRole,
  type BoardTemplateId,
  type Card,
  type CardComment,
  type Column,
  type Label,
  type ServerBoardMetaPayload,
  type UserActivity,
  type UserProfile,
  type UserPresence,
  type CursorPosition,
} from '@kanban/shared-types';
import { YjsRoomClient, type SyncStatus } from '../../../core/yjs/YjsRoomClient.js';

export type { SyncStatus };

export interface UseKanbanRoomOptions {
  boardId: string;
  boardTitle?: string;
  currentUser: UserProfile;
  inviteToken?: string;
  ownerToken?: string;
  joinCode?: string;
  userRole?: BoardRole;
  initialOwnerId?: string;
  initialOwnerName?: string;
  seedDemoCards?: boolean;
  initialTemplateId?: BoardTemplateId;
  initialImportSnapshot?: BoardExportSnapshot;
  onBoardDeleted?: () => void;
  onAuthError?: (message: string) => void;
  onOwnerResolved?: (meta: ServerBoardMetaPayload) => void;
}

/**
 * Hook React que conecta una sala Yjs específica (`boardId`) y expone
 * columnas, tarjetas, miembros, presencia de colaboradores y operaciones CRUD seguras.
 */
export function useKanbanRoom({
  boardId,
  boardTitle,
  currentUser,
  inviteToken = '',
  ownerToken,
  joinCode,
  userRole = 'member',
  initialOwnerId,
  initialOwnerName,
  seedDemoCards,
  initialTemplateId,
  initialImportSnapshot,
  onBoardDeleted,
  onAuthError,
  onOwnerResolved,
}: UseKanbanRoomOptions) {
  const [cards, setCards] = useState<Card[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);
  const [comments, setComments] = useState<CardComment[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'syncing'
  );
  const [collaborators, setCollaborators] = useState<UserPresence[]>([]);
  const clientRef = useRef<YjsRoomClient | null>(null);
  const canManageColumns = userRole === 'owner' || userRole === 'admin';

  const callbacksRef = useRef({
    onBoardDeleted,
    onAuthError,
    onOwnerResolved,
  });
  useEffect(() => {
    callbacksRef.current = { onBoardDeleted, onAuthError, onOwnerResolved };
  }, [onBoardDeleted, onAuthError, onOwnerResolved]);

  const initConfigRef = useRef({
    boardTitle,
    ownerToken,
    joinCode,
    userRole,
    initialOwnerId,
    initialOwnerName,
    seedDemoCards,
    initialTemplateId,
    initialImportSnapshot,
    currentUser,
  });
  useEffect(() => {
    initConfigRef.current = {
      boardTitle,
      ownerToken,
      joinCode,
      userRole,
      initialOwnerId,
      initialOwnerName,
      seedDemoCards,
      initialTemplateId,
      initialImportSnapshot,
      currentUser,
    };
  }, [
    boardTitle,
    ownerToken,
    joinCode,
    userRole,
    initialOwnerId,
    initialOwnerName,
    seedDemoCards,
    initialTemplateId,
    initialImportSnapshot,
    currentUser,
  ]);

  useEffect(() => {
    const updateLocalState = () => {
      const client = clientRef.current;
      if (!client) return;
      setColumns(client.getColumns().sort(compareColumns));
      setCards(client.getCards().sort(compareCards));
      setBoardMembers(client.getMembers());
      setComments(client.getComments());
    };

    const snap = initConfigRef.current;
    const client = new YjsRoomClient({
      boardId,
      boardTitle: snap.boardTitle,
      currentUser: snap.currentUser,
      inviteToken,
      ownerToken: snap.ownerToken,
      joinCode: snap.joinCode,
      initialRole: snap.userRole,
      initialOwnerId: snap.initialOwnerId,
      initialOwnerName: snap.initialOwnerName,
      seedDemoCards: snap.seedDemoCards,
      initialTemplateId: snap.initialTemplateId,
      initialImportSnapshot: snap.initialImportSnapshot,
      onSyncStatusChange: setSyncStatus,
      onCollaboratorsChange: setCollaborators,
      onDataChange: updateLocalState,
      onBoardDeleted: () => callbacksRef.current.onBoardDeleted?.(),
      onAuthError: msg => callbacksRef.current.onAuthError?.(msg),
      onOwnerResolved: meta => callbacksRef.current.onOwnerResolved?.(meta),
    });

    clientRef.current = client;
    updateLocalState();

    return () => {
      client.destroy();
      clientRef.current = null;
    };
  }, [boardId, inviteToken, joinCode, currentUser.id]);

  useEffect(() => {
    clientRef.current?.updateCurrentUser(currentUser);
  }, [currentUser]);

  useEffect(() => {
    clientRef.current?.setRole(userRole);
  }, [userRole]);

  const addCard = useCallback((
    columnId: string,
    rawTitle: string,
    rawDescription: string,
    labels: Label[] = [],
    extras?: Pick<Partial<Card>, 'priority' | 'dueDate' | 'assignee' | 'checklist' | 'storyPoints'>
  ) => {
    const client = clientRef.current;
    if (!client) return;

    const title = sanitizeSingleLineText(rawTitle, LIMITS.CARD_TITLE_MAX);
    if (!title) return;
    const description = sanitizeMultilineText(rawDescription, LIMITS.CARD_DESC_MAX, '');

    const colCards = client
      .getCards()
      .filter(c => c.columnId === columnId)
      .sort(compareCards);
    const lastCard = colCards[colCards.length - 1];
    const newOrderKey = generateFractionalKey(lastCard?.orderKey, null);
    const now = Date.now();

    const newCard: Card = {
      id: generateUuid(),
      boardId,
      columnId,
      title,
      description,
      orderKey: newOrderKey,
      labels: labels.slice(0, LIMITS.MAX_LABELS_PER_CARD),
      priority: sanitizePriority(extras?.priority),
      dueDate: sanitizeDueDate(extras?.dueDate),
      assignee: sanitizeAssignee(extras?.assignee),
      checklist: sanitizeChecklist(extras?.checklist),
      storyPoints: sanitizeStoryPoints(extras?.storyPoints),
      createdAt: now,
      updatedAt: now,
    };

    client.createCard(newCard);
  }, [boardId]);

  const updateCard = useCallback((cardId: string, updates: Partial<Card>) => {
    const client = clientRef.current;
    if (!client) return;

    const cleanUpdates: Partial<Card> = {
      ...updates,
      updatedAt: Date.now(),
    };
    if (updates.title !== undefined) {
      const cleanTitle = sanitizeSingleLineText(updates.title, LIMITS.CARD_TITLE_MAX);
      if (!cleanTitle) return;
      cleanUpdates.title = cleanTitle;
    }
    if (updates.description !== undefined) {
      cleanUpdates.description = sanitizeMultilineText(updates.description, LIMITS.CARD_DESC_MAX, '');
    }
    if (updates.labels !== undefined) {
      cleanUpdates.labels = updates.labels.slice(0, LIMITS.MAX_LABELS_PER_CARD);
    }
    if (updates.priority !== undefined) {
      cleanUpdates.priority = sanitizePriority(updates.priority);
    }
    if (updates.dueDate !== undefined) {
      cleanUpdates.dueDate = sanitizeDueDate(updates.dueDate);
    }
    if (updates.assignee !== undefined) {
      cleanUpdates.assignee = sanitizeAssignee(updates.assignee);
    }
    if (updates.checklist !== undefined) {
      cleanUpdates.checklist = sanitizeChecklist(updates.checklist);
    }
    if (updates.storyPoints !== undefined) {
      cleanUpdates.storyPoints = sanitizeStoryPoints(updates.storyPoints);
    }

    client.updateCardFields(cardId, cleanUpdates);
  }, []);

  const moveCard = useCallback((
    cardId: string,
    targetColumnId: string,
    prevKey?: string | null,
    nextKey?: string | null
  ): boolean => {
    const client = clientRef.current;
    if (!client) return false;

    const resolvedPrev = prevKey ?? null;
    const resolvedNext =
      resolvedPrev && nextKey && compareOrderKeys(resolvedPrev, nextKey) >= 0
        ? null
        : (nextKey ?? null);

    const newOrderKey = generateFractionalKey(resolvedPrev, resolvedNext);
    return client.updateCardFields(cardId, {
      columnId: targetColumnId,
      orderKey: newOrderKey,
      updatedAt: Date.now(),
    });
  }, []);

  const deleteCard = useCallback((cardId: string) => {
    clientRef.current?.deleteCard(cardId);
  }, []);

  const restoreCard = useCallback((cardId: string) => {
    clientRef.current?.restoreCard(cardId);
  }, []);

  const addColumn = useCallback((rawTitle: string, color?: string) => {
    const client = clientRef.current;
    if (!client || !canManageColumns) return;
    const title = sanitizeSingleLineText(rawTitle, LIMITS.COLUMN_TITLE_MAX);
    if (!title) return;
    const existing = client.getColumns().sort(compareColumns);
    if (existing.length >= LIMITS.MAX_COLUMNS_PER_BOARD) return;
    const lastCol = existing[existing.length - 1];
    const orderKey = generateFractionalKey(lastCol?.orderKey, null);
    const now = Date.now();
    client.createColumn({
      id: `col-${generateUuid().slice(0, 8)}`,
      boardId,
      title,
      orderKey,
      ...(color ? { color: sanitizeHexColor(color) } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }, [boardId, canManageColumns]);

  const updateColumn = useCallback((
    columnId: string,
    updates: Partial<Pick<Column, 'title' | 'color'>>
  ) => {
    const client = clientRef.current;
    if (!client || !canManageColumns) return;
    const clean: Partial<Pick<Column, 'title' | 'color'>> = {};
    if (updates.title !== undefined) {
      const cleanTitle = sanitizeSingleLineText(updates.title, LIMITS.COLUMN_TITLE_MAX);
      if (!cleanTitle) return;
      clean.title = cleanTitle;
    }
    if (updates.color !== undefined) {
      clean.color = updates.color ? sanitizeHexColor(updates.color) : '';
    }
    client.updateColumnFields(columnId, clean);
  }, [canManageColumns]);

  const moveColumn = useCallback((
    columnId: string,
    prevKey?: string | null,
    nextKey?: string | null
  ) => {
    const client = clientRef.current;
    if (!client || !canManageColumns) return;
    const resolvedPrev = prevKey ?? null;
    const resolvedNext =
      resolvedPrev && nextKey && compareOrderKeys(resolvedPrev, nextKey) >= 0
        ? null
        : (nextKey ?? null);
    const newOrderKey = generateFractionalKey(resolvedPrev, resolvedNext);
    client.updateColumnFields(columnId, { orderKey: newOrderKey });
  }, [canManageColumns]);

  const deleteColumn = useCallback((columnId: string, targetColumnIdForCards?: string | null) => {
    if (!canManageColumns) return;
    clientRef.current?.deleteColumn(columnId, targetColumnIdForCards);
  }, [canManageColumns]);

  const addComment = useCallback((cardId: string, rawText: string) => {
    const client = clientRef.current;
    if (!client) return;
    const text = sanitizeMultilineText(rawText, LIMITS.COMMENT_MAX, '');
    if (!text) return;
    if (client.getComments().length >= LIMITS.MAX_COMMENTS_PER_BOARD) return;
    client.addComment({
      id: `cmt-${generateUuid().slice(0, 12)}`,
      cardId,
      authorId: currentUser.id,
      authorName: currentUser.name,
      authorColor: currentUser.color,
      text,
      createdAt: Date.now(),
    });
  }, [currentUser.id, currentUser.name, currentUser.color]);

  const deleteComment = useCallback((commentId: string) => {
    clientRef.current?.deleteComment(commentId, currentUser.id);
  }, [currentUser.id]);

  const commentsByCardId = useMemo(() => {
    const map = new Map<string, CardComment[]>();
    for (const c of comments) {
      const list = map.get(c.cardId);
      if (list) {
        list.push(c);
      } else {
        map.set(c.cardId, [c]);
      }
    }
    return map;
  }, [comments]);

  const buildExportSnapshot = useCallback((title: string): BoardExportSnapshot => {
    const sortedCols = [...columns].sort(compareColumns);
    const sortedCards = [...cards].sort(compareCards);
    const activeCardIds = new Set(sortedCards.map(c => c.id));
    return {
      version: 1,
      exportedAt: Date.now(),
      title,
      columns: sortedCols.map(c => ({
        id: c.id,
        title: c.title,
        orderKey: c.orderKey,
        ...(c.color ? { color: c.color } : {}),
        createdAt: c.createdAt,
      })),
      cards: sortedCards.map(c => ({
        id: c.id,
        columnId: c.columnId,
        title: c.title,
        description: c.description,
        orderKey: c.orderKey,
        labels: c.labels,
        priority: c.priority ?? null,
        dueDate: c.dueDate ?? null,
        assignee: c.assignee ?? null,
        checklist: c.checklist ?? [],
        storyPoints: c.storyPoints ?? null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      comments: comments
        .filter(cm => activeCardIds.has(cm.cardId))
        .map(cm => ({
          id: cm.id,
          cardId: cm.cardId,
          authorId: cm.authorId,
          authorName: cm.authorName,
          authorColor: cm.authorColor,
          text: cm.text,
          createdAt: cm.createdAt,
        })),
    };
  }, [columns, cards, comments]);

  const updateCursor = useCallback((cursor: CursorPosition | null) => {
    clientRef.current?.updateCursor(cursor);
  }, []);

  const updateActivity = useCallback((activity: UserActivity | null) => {
    clientRef.current?.updateActivity(activity);
  }, []);

  return {
    columns,
    cards,
    boardMembers,
    comments,
    commentsByCardId,
    syncStatus,
    collaborators,
    addCard,
    updateCard,
    moveCard,
    deleteCard,
    restoreCard,
    addColumn,
    updateColumn,
    moveColumn,
    deleteColumn,
    addComment,
    deleteComment,
    buildExportSnapshot,
    updateCursor,
    updateActivity,
  };
}

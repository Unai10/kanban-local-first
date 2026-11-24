import { useState, useEffect, useRef, useCallback } from 'react';
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
  sanitizeMultilineText,
  sanitizePriority,
  sanitizeSingleLineText,
  sanitizeStoryPoints,
  type BoardMember,
  type Card,
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
  initialOwnerId?: string;
  initialOwnerName?: string;
  seedDemoCards?: boolean;
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
  initialOwnerId,
  initialOwnerName,
  seedDemoCards,
  onBoardDeleted,
  onAuthError,
  onOwnerResolved,
}: UseKanbanRoomOptions) {
  const [cards, setCards] = useState<Card[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'syncing'
  );
  const [collaborators, setCollaborators] = useState<UserPresence[]>([]);
  const clientRef = useRef<YjsRoomClient | null>(null);

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
    initialOwnerId,
    initialOwnerName,
    seedDemoCards,
    currentUser,
  });
  useEffect(() => {
    initConfigRef.current = {
      boardTitle,
      ownerToken,
      joinCode,
      initialOwnerId,
      initialOwnerName,
      seedDemoCards,
      currentUser,
    };
  }, [boardTitle, ownerToken, joinCode, initialOwnerId, initialOwnerName, seedDemoCards, currentUser]);

  useEffect(() => {
    const updateLocalState = () => {
      const client = clientRef.current;
      if (!client) return;
      setColumns(client.getColumns().sort(compareColumns));
      setCards(client.getCards().sort(compareCards));
      setBoardMembers(client.getMembers());
    };

    const snap = initConfigRef.current;
    const client = new YjsRoomClient({
      boardId,
      boardTitle: snap.boardTitle,
      currentUser: snap.currentUser,
      inviteToken,
      ownerToken: snap.ownerToken,
      joinCode: snap.joinCode,
      initialOwnerId: snap.initialOwnerId,
      initialOwnerName: snap.initialOwnerName,
      seedDemoCards: snap.seedDemoCards,
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
  ) => {
    const client = clientRef.current;
    if (!client) return;

    const resolvedPrev = prevKey ?? null;
    const resolvedNext =
      resolvedPrev && nextKey && compareOrderKeys(resolvedPrev, nextKey) >= 0
        ? null
        : (nextKey ?? null);

    const newOrderKey = generateFractionalKey(resolvedPrev, resolvedNext);
    client.updateCardFields(cardId, {
      columnId: targetColumnId,
      orderKey: newOrderKey,
      updatedAt: Date.now(),
    });
  }, []);

  const deleteCard = useCallback((cardId: string) => {
    clientRef.current?.deleteCard(cardId);
  }, []);

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
    syncStatus,
    collaborators,
    addCard,
    updateCard,
    moveCard,
    deleteCard,
    updateCursor,
    updateActivity,
  };
}

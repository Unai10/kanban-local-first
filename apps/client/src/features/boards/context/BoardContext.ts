import { createContext } from 'react';
import type { ServerBoardMetaPayload, UserBoardEntry, UserProfile } from '@kanban/shared-types';
import type { InitialBoardResolution } from '../../../core/storage/localBoardRepository.js';

export interface BoardContextValue {
  boardInfo: InitialBoardResolution;
  boards: UserBoardEntry[];
  currentUser: UserProfile;
  isSidebarOpen: boolean;
  isShareModalOpen: boolean;
  isCreateBoardModalOpen: boolean;
  isJoinModalOpen: boolean;
  isProfileModalOpen: boolean;
  notification: string | null;
  dismissNotification: () => void;
  openSidebar: () => void;
  closeSidebar: () => void;
  openShareModal: () => void;
  closeShareModal: () => void;
  openCreateBoardModal: () => void;
  closeCreateBoardModal: () => void;
  openJoinModal: () => void;
  closeJoinModal: () => void;
  openProfileModal: () => void;
  closeProfileModal: () => void;
  updateUserProfile: (name: string, color: string) => void;
  selectBoard: (newBoardId: string, token: string) => void;
  createBoard: (title: string) => void;
  renameBoard: (boardId: string, newTitle: string) => Promise<void>;
  joinBoard: (boardId: string, token: string, title?: string, ownerName?: string, joinCode?: string) => void;
  deleteBoard: (boardIdToDelete: string) => Promise<void>;
  leaveBoard: (boardIdToLeave: string) => Promise<void>;
  handleRemoteBoardDeleted: () => void;
  handleAuthError: (message: string) => void;
  handleOwnerResolved: (meta: ServerBoardMetaPayload) => void;
}

export const BoardContext = createContext<BoardContextValue | null>(null);

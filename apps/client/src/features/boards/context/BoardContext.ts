import { createContext } from 'react';
import type {
  AssignableBoardRole,
  BoardExportSnapshot,
  BoardTemplateId,
  ServerBoardMetaPayload,
  UserBoardEntry,
  UserProfile,
} from '@kanban/shared-types';
import type { InitialBoardResolution } from '../../../core/storage/localBoardRepository.js';

export type AppTheme = 'dark' | 'light';

export interface BoardContextValue {
  boardInfo: InitialBoardResolution;
  boards: UserBoardEntry[];
  currentUser: UserProfile;
  theme: AppTheme;
  toggleTheme: () => void;
  isSidebarOpen: boolean;
  isShareModalOpen: boolean;
  isCreateBoardModalOpen: boolean;
  isJoinModalOpen: boolean;
  isProfileModalOpen: boolean;
  isRolesModalOpen: boolean;
  isMetricsModalOpen: boolean;
  isShortcutsModalOpen: boolean;
  isOnboardingOpen: boolean;
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
  openRolesModal: () => void;
  closeRolesModal: () => void;
  openMetricsModal: () => void;
  closeMetricsModal: () => void;
  openShortcutsModal: () => void;
  closeShortcutsModal: () => void;
  openOnboarding: () => void;
  completeOnboarding: () => void;
  updateUserProfile: (name: string, color: string) => void;
  selectBoard: (newBoardId: string, token: string) => void;
  createBoard: (title: string, templateId?: BoardTemplateId) => void;
  importBoardFromSnapshot: (snapshot: BoardExportSnapshot) => void;
  renameBoard: (boardId: string, newTitle: string) => Promise<void>;
  updateMemberRole: (boardId: string, targetUserId: string, role: AssignableBoardRole) => Promise<boolean>;
  joinBoard: (boardId: string, token: string, title?: string, ownerName?: string, joinCode?: string) => void;
  deleteBoard: (boardIdToDelete: string) => Promise<void>;
  leaveBoard: (boardIdToLeave: string) => Promise<void>;
  handleRemoteBoardDeleted: () => void;
  handleAuthError: (message: string) => void;
  handleOwnerResolved: (meta: ServerBoardMetaPayload) => void;
}

export const BoardContext = createContext<BoardContextValue | null>(null);

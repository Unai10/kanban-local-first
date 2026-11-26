import type { BoardRole } from '../protocol.js';
import type { UUID } from './card.js';

/** Identidad local del usuario almacenada en el navegador. */
export interface UserProfile {
  id: UUID;
  name: string;
  color: string;
}

/** Entrada persistida en el historial local de tableros del usuario para el sidebar. */
export interface UserBoardEntry {
  id: UUID;
  title: string;
  role: BoardRole;
  ownerId?: string;
  ownerName?: string;
  inviteToken: string;
  ownerToken?: string;
  joinCode?: string;
  lastOpenedAt: number;
  previousTitle?: string;
  previousOwnerName?: string;
  pendingTitleSync?: boolean;
}

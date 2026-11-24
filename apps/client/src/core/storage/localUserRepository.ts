import {
  LIMITS,
  generateUuid,
  sanitizeHexColor,
  sanitizeSingleLineText,
  type UserProfile,
} from '@kanban/shared-types';

const USER_STORAGE_KEY = 'kanban_local_user_profile';

export const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899'
] as const;

function pickRandomColor(): string {
  const bytes = new Uint8Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return AVATAR_COLORS[bytes[0] % AVATAR_COLORS.length];
}

function generateDefaultName(): string {
  const bytes = new Uint16Array(1);
  globalThis.crypto.getRandomValues(bytes);
  const suffix = 100 + (bytes[0] % 900);
  return `Dev-${suffix}`;
}

/**
 * Repositorio local en `localStorage` para el perfil de usuario (ID estable, nombre y color).
 */
export const LocalUserRepository = {
  getUserProfile(): UserProfile {
    try {
      const raw = localStorage.getItem(USER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<UserProfile>;
        if (parsed && typeof parsed.id === 'string' && parsed.id.length > 0) {
          return {
            id: sanitizeSingleLineText(parsed.id, 64),
            name: sanitizeSingleLineText(parsed.name, LIMITS.USER_NAME_MAX, 'Usuario'),
            color: sanitizeHexColor(parsed.color, AVATAR_COLORS[0]),
          };
        }
      }
    } catch (err) {
      console.warn('[UserRepository] Error leyendo perfil de localStorage', err);
    }

    const newProfile: UserProfile = {
      id: `usr-${generateUuid()}`,
      name: generateDefaultName(),
      color: pickRandomColor(),
    };

    LocalUserRepository.saveUserProfile(newProfile);
    return newProfile;
  },

  saveUserProfile(profile: UserProfile): UserProfile {
    const sanitized: UserProfile = {
      id: sanitizeSingleLineText(profile.id, 64) || `usr-${generateUuid()}`,
      name: sanitizeSingleLineText(profile.name, LIMITS.USER_NAME_MAX, 'Usuario'),
      color: sanitizeHexColor(profile.color, AVATAR_COLORS[0]),
    };
    try {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(sanitized));
    } catch (err) {
      console.error('[UserRepository] Error guardando perfil', err);
    }
    return sanitized;
  }
};

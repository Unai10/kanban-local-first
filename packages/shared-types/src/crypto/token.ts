/**
 * Expresión regular estricta para tokens criptográficos de al menos 128 bits.
 */
export const TOKEN_REGEX = /^sec-[a-f0-9]{32,64}$/;

/**
 * Comprueba si una cadena tiene el formato válido de un token criptográfico seguro.
 */
export function isValidTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_REGEX.test(token);
}

/**
 * Genera un token criptográficamente seguro de 128 bits (16 bytes) en formato hexadecimal.
 * Falla de forma segura (fail-closed) si no existe un CSPRNG disponible.
 */
export function generateSecureToken(prefix: string = 'sec-'): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${prefix}${hex}`;
  }

  throw new Error('No hay un generador criptográfico seguro (crypto.getRandomValues) disponible');
}

/**
 * Genera un UUID v4 criptográficamente seguro.
 */
export function generateUuid(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    if (typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    if (typeof globalThis.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }

  throw new Error('No hay un generador criptográfico seguro disponible para UUID');
}

/**
 * Genera un identificador de sala o tablero seguro y legible.
 */
export function generateSecureId(prefix: string = 'tablero'): string {
  const token = generateSecureToken('').substring(0, 10);
  return `${prefix}-${token}`;
}

const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const JOIN_CODE_REGEX = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{3}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{3}$/;

export function isValidJoinCode(code: unknown): code is string {
  return typeof code === 'string' && JOIN_CODE_REGEX.test(code);
}

/**
 * Genera un código de sala corto y legible para humanos en formato XXX-XXX (ej. 8K2-9MW).
 * Falla de forma segura si no hay CSPRNG disponible.
 */
export function generateJoinCode(): string {
  if (typeof globalThis === 'undefined' || !globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error('No hay un generador criptográfico seguro disponible para joinCode');
  }
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  const part1 = Array.from(bytes.slice(0, 3), b => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join('');
  const part2 = Array.from(bytes.slice(3, 6), b => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join('');
  return `${part1}-${part2}`;
}

/**
 * Normaliza un código de sala introducido por el usuario, eliminando guiones, espacios y convirtiéndolo a mayúsculas.
 */
export function normalizeJoinCode(code: string): string {
  const clean = code.replace(/[-\s]/g, '').toUpperCase().trim();
  if (clean.length === 6) {
    return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  }
  return clean;
}

/**
 * Configuración de endpoints del cliente:
 * - En build de producción sin variables VITE_*, apunta al mismo origen (modo todo-en-uno).
 * - En desarrollo (Vite), apunta al backend local en el puerto 1234.
 */
export const APP_CONFIG = {
  getWsUrl: (): string => {
    const metaEnv = (import.meta as { env?: Record<string, unknown> }).env ?? {};
    if (typeof metaEnv.VITE_WS_URL === 'string' && metaEnv.VITE_WS_URL) {
      return metaEnv.VITE_WS_URL;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (!metaEnv.DEV) {
      return `${protocol}//${window.location.host}/rooms/`;
    }
    const host = window.location.hostname || 'localhost';
    return `${protocol}//${host}:1234/rooms/`;
  },
  getHttpApiUrl: (): string => {
    const metaEnv = (import.meta as { env?: Record<string, unknown> }).env ?? {};
    if (typeof metaEnv.VITE_API_URL === 'string' && metaEnv.VITE_API_URL) {
      return metaEnv.VITE_API_URL;
    }
    if (!metaEnv.DEV) {
      return window.location.origin;
    }
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const host = window.location.hostname || 'localhost';
    return `${protocol}//${host}:1234`;
  },
};

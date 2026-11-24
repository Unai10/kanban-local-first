import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerConfig {
  port: number;
  host?: string;
  nodeEnv: string;
  dbPath: string;
  allowedOrigins: string;
  trustProxy: boolean;
  maxWsPayloadBytes: number;
  roomIdleTtlMs: number;
  wsHeartbeatIntervalMs: number;
  staticDir?: string;
}

/**
 * Carga y normaliza la configuración del servidor desde variables de entorno.
 */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV || 'development';
  const defaultDataDir = path.resolve(__dirname, '../../data');
  const defaultDbPath = path.resolve(defaultDataDir, 'kanban-data.sqlite');
  const defaultStaticDir = path.resolve(__dirname, '../../../client/dist');

  // En producción exigimos CORS_ORIGIN explícito o modo todo-en-uno (same-host con STATIC_DIR).
  // En desarrollo permitimos los orígenes locales de Vite por defecto.
  const defaultOrigins =
    nodeEnv === 'production'
      ? ''
      : 'http://localhost:5173,http://127.0.0.1:5173';

  const resolvedStaticDir =
    env.STATIC_DIR !== undefined
      ? env.STATIC_DIR
      : nodeEnv === 'production' && fs.existsSync(path.join(defaultStaticDir, 'index.html'))
      ? defaultStaticDir
      : '';

  return {
    port: Number(env.PORT) || 1234,
    host: env.HOST || '0.0.0.0',
    nodeEnv,
    dbPath: env.DATABASE_PATH || defaultDbPath,
    allowedOrigins: env.CORS_ORIGIN !== undefined ? env.CORS_ORIGIN : defaultOrigins,
    trustProxy: env.TRUST_PROXY === 'true',
    maxWsPayloadBytes: Number(env.MAX_WS_PAYLOAD_BYTES) || 64 * 1024, // 64 KiB
    roomIdleTtlMs: Number(env.ROOM_IDLE_TTL_MS) || 5 * 60 * 1000, // 5 min
    wsHeartbeatIntervalMs: Number(env.WS_HEARTBEAT_INTERVAL_MS) || 15_000, // 15 s
    staticDir: resolvedStaticDir,
  };
}

export const SERVER_CONFIG = loadServerConfig();

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ROOM_NAME_REGEX,
  WS_CLOSE_CODE,
  isValidTokenFormat,
  sanitizeSingleLineText,
  LIMITS,
} from '@kanban/shared-types';
import { SERVER_CONFIG, type ServerConfig } from './config/env.js';
import { createBoardRepository, type BoardRepository } from './infrastructure/db/boardRepository.js';
import { createRoomManager, type RoomManager } from './rooms/roomManager.js';
import { createRateLimiter, type RateLimiter } from './security/rateLimiter.js';
import { createWsConnectionHandler, getClientIp } from './ws/wsHandler.js';

export function parseAllowedOrigins(allowedOriginsRaw: string): string[] {
  if (!allowedOriginsRaw || allowedOriginsRaw.trim() === '*') {
    return allowedOriginsRaw.trim() === '*' ? ['*'] : [];
  }
  return allowedOriginsRaw
    .split(',')
    .map(o => o.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean);
}

/** Comprueba si la cabecera Origin coincide exactamente con el Host servido (modo todo-en-uno). */
export function isSameHostOrigin(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (!origin || !hostHeader) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host.toLowerCase() === hostHeader.toLowerCase();
  } catch {
    return false;
  }
}

/** Comprueba si la cabecera Origin está autorizada según CORS_ORIGIN o same-host en modo SPA estática. */
export function isOriginAllowed(origin: string | undefined, allowedOriginsRaw: string, allowMissingOrigin: boolean = true): boolean {
  if (!origin) return allowMissingOrigin;
  const allowed = parseAllowedOrigins(allowedOriginsRaw);
  if (allowed.includes('*')) return true;
  return allowed.includes(origin.toLowerCase());
}

function getEffectiveHost(headers: http.IncomingHttpHeaders, trustProxy: boolean): string | undefined {
  if (trustProxy) {
    const xfh = headers['x-forwarded-host'];
    if (typeof xfh === 'string' && xfh.trim()) {
      return xfh.split(',')[0].trim();
    }
  }
  return headers.host;
}

function isRequestOriginAllowed(
  origin: string | undefined,
  headers: http.IncomingHttpHeaders,
  config: ServerConfig,
  hasStaticSpa: boolean,
  allowMissingOrigin: boolean
): boolean {
  if (isOriginAllowed(origin, config.allowedOrigins, allowMissingOrigin)) {
    return true;
  }
  const hostHeader = getEffectiveHost(headers, config.trustProxy);
  if (hasStaticSpa && !config.allowedOrigins && isSameHostOrigin(origin, hostHeader)) {
    return true;
  }
  return false;
}

/** Extrae el token Bearer de la cabecera `Authorization`. */
export function extractBearerToken(req: express.Request): string {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader !== 'string') return '';
  const trimmed = authHeader.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim();
  }
  return '';
}

export interface ServerAppInstance {
  app: express.Express;
  server: http.Server;
  wss: WebSocketServer;
  boardRepo: BoardRepository;
  roomManager: RoomManager;
  authRateLimiter: RateLimiter;
  apiRateLimiter: RateLimiter;
  close(): Promise<void>;
}

/**
 * Construye la instancia completa del servidor HTTP + WebSocket Kanban
 * con cabeceras de seguridad, rate limiting, SQLite y gestor de salas Yjs.
 */
export function createServerApp(config: ServerConfig = SERVER_CONFIG): ServerAppInstance {
  const boardRepo = createBoardRepository(config.dbPath);
  const roomManager = createRoomManager(boardRepo, {
    roomIdleTtlMs: config.roomIdleTtlMs,
  });
  const authRateLimiter = createRateLimiter({ windowMs: 60_000, maxAttempts: 15 });
  const apiRateLimiter = createRateLimiter({ windowMs: 60_000, maxAttempts: 30 });
  const metadataRateLimiter = createRateLimiter({ windowMs: 60_000, maxAttempts: 90 });
  const setupConnection = createWsConnectionHandler({
    boardRepo,
    roomManager,
    authRateLimiter,
    trustProxy: config.trustProxy,
  });

  const resolvedStaticDir = config.staticDir ? path.resolve(config.staticDir) : '';
  const hasStaticSpa = Boolean(
    resolvedStaticDir && fs.existsSync(path.join(resolvedStaticDir, 'index.html'))
  );

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const isApiRoute = req.path.startsWith('/api/') || req.path === '/health';
    const csp = !isApiRoute && hasStaticSpa
      ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss: http: https:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
      : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.nodeEnv === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use(
    cors((req, callback) => {
      const origin = req.headers.origin;
      if (isRequestOriginAllowed(origin, req.headers, config, hasStaticSpa, true)) {
        callback(null, {
          origin: true,
          methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization'],
        });
      } else {
        callback(new Error('Origen CORS no permitido'));
      }
    })
  );

  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      activeRooms: roomManager.getRoomCount(),
    });
  });

  // Buscar tablero mediante código corto XXX-XXX (con rate limit contra fuerza bruta)
  app.get('/api/boards/join/:code', (req, res) => {
    const clientIp = getClientIp(req, config.trustProxy);
    if (authRateLimiter.isLimited(clientIp)) {
      return res.status(429).json({ error: 'Demasiados intentos fallidos. Inténtalo más tarde.' });
    }

    const code = (req.params.code || '').trim();
    if (code.length < 3 || code.length > 64) {
      return res.status(400).json({ error: 'Código de sala inválido' });
    }

    const result = boardRepo.findBoardByJoinCode(code);
    if (!result.valid) {
      authRateLimiter.recordFailure(clientIp);
      if (result.deleted) {
        return res.status(410).json({ valid: false, deleted: true, error: 'El tablero ha sido eliminado permanentemente por su propietario' });
      }
      return res.status(404).json({ valid: false, deleted: false, error: 'Código de sala no encontrado o no válido' });
    }

    return res.json(result);
  });

  app.post('/api/boards', (req, res) => {
    const clientIp = getClientIp(req, config.trustProxy);
    if (!apiRateLimiter.consume(clientIp)) {
      return res.status(429).json({ error: 'Demasiadas peticiones. Inténtalo más tarde.' });
    }

    const { boardId, title, inviteToken, ownerToken, ownerId, ownerName, joinCode } = req.body ?? {};
    if (
      typeof boardId !== 'string' ||
      !ROOM_NAME_REGEX.test(boardId) ||
      !isValidTokenFormat(inviteToken) ||
      !isValidTokenFormat(ownerToken) ||
      typeof ownerId !== 'string' ||
      !sanitizeSingleLineText(ownerId, 64)
    ) {
      return res.status(400).json({ error: 'Datos de tablero inválidos' });
    }

    const result = boardRepo.registerBoard({
      boardId,
      title: sanitizeSingleLineText(title, LIMITS.BOARD_TITLE_MAX, 'Tablero Kanban'),
      inviteToken,
      ownerToken,
      ownerId,
      ownerName: sanitizeSingleLineText(ownerName, LIMITS.USER_NAME_MAX, 'Propietario'),
      joinCode: typeof joinCode === 'string' ? joinCode : undefined,
    });

    if (!result.ok) {
      if (result.reason === 'deleted') {
        return res.status(410).json({ error: 'El identificador de tablero fue eliminado permanentemente' });
      }
      if (result.reason === 'exists') {
        return res.status(409).json({ error: 'El tablero ya existe' });
      }
      return res.status(400).json({ error: 'Datos de tablero inválidos' });
    }

    return res.status(201).json({ status: 'ok', board: result.board });
  });

  app.post('/api/boards/metadata', (req, res) => {
    const clientIp = getClientIp(req, config.trustProxy);
    if (!metadataRateLimiter.consume(clientIp)) {
      return res.status(429).json({ error: 'Demasiadas peticiones. Inténtalo más tarde.' });
    }

    const { boards } = req.body ?? {};
    if (!Array.isArray(boards)) {
      return res.status(400).json({ error: 'Lista de tableros inválida' });
    }

    const result = boardRepo.getBoardsMetadata(boards);
    return res.json({ boards: result });
  });

  app.patch('/api/boards/owner-name', (req, res) => {
    const clientIp = getClientIp(req, config.trustProxy);
    if (!apiRateLimiter.consume(clientIp)) {
      return res.status(429).json({ error: 'Demasiadas peticiones. Inténtalo más tarde.' });
    }

    const { ownerId, ownerName, boards } = req.body ?? {};
    if (
      typeof ownerId !== 'string' ||
      typeof ownerName !== 'string' ||
      !Array.isArray(boards)
    ) {
      return res.status(400).json({ error: 'Datos inválidos para actualizar el nombre del propietario' });
    }

    const updatedBoards = boardRepo.updateOwnerNameForBoards(ownerId, ownerName, boards);
    for (const board of updatedBoards) {
      roomManager.broadcastBoardMeta(board.id, board);
    }

    return res.json({
      status: 'ok',
      updatedBoardIds: updatedBoards.map(b => b.id),
    });
  });

  app.patch('/api/boards/:boardId', (req, res) => {
    const clientIp = getClientIp(req, config.trustProxy);
    if (authRateLimiter.isLimited(clientIp)) {
      return res.status(429).json({ error: 'Demasiados intentos fallidos. Inténtalo más tarde.' });
    }

    const { boardId } = req.params;
    if (!ROOM_NAME_REGEX.test(boardId)) {
      return res.status(400).json({ error: 'Identificador de tablero inválido' });
    }

    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Token de propietario requerido' });
    }

    const { title } = req.body ?? {};
    if (typeof title !== 'string') {
      return res.status(400).json({ error: 'Título inválido' });
    }

    const result = boardRepo.updateBoardTitle(boardId, token, title);
    if (!result.ok) {
      if (result.reason === 'forbidden') {
        authRateLimiter.recordFailure(clientIp);
        return res.status(403).json({ error: 'No autorizado para editar este tablero' });
      }
      if (result.reason === 'not_found') {
        authRateLimiter.recordFailure(clientIp);
        return res.status(404).json({ error: 'Tablero no encontrado' });
      }
      return res.status(400).json({ error: 'Título de tablero inválido' });
    }

    roomManager.broadcastBoardMeta(boardId, result.board);
    return res.json({ status: 'ok', board: result.board });
  });

  // Abandono explícito de tablero: limpia la asignación de tarjetas del usuario saliente en el Y.Doc
  app.post('/api/boards/:boardId/leave', (req, res) => {
    const clientIp = getClientIp(req, config.trustProxy);
    if (!apiRateLimiter.consume(clientIp) || authRateLimiter.isLimited(clientIp)) {
      return res.status(429).json({ error: 'Demasiadas peticiones. Inténtalo más tarde.' });
    }

    const { boardId } = req.params;
    if (!ROOM_NAME_REGEX.test(boardId)) {
      return res.status(400).json({ error: 'Identificador de tablero inválido' });
    }

    const { userId, inviteToken, ownerToken, joinCode } = req.body ?? {};
    const cleanUserId = sanitizeSingleLineText(userId, 64);
    if (!cleanUserId) {
      return res.status(400).json({ error: 'Identificador de usuario inválido' });
    }

    const access = boardRepo.verifyBoardAccess(boardId, {
      inviteToken: typeof inviteToken === 'string' ? inviteToken : undefined,
      ownerToken: typeof ownerToken === 'string' ? ownerToken : undefined,
      joinCode: typeof joinCode === 'string' ? joinCode : undefined,
    });

    if (!access.valid) {
      if (access.reason === 'deleted' || access.reason === 'not_found') {
        return res.json({ status: 'ok', left: false });
      }
      authRateLimiter.recordFailure(clientIp);
      return res.status(403).json({ error: 'No autorizado para operar sobre este tablero' });
    }

    roomManager.removeMemberFromBoard(boardId, cleanUserId);
    return res.json({ status: 'ok', left: true });
  });

  app.delete('/api/boards/:boardId', (req, res) => {
    const clientIp = getClientIp(req, config.trustProxy);
    if (authRateLimiter.isLimited(clientIp)) {
      return res.status(429).json({ error: 'Demasiados intentos fallidos. Inténtalo más tarde.' });
    }

    const { boardId } = req.params;
    if (!ROOM_NAME_REGEX.test(boardId)) {
      return res.status(400).json({ error: 'Identificador de tablero inválido' });
    }

    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Token de propietario requerido' });
    }

    const result = boardRepo.deleteBoard(boardId, token);
    if (result === 'forbidden') {
      authRateLimiter.recordFailure(clientIp);
      return res.status(403).json({ error: 'No autorizado para eliminar este tablero' });
    }
    if (result === 'not_found') {
      authRateLimiter.recordFailure(clientIp);
      return res.status(404).json({ error: 'Tablero no encontrado' });
    }

    roomManager.destroyRoomAndNotify(
      boardId,
      WS_CLOSE_CODE.BOARD_DELETED,
      'Tablero eliminado por su propietario'
    );
    return res.json({ status: 'ok', deleted: boardId });
  });

  if (hasStaticSpa) {
    app.use(
      express.static(resolvedStaticDir, {
        maxAge: '7d',
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (
            base === 'index.html' ||
            base === 'sw.js' ||
            base === 'registerSW.js' ||
            base === 'manifest.webmanifest'
          ) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/rooms/') || req.path === '/health') {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(resolvedStaticDir, 'index.html'));
    });
  }

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.message === 'Origen CORS no permitido') {
      return res.status(403).json({ error: 'Origen no permitido' });
    }
    if ('type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON inválido' });
    }
    return res.status(500).json({ error: 'Error interno del servidor' });
  });

  const server = http.createServer(app);

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxWsPayloadBytes,
    handleProtocols: (protocols: Set<string>) => {
      if (protocols.size === 0) return '';
      if (protocols.has('yjs-v1')) return 'yjs-v1';
      return false;
    },
  });

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach(ws => {
      const extWs = ws as WebSocket & { isAlive?: boolean };
      if (extWs.isAlive === false) {
        extWs.terminate();
        return;
      }
      extWs.isAlive = false;
      try {
        extWs.ping();
      } catch {
        extWs.terminate();
      }
    });
  }, config.wsHeartbeatIntervalMs);
  heartbeatInterval.unref?.();

  server.on('upgrade', (request, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url || '', 'http://localhost');
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const pathname = url.pathname;
    if (!pathname.startsWith('/rooms/')) {
      socket.write('HTTP/1.1 400 Bad Request: Ruta no permitida\r\n\r\n');
      socket.destroy();
      return;
    }

    const roomName = pathname.replace(/^\/rooms\//, '');
    if (!ROOM_NAME_REGEX.test(roomName)) {
      socket.write('HTTP/1.1 400 Bad Request: Nombre de sala inválido\r\n\r\n');
      socket.destroy();
      return;
    }

    const origin = request.headers.origin;
    if (
      !isRequestOriginAllowed(
        origin,
        request.headers,
        config,
        hasStaticSpa,
        config.nodeEnv !== 'production'
      )
    ) {
      console.warn(`[Seguridad CSWSH] WebSocket rechazado por Origin no permitido: '${origin ?? 'none'}'`);
      socket.write('HTTP/1.1 403 Forbidden: Origen no permitido\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, ws => {
      setupConnection(ws, request);
    });
  });

  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatInterval);
    authRateLimiter.destroy();
    apiRateLimiter.destroy();
    metadataRateLimiter.destroy();
    roomManager.closeAll();

    await new Promise<void>(resolve => {
      wss.close(() => resolve());
    });

    await new Promise<void>(resolve => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
      server.closeAllConnections?.();
    });

    boardRepo.close();
  }

  return {
    app,
    server,
    wss,
    boardRepo,
    roomManager,
    authRateLimiter,
    apiRateLimiter,
    close,
  };
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  typeof process.argv[1] === 'string' &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  const hasStaticAtBoot = Boolean(
    SERVER_CONFIG.staticDir && fs.existsSync(path.join(path.resolve(SERVER_CONFIG.staticDir), 'index.html'))
  );
  if (SERVER_CONFIG.nodeEnv === 'production' && !SERVER_CONFIG.allowedOrigins && !hasStaticAtBoot) {
    console.warn('[Seguridad] CORS_ORIGIN no está definido en producción; todas las peticiones de navegador serán rechazadas.');
  }

  const instance = createServerApp(SERVER_CONFIG);
  const listenHost = SERVER_CONFIG.host || '0.0.0.0';

  instance.server.listen(SERVER_CONFIG.port, listenHost, () => {
    console.log(`[Servidor Kanban] Listo en http://${listenHost}:${SERVER_CONFIG.port}`);
    console.log(`[Servidor Kanban] WebSocket endpoint: ws://${listenHost}:${SERVER_CONFIG.port}/rooms/:boardId`);
    console.log(`[Servidor Kanban] Base de datos en: ${SERVER_CONFIG.dbPath}`);
    if (hasStaticAtBoot) {
      console.log(`[Servidor Kanban] Sirviendo PWA estática desde: ${SERVER_CONFIG.staticDir}`);
    }
  });

  const shutdown = () => {
    console.log('[Servidor Kanban] Apagado elegante en curso...');
    void instance.close().then(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

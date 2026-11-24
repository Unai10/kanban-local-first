# ==============================================================================
# Dockerfile multi-etapa para Kanban Local-First (Frontend PWA + Backend WS + SQLite)
# ==============================================================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Dependencias nativas para compilar better-sqlite3 si no hubiera binario precompilado
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json

RUN npm ci

COPY packages ./packages
COPY apps ./apps

RUN npm run build && npm prune --omit=dev

# ==============================================================================
# Imagen final mínima de producción
# ==============================================================================
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=1234
ENV HOST=0.0.0.0
ENV TRUST_PROXY=true
ENV DATABASE_PATH=/data/kanban-data.sqlite
ENV STATIC_DIR=/app/apps/client/dist

RUN mkdir -p /data && chown -R node:node /app /data

COPY --chown=node:node package.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --chown=node:node --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --chown=node:node --from=builder /app/apps/server/package.json ./apps/server/package.json
COPY --chown=node:node --from=builder /app/apps/server/dist ./apps/server/dist
COPY --chown=node:node --from=builder /app/apps/client/dist ./apps/client/dist

USER node

EXPOSE 1234

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 1234) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]

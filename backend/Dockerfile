# syntax=docker/dockerfile:1

# ---- Build stage -----------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests first so dependency layers cache independently of source.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# The frontend workspace is not needed to build the API, but npm requires
# every workspace manifest present to resolve the lockfile.
RUN npm ci --workspace=backend --include-workspace-root

COPY backend/prisma ./backend/prisma
RUN npx prisma generate --schema backend/prisma/schema.prisma

COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src
RUN npm run build --workspace=backend

# Drop dev dependencies from the tree that gets copied forward.
RUN npm prune --omit=dev --workspace=backend --include-workspace-root

# ---- Runtime stage ---------------------------------------------------------
FROM node:22-alpine AS runtime

# dumb-init reaps zombies and forwards signals, so graceful shutdown works.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
WORKDIR /app

# Run unprivileged. node:alpine ships a `node` user (uid 1000) already.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/backend/dist ./backend/dist
COPY --from=builder --chown=node:node /app/backend/prisma ./backend/prisma
COPY --from=builder --chown=node:node /app/backend/package.json ./backend/
COPY --from=builder --chown=node:node /app/package.json ./

USER node

EXPOSE 4000

# Uses the readiness probe, so an unhealthy database marks the container
# unhealthy rather than leaving it serving errors.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "backend/dist/server.js"]

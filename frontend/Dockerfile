# syntax=docker/dockerfile:1

# ---- Build stage -----------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci --workspace=frontend --include-workspace-root

COPY frontend ./frontend

# Baked into the client bundle at build time, so it must be present here
# rather than only at runtime.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build --workspace=frontend

# ---- Runtime stage ---------------------------------------------------------
FROM node:22-alpine AS runtime

RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

# Next's standalone output bundles only the server code and the modules it
# actually imports, which keeps the runtime image small.
COPY --from=builder --chown=node:node /app/frontend/.next/standalone ./
COPY --from=builder --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=node:node /app/frontend/public ./frontend/public

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "frontend/server.js"]

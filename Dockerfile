# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (layer-cached unless package files change)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies so only production modules are copied to the final image
RUN npm prune --omit=dev

# ── Stage 2: production image ──────────────────────────────────────────────────
FROM node:22-alpine AS production

ENV NODE_ENV=production
ENV PORT=6767

WORKDIR /app

# Run as a non-root user
RUN addgroup -S scheduler && adduser -S scheduler -G scheduler

# Copy only what is needed at runtime
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

USER scheduler

EXPOSE $PORT

# Docker / k8s health probe — /health is unauthenticated by design
# Shell form used so $PORT is expanded at runtime
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:$PORT/health || exit 1

CMD ["node", "dist/index.js"]

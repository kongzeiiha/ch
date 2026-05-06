FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Install dependencies (workspace-aware)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json     packages/db/
COPY packages/agents/package.json packages/agents/
COPY apps/api/package.json        apps/api/
RUN pnpm install --frozen-lockfile

# Build TypeScript
FROM deps AS builder
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter @ch/db build 2>/dev/null || true
RUN pnpm --filter @ch/agents build 2>/dev/null || true
RUN pnpm --filter @ch/api build

# Runtime image
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json           ./
COPY --from=builder /app/pnpm-lock.yaml         ./
COPY --from=builder /app/pnpm-workspace.yaml    ./
COPY --from=builder /app/node_modules           ./node_modules
COPY --from=builder /app/packages/db/dist       packages/db/dist
COPY --from=builder /app/packages/db/package.json packages/db/
COPY --from=builder /app/packages/agents/dist   packages/agents/dist
COPY --from=builder /app/packages/agents/package.json packages/agents/
COPY --from=builder /app/apps/api/dist          apps/api/dist
COPY --from=builder /app/apps/api/package.json  apps/api/
COPY --from=builder /app/apps/api/node_modules  apps/api/node_modules

EXPOSE 4000
# Override CMD when running as worker: docker run ... node apps/api/dist/worker.js
CMD ["node", "apps/api/dist/index.js"]

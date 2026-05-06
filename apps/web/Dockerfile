FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json     packages/db/
COPY packages/agents/package.json packages/agents/
COPY apps/web/package.json        apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY packages/ packages/
COPY apps/web/ apps/web/
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @ch/web build

FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/package.json           ./
COPY --from=builder /app/pnpm-lock.yaml         ./
COPY --from=builder /app/pnpm-workspace.yaml    ./
COPY --from=builder /app/node_modules           ./node_modules
COPY --from=builder /app/apps/web/.next         apps/web/.next
COPY --from=builder /app/apps/web/public        apps/web/public
COPY --from=builder /app/apps/web/package.json  apps/web/
COPY --from=builder /app/apps/web/node_modules  apps/web/node_modules

EXPOSE 3000
CMD ["pnpm", "--filter", "@ch/web", "start"]

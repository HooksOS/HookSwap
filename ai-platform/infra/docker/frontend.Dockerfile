# ============================================================================
# FALLBACK frontend image — used if ai-platform/frontend/ ships no Dockerfile.
# Next.js 15 (App Router) · standalone output · exposes :3000
#   build: docker build -f infra/docker/frontend.Dockerfile -t ai-frontend ./frontend
#
# Requires next.config.js `output: "standalone"`.
# ============================================================================
# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat curl
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN corepack enable && \
    (test -f pnpm-lock.yaml && pnpm i --frozen-lockfile) || \
    (test -f yarn.lock && yarn --frozen-lockfile) || \
    (test -f package-lock.json && npm ci) || npm i

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && \
    (test -f pnpm-lock.yaml && pnpm build) || \
    (test -f yarn.lock && yarn build) || npm run build

# ---- runtime (standalone) ----
FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN addgroup -g 10003 nodegrp && adduser -u 10003 -G nodegrp -S nextjs
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodegrp /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodegrp /app/.next/static ./.next/static
USER nextjs

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:3000/api/health || curl -fsS http://localhost:3000 || exit 1

CMD ["node", "server.js"]

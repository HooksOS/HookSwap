# HookSwap data-api — Connect-RPC / protobuf markets+token data server (public: data.hookswap.org → :4092).
# Multi-stage: build (TS→dist) → prod-deps (prune, compile native better-sqlite3) → slim runtime.
#
# NOTE on better-sqlite3: it's a NATIVE module (needs python3/make/g++ to compile). The full `node:22`
# image is Debian bookworm + buildpack-deps (toolchain present), so the native build succeeds there.
# We compile prod deps in the toolchain'd `deps` stage and COPY node_modules into `node:22-slim`
# (same Debian bookworm / glibc / N-API ABI → the compiled .node binary is binary-compatible). We do
# NOT run `npm install` in the slim runtime (it has no compiler → native build would fail).
#
# Build:  docker build -t hookswap-data-api ./data-api
# Run:    docker run --env-file .env -p 4092:4092 hookswap-data-api

# ---- 1. build: full toolchain, install all deps, compile TS → dist/ ----
FROM node:22 AS build
WORKDIR /app
# No lockfile committed (installs deferred per package.json note) → plain `npm install`.
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

# ---- 2. deps: production-only node_modules (native modules compiled with the full toolchain) ----
FROM node:22 AS deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev

# ---- 3. runtime: slim, no compiler; just the prebuilt dist + prod node_modules ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4092
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 4092
# Health: GET /health (wget is present in node:22-slim).
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4092/health || exit 1
CMD ["node", "dist/server.js"]

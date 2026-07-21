# HookSwapPerps stack image — CODE ONLY (no env, no keys, no state).
# One image runs all three services; docker-compose picks the entrypoint per
# service (engine / bot / keeper). Runs TypeScript directly with tsx — NO build step.
FROM node:22-slim

WORKDIR /app

# --- deps -------------------------------------------------------------------
# Copy manifests first for layer caching. package-lock.json may not exist (repo
# uses bun.lock); package*.json copies the lock only if present. tsx lives in
# devDependencies, so a plain `npm install` (NOT --production) is required.
COPY package.json package*.json ./
RUN npm install --no-audit --no-fund

# --- source (runtime dirs the code actually imports) ------------------------
#  src/     — engine entrypoint (src/index.ts) + server/settle/persist
#  oracle/  — imported by src/mark.ts (`../oracle/index.js`) → REQUIRED by engine
#  bot/     — counterparty bot entrypoint (bot/bot.ts), imports ../src/abis.js
#  keeper/  — keeper entrypoint (keeper/keeperMain.ts) + its own submodules
#  config/  — example market/route JSON (only read if PERPS_ENGINE_MARKETS points here)
#  tsconfig.json — module resolution for tsx
COPY tsconfig.json ./
COPY src/ ./src/
COPY oracle/ ./oracle/
COPY bot/ ./bot/
COPY keeper/ ./keeper/
COPY config/ ./config/

# Engine is the default entrypoint; compose overrides `command:` for bot/keeper.
# The engine binds ENV.port (PORT env, default 4100) on 0.0.0.0 inside the container.
CMD ["node_modules/.bin/tsx", "src/index.ts"]

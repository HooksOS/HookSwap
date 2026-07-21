# HookSwap locker + farms indexer — read-only RPC indexer, no secrets.
FROM node:22-slim

WORKDIR /app

# Install deps (viem + tsx dev-dep — tsx runs the TS directly, no build step).
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

# Overridden by compose; default matches the service port.
ENV PORT=4205
ENV LOCKER_REFRESH_MS=300000

EXPOSE 4205
CMD ["node_modules/.bin/tsx", "src/index.ts"]

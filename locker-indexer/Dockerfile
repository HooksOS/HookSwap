# HookSwap locker + farms indexer — read-only RPC indexer, no secrets.
FROM node:22-slim

WORKDIR /app

# Install deps (viem + @resvg/resvg-js + tsx dev-dep — tsx runs the TS directly, no
# build step). @resvg/resvg-js (per-lock OG PNG renderer) ships a prebuilt N-API
# binary; `npm install` resolves the linux-x64-gnu build for this glibc base — no
# native toolchain needed.
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
# `src` includes src/assets/fonts/*.ttf — the OG card fonts, embedded at render time
# (no network fetch). resvg-js does not decode woff2, so these are TTF.
COPY src ./src

# Overridden by compose; default matches the service port.
ENV PORT=4205
ENV LOCKER_REFRESH_MS=300000

EXPOSE 4205
CMD ["node_modules/.bin/tsx", "src/index.ts"]

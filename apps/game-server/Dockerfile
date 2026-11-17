# Office Kart game server.
# Build context is the REPOSITORY ROOT (the server bundles packages/shared):
#   docker build -f apps/game-server/Dockerfile -t office-kart-server .

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/game-server/package.json apps/game-server/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @office-kart/game-server --workspace @office-kart/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/game-server apps/game-server
RUN npm run build -w @office-kart/game-server

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/game-server/package.json apps/game-server/
COPY apps/web/package.json apps/web/
# Production dependencies only; the shared package is already bundled into dist.
RUN npm ci --omit=dev --workspace @office-kart/game-server && npm cache clean --force
COPY --from=build /app/apps/game-server/dist apps/game-server/dist
USER node
# Railway injects PORT; 2567 is only the local default.
EXPOSE 2567
CMD ["node", "--enable-source-maps", "apps/game-server/dist/server.js"]

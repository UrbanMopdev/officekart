# Office Kart web client: Vite build served as static files by Caddy.
# Build context is the REPOSITORY ROOT (the client imports packages/shared):
#   docker build -f apps/web/Dockerfile --build-arg VITE_GAME_SERVER_URL=wss://<game-server-domain> -t office-kart-web .

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/game-server/package.json apps/game-server/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @office-kart/web --workspace @office-kart/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web

# Vite inlines VITE_* values at build time. On Railway, service variables with
# these names are passed in as build arguments automatically. Only public
# values belong here: anything prefixed VITE_ ends up in the browser bundle.
ARG VITE_GAME_SERVER_URL
ARG VITE_API_URL
ENV VITE_GAME_SERVER_URL=$VITE_GAME_SERVER_URL
ENV VITE_API_URL=$VITE_API_URL
RUN test -n "$VITE_GAME_SERVER_URL" || (echo "ERROR: VITE_GAME_SERVER_URL is not set. Set it on the web service to the game server's public domain." >&2 && exit 1)
RUN npm run build -w @office-kart/web

FROM caddy:2-alpine AS runtime
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
# Railway injects PORT; 8080 is only the local default.
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

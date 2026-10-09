# syntax=docker/dockerfile:1
# The game's server (docs/SERVER.md): Node 22 runs the TypeScript directly. One image for both processes: the API
# (this CMD) and the real-time server (deploy/compose.yml runs `node server/src/rt/main.ts` in it).
# Built and pushed to ghcr.io/limmylem/kugelsackracing by GitHub Actions (.github/workflows/server.yml), run on the
# server by deploy/compose.yml, and built by Docker Compose for local development (docker-compose.yml).
# Secrets come from the environment at run time, never from the image.

# ---- build: the dependencies, and the shared package's browser bundle ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY packages/shared packages/shared
RUN npm run --silent build:shared && npm prune --omit=dev --no-audit --no-fund

# ---- run: only what the server needs, as a user without privileges ----
FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/limmylem/kugelsackracing
ENV NODE_ENV=production APP_ENV=production PORT=8787 HOST=0.0.0.0
WORKDIR /app
# (the map files, cars, parts and sounds first, in a layer of their own: 277 MB that a change to the code doesn't
# copy, push or pull again — the server reads the maps' manifests and road graphs from it; the code after it, without
# them: COPY --exclude, Dockerfile syntax 1.19 or later, as the first line asks)
COPY assets assets
# (the dependencies installed once, in the build, the development tools pruned away)
COPY --from=build /app/node_modules node_modules
COPY --exclude=assets . .
COPY --from=build /app/packages/shared/dist packages/shared/dist
ARG GIT_COMMIT=dev
ENV GIT_COMMIT=$GIT_COMMIT
USER node
# (8787 the API; 2567 the real-time server, when this image runs that)
EXPOSE 8787 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/src/main.ts"]

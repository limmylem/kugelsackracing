# The game's server, and the game it serves (docs/SERVER.md): Node 22 runs the TypeScript directly.
# Built by Render (render.yaml) and by Docker Compose for local development (docker-compose.yml).
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
ENV NODE_ENV=production APP_ENV=production PORT=8787 HOST=0.0.0.0
WORKDIR /app
COPY . .
# (the dependencies installed once, in the build, the development tools pruned away)
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
ARG GIT_COMMIT=dev
ENV GIT_COMMIT=$GIT_COMMIT
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/src/main.ts"]

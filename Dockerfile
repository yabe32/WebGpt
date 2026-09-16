FROM node:22-bookworm-slim AS build
WORKDIR /app
# The production server has 4 GB RAM. Keep the Node build heap bounded so a
# client bundle cannot trigger the host OOM killer while the app is running.
ENV NODE_OPTIONS=--max-old-space-size=1024
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
# Client assets depend only on client sources. This cache survives server-only
# updates such as v0.2.1 and avoids rebuilding the large HEIC bundle.
RUN npx tsc --noEmit -p tsconfig.client.json && npx vite build
COPY server ./server
RUN npx tsc -p tsconfig.server.json
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node scripts/start.mjs ./scripts/start.mjs
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATA_DIR=/data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3001/api/auth').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]

# syntax=docker/dockerfile:1
# Stage 1: build the web app (dist/) and bundle the API server + CLI/MCP (dist-node/).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:node && npm run build:server

# Stage 2: runtime with production dependencies only (the bundles keep packages external).
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8787 \
    PIXEL_BUILDER_DATA=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-node ./dist-node
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Default: API + built web app. The MCP service overrides the command (see docker-compose.yml).
CMD ["node", "dist-node/server.mjs"]

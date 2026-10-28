FROM node:24-alpine AS build
ARG VITE_LIVE_WORKSPACES=false
ENV VITE_LIVE_WORKSPACES=$VITE_LIVE_WORKSPACES
WORKDIR /app
COPY package*.json tsconfig.base.json LICENSE ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY apps apps
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-alpine AS live
ENV NODE_ENV=production PORT=3100 DEMO_ONLY=true EMBEDDED_WORKER=false
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/packages packages
COPY --from=build --chown=node:node /app/apps apps
COPY --from=build --chown=node:node /app/LICENSE LICENSE
COPY --chown=node:node tools/*.mjs tools/
USER node
EXPOSE 3100
CMD ["node", "apps/server/dist/index.js"]

# Default deployment contains no database, queue, auth SDK, or provider runtime.
FROM node:24-alpine AS public
ENV NODE_ENV=production PORT=3100 HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/dist apps/web/dist
COPY --chown=node:node tools/serve.mjs tools/serve.mjs
USER node
EXPOSE 3100
CMD ["node", "tools/serve.mjs"]

# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# Tools the agent's bash tool commonly reaches for.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep curl ca-certificates openssh-client jq less procps \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOME=/home/node \
    PI_WEB_HOST=0.0.0.0 \
    PI_WEB_PORT=8787 \
    PI_WEB_CWD=/workspace

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir -p /workspace /home/node/.pi/agent && chown -R node:node /workspace /home/node/.pi
USER node

# pi config, credentials and session files (the threads) live here.
VOLUME ["/home/node/.pi"]
EXPOSE 8787
CMD ["node", "dist/server/server/index.js"]

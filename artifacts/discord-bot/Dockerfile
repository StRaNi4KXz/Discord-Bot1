FROM node:24-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/discord-bot/package.json ./artifacts/discord-bot/package.json

RUN pnpm install --filter @workspace/discord-bot --no-frozen-lockfile

COPY artifacts/discord-bot/src ./artifacts/discord-bot/src
COPY artifacts/discord-bot/tsconfig.json ./artifacts/discord-bot/tsconfig.json

RUN pnpm --filter @workspace/discord-bot run build

FROM node:24-alpine
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/discord-bot/package.json ./artifacts/discord-bot/package.json

RUN pnpm install --filter @workspace/discord-bot --prod --no-frozen-lockfile

COPY --from=builder /app/artifacts/discord-bot/dist ./artifacts/discord-bot/dist

ENV DATA_DIR=/data
VOLUME ["/data"]

CMD ["node", "--enable-source-maps", "artifacts/discord-bot/dist/index.js"]

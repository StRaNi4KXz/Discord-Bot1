FROM node:24-alpine
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/discord-bot/package.json ./artifacts/discord-bot/package.json

RUN pnpm install --frozen-lockfile --filter @workspace/discord-bot

COPY artifacts/discord-bot/ ./artifacts/discord-bot/

RUN pnpm --filter @workspace/discord-bot run build

ENV DATA_DIR=/data
VOLUME ["/data"]

CMD ["node", "--enable-source-maps", "artifacts/discord-bot/dist/index.js"]

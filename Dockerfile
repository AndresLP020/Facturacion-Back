FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci --include=dev
COPY backend/tsconfig.json backend/nest-cli.json ./backend/
COPY backend/prisma ./backend/prisma
COPY backend/src ./backend/src
COPY packages/contracts ./packages/contracts
RUN npm run prisma:generate --workspace backend && npm run build --workspace backend

FROM node:24-bookworm-slim
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/backend/node_modules ./backend/node_modules
COPY --from=build /repo/backend/package.json ./backend/package.json
COPY --from=build /repo/backend/dist ./backend/dist
COPY --from=build /repo/backend/prisma ./backend/prisma
COPY backend/docker-entrypoint.sh ./backend/docker-entrypoint.sh
RUN chmod +x ./backend/docker-entrypoint.sh
EXPOSE 4000
WORKDIR /repo/backend
CMD ["./docker-entrypoint.sh"]

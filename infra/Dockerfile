FROM node:24-alpine AS dependencies
WORKDIR /app
RUN npm install -g pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/scheduler/package.json ./apps/scheduler/package.json
COPY packages/engine/package.json ./packages/engine/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS api
COPY packages/contracts ./packages/contracts
COPY packages/engine ./packages/engine
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY apps/scheduler ./apps/scheduler
COPY db ./db
RUN pnpm --filter @hub/contracts build && pnpm --filter @hub/api build && pnpm --filter @hub/worker build && pnpm --filter @hub/scheduler build
USER node
EXPOSE 3001
CMD ["pnpm", "--filter", "@hub/api", "start"]

FROM api AS worker
WORKDIR /app/apps/worker
CMD ["node", "--import", "tsx", "src/main.ts"]

FROM api AS scheduler
WORKDIR /app/apps/scheduler
CMD ["node", "--import", "tsx", "src/main.ts"]

FROM dependencies AS web-build
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web
RUN pnpm --filter @hub/web build

FROM nginx:stable-alpine AS web
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

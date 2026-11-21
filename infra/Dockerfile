FROM node:24-alpine AS dependencies
WORKDIR /app
RUN npm install -g pnpm@11.25.0
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/scheduler/package.json ./apps/scheduler/package.json
COPY packages/engine/package.json ./packages/engine/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS backend-check
COPY packages/contracts ./packages/contracts
COPY packages/engine ./packages/engine
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY apps/scheduler ./apps/scheduler
COPY db ./db
RUN pnpm --filter @hub/contracts build && pnpm --filter @hub/engine build && pnpm --filter @hub/api build && pnpm --filter @hub/worker build && pnpm --filter @hub/scheduler build
RUN pnpm prune --prod

FROM backend-check AS runtime-base
RUN chmod -R a+rX /app
USER node

FROM runtime-base AS api
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "--import", "tsx", "src/server.ts"]

FROM runtime-base AS worker
WORKDIR /app/apps/worker
CMD ["node", "--import", "tsx", "src/main.ts"]

FROM runtime-base AS scheduler
WORKDIR /app/apps/scheduler
CMD ["node", "--import", "tsx", "src/main.ts"]

FROM dependencies AS web-build
ARG VITE_DEMO_MODE=false
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web
RUN pnpm --filter @hub/web build

FROM nginx:stable-alpine AS web
RUN rm -f /etc/nginx/conf.d/default.conf \
    && mkdir -p /etc/nginx/snippets /var/cache/nginx /var/run /tmp/nginx \
    && chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx/conf.d /etc/nginx/snippets /tmp/nginx
COPY infra/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY infra/member-security-headers.conf /etc/nginx/snippets/member-security-headers.conf
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

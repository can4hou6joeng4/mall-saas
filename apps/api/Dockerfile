ARG NODE_VERSION=22-alpine
ARG PNPM_VERSION=9.15.0

FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
RUN apk add --no-cache libc6-compat openssl
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# pnpm deploy 重装 @prisma/client 时会丢掉 prisma generate 产物；
# 而 @prisma/client/default.js 通过同级 peer 解析（require('.prisma/client/...')），
# 故必须把 .pnpm 隔离层下的 @prisma/client、@prisma/client-runtime-utils、.prisma 一并复制到 deploy 目录。
RUN pnpm --filter @mall/shared build \
 && pnpm --filter @mall/api exec prisma generate \
 && pnpm --filter @mall/api build \
 && pnpm --filter @mall/api deploy --prod /deploy/api \
 && PRISMA_PNPM_DIR=$(ls -d /repo/node_modules/.pnpm/@prisma+client@*/node_modules) \
 && rm -rf /deploy/api/node_modules/@prisma/client \
 && cp -RL "$PRISMA_PNPM_DIR/@prisma/client" /deploy/api/node_modules/@prisma/client \
 && cp -RL "$PRISMA_PNPM_DIR/@prisma/client-runtime-utils" /deploy/api/node_modules/@prisma/client-runtime-utils \
 && cp -RL "$PRISMA_PNPM_DIR/.prisma" /deploy/api/node_modules/.prisma \
 && rm -rf /deploy/api/src /deploy/api/test

FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache libc6-compat openssl tini
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /deploy/api ./
USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]

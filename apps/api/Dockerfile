# syntax=docker/dockerfile:1.7
# Multi-stage build pra apps/api (NestJS)
# Usa `pnpm deploy` pra produzir uma arvore standalone sem symlinks.

ARG NODE_VERSION=22-alpine

# ============================================================================
# Stage 1: base
# ============================================================================
FROM node:${NODE_VERSION} AS base
RUN apk add --no-cache libc6-compat openssl
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# ============================================================================
# Stage 2: workspace - copia tudo e instala deps com lockfile
# ============================================================================
FROM base AS workspace
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages packages
COPY apps apps
# nao usa --frozen-lockfile pra que mudancas de deps no package.json
# regenerem o lockfile sem quebrar o build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --no-frozen-lockfile

# ============================================================================
# Stage 3: build
# ============================================================================
FROM workspace AS build
# 1. compila packages/shared (dependencia do api)
WORKDIR /repo/packages/shared
RUN pnpm exec tsc -p tsconfig.json
# 2. gera Prisma Client (pra ter tipos no nest build)
WORKDIR /repo/apps/api
RUN pnpm exec prisma generate
# 3. compila NestJS
RUN pnpm exec nest build
# 4. pnpm deploy: arvore standalone
WORKDIR /repo
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @yugo/api deploy --prod /deployed
# 5. copia dist e schema pro /deployed
RUN cp -R apps/api/dist /deployed/dist \
 && cp -R apps/api/prisma /deployed/prisma
# 6. gera Prisma Client DENTRO de /deployed (client gerado vive em
#    node_modules/.prisma; deploy nao traz; gerar de novo aqui resolve)
WORKDIR /deployed
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm dlx prisma@6.1.0 generate

# ============================================================================
# Stage 4: runtime - imagem mínima
# ============================================================================
FROM node:${NODE_VERSION} AS runtime
# postgresql-client → pg_dump pro backup do banco pelo painel master de sistema.
RUN apk add --no-cache libc6-compat openssl tini postgresql16-client
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp
COPY --from=build --chown=nodeapp:nodeapp /deployed ./

USER nodeapp
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]

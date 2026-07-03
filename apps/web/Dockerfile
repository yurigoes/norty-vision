# syntax=docker/dockerfile:1.7
# Multi-stage build pra apps/web (Next.js 15 standalone)

ARG NODE_VERSION=22-alpine

# ============================================================================
# Stage 1: base
# ============================================================================
FROM node:${NODE_VERSION} AS base
RUN apk add --no-cache libc6-compat
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# ============================================================================
# Stage 2: deps
# ============================================================================
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile=false --filter @yugo/web... --filter @yugo/shared

# ============================================================================
# Stage 3: build
# ============================================================================
FROM deps AS build
WORKDIR /repo
COPY packages/shared packages/shared
COPY apps/web apps/web
# build packages/shared antes (Next.js consome dist/index.js)
WORKDIR /repo/packages/shared
RUN pnpm exec tsc -p tsconfig.json
WORKDIR /repo/apps/web
ENV NEXT_TELEMETRY_DISABLED=1
# Teto de heap do Node no `next build`. Sem isto, o build pode disparar a RAM e
# travar a VPS inteira (que tambem roda Postgres/Chatwoot/etc). Ajustavel via
# build-arg NODE_BUILD_MEM (MB). 2048 cabe em VPS pequena; suba se der OOM.
ARG NODE_BUILD_MEM=2048
ENV NODE_OPTIONS=--max-old-space-size=${NODE_BUILD_MEM}
# Dominio raiz que o front usa pra detectar apex (master) vs subdominio de
# empresa. Default = yugochat.com.br (yugo, sem mudanca). A Central de Leads
# builda com NEXT_PUBLIC_ROOT_DOMAIN=centraldeleads.yugochat.com.br pra que o
# proprio subdominio seja o apex (login master + orgs de clientes da CL).
ARG NEXT_PUBLIC_ROOT_DOMAIN=yugochat.com.br
ENV NEXT_PUBLIC_ROOT_DOMAIN=${NEXT_PUBLIC_ROOT_DOMAIN}
# tema padrao por build (yugo=light; Central de Leads builda com dark).
ARG NEXT_PUBLIC_DEFAULT_THEME=light
ENV NEXT_PUBLIC_DEFAULT_THEME=${NEXT_PUBLIC_DEFAULT_THEME}
RUN mkdir -p public && pnpm build

# ============================================================================
# Stage 4: runtime (Next.js standalone)
# ============================================================================
FROM node:${NODE_VERSION} AS runtime
RUN apk add --no-cache libc6-compat tini
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=America/Sao_Paulo
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# usuario nao-root
RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp

# standalone copia tudo que precisa
COPY --from=build --chown=nodeapp:nodeapp /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nodeapp:nodeapp /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nodeapp:nodeapp /repo/apps/web/public ./apps/web/public

USER nodeapp
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]

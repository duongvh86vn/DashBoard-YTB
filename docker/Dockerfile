# syntax=docker/dockerfile:1.7

FROM node:24.19.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_HOME=/corepack

RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p "$COREPACK_HOME" \
    && corepack enable \
    && corepack prepare pnpm@11.22.0 --activate \
    && chmod -R a+rX "$COREPACK_HOME"

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY . .

RUN pnpm db:generate \
    && pnpm -r --if-present build

FROM build AS api

ENV NODE_ENV=production

USER node

CMD ["node", "apps/api/dist/main.js"]

FROM build AS worker

ENV NODE_ENV=production

USER node

CMD ["node", "apps/worker/dist/main.js"]

FROM build AS web

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN mkdir -p /app/apps/web/.next/standalone/apps/web/.next \
    && cp -R /app/apps/web/.next/static /app/apps/web/.next/standalone/apps/web/.next/static \
    && chown -R node:node /app/apps/web/.next/standalone

USER node

CMD ["node", "apps/web/start-standalone.mjs"]

FROM build AS db-migrate

ENV NODE_ENV=production

USER node

CMD ["node", "/app/node_modules/prisma/build/index.js", "migrate", "deploy"]

# syntax=docker/dockerfile:1.7

FROM node:24.19.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_HOME=/corepack

RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl yt-dlp \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p "$COREPACK_HOME" \
    && corepack enable \
    && corepack prepare pnpm@11.22.0 --activate \
    && yt-dlp --version \
    && chmod -R a+rX "$COREPACK_HOME"

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/collectors/ytdlp/package.json packages/collectors/ytdlp/package.json
COPY packages/collectors/youtube-public/package.json packages/collectors/youtube-public/package.json
COPY packages/collectors/youtube-rss/package.json packages/collectors/youtube-rss/package.json
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

FROM build AS db-seed

ENV NODE_ENV=production

USER node

CMD ["node", "--import", "tsx", "prisma/seed.ts"]

FROM mcr.microsoft.com/playwright:v1.62.1-noble AS e2e

USER root

COPY --from=base /usr/local/bin/node /usr/local/bin/node
COPY --from=base /usr/local/lib/node_modules /usr/local/lib/node_modules

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_HOME=/corepack

RUN mkdir -p "$COREPACK_HOME" "$PNPM_HOME" /tmp/yhm-playwright-output \
    && ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && corepack enable \
    && corepack prepare pnpm@11.22.0 --activate \
    && node -e "const [major]=process.versions.node.split('.').map(Number);if(major!==24)process.exit(1)" \
    && test "$(pnpm --version)" = "11.22.0" \
    && chown -R pwuser:pwuser "$COREPACK_HOME" "$PNPM_HOME" /tmp/yhm-playwright-output

WORKDIR /app

COPY --from=build --chown=pwuser:pwuser /app /app

USER pwuser

CMD ["sh", "-c", "set -eu; : \"${E2E_BASE_URL:?}\" \"${E2E_ADMIN_EMAIL:?}\" \"${E2E_ADMIN_PASSWORD:?}\" \"${E2E_MATRIX_VIEWER_EMAIL:?}\" \"${E2E_MATRIX_VIEWER_UPDATED_EMAIL:?}\" \"${E2E_MATRIX_VIEWER_PASSWORD:?}\" \"${E2E_MATRIX_VIEWER_RESET_PASSWORD:?}\" \"${E2E_LOGOUT_VIEWER_EMAIL:?}\" \"${E2E_LOGOUT_VIEWER_PASSWORD:?}\" \"${E2E_CHANGE_VIEWER_EMAIL:?}\" \"${E2E_CHANGE_VIEWER_PASSWORD:?}\" \"${E2E_CHANGE_VIEWER_NEW_PASSWORD:?}\" \"${E2E_BROWSER_VIEWER_EMAIL:?}\" \"${E2E_BROWSER_VIEWER_PASSWORD:?}\" \"${E2E_RAW_SESSION_TOKEN_MARKER:?}\"; node -e \"const [major]=process.versions.node.split('.').map(Number);if(major!==24)process.exit(1)\"; test \"$(pnpm --version)\" = \"11.22.0\"; rm -rf /tmp/yhm-playwright-output/*; pnpm test:e2e"]

# ================= PROD chain (Alpine, lightweight) =================
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
# git is needed by the builder stage (via `deps`) to read the commit hash at
# build time (next.config.ts); the final `runner` stage below starts fresh
# from node:22-alpine and never installs it, so the shipped image stays free
# of git either way.
RUN apk add --no-cache git
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS deps
RUN pnpm install --frozen-lockfile

# ---- builder: production build ----
FROM deps AS builder
COPY . .
RUN pnpm run build

# ---- runner: used by docker-compose.prod.yml ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Next.js's standalone server.js reads PORT from its own environment at
# runtime — this ARG/ENV pair only sets the image's own default (baked in at
# build time from .env via docker-compose's build.args), which docker-compose
# always overrides at container start with its own `environment: PORT=...`
# anyway. EXPOSE is documentation only (no effect under network_mode: host or
# an explicit ports: mapping) but kept in sync for anyone inspecting the image.
ARG PORT=3000
ENV PORT=${PORT}
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE ${PORT}
CMD ["node", "server.js"]

# ================= DEV (Debian bookworm-slim) =================
# Debian base: ships bash by default. git and other utilities are installed
# via Dev Container features (see .devcontainer/devcontainer.json).
FROM node:22-bookworm-slim AS dev
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# `next dev` reads PORT from its own environment at runtime (same as
# `next start` above) — see the runner stage's comment for why this
# ARG/ENV pair is just a build-time-synced default, not the real mechanism.
ARG PORT=3000
ENV PORT=${PORT}
EXPOSE ${PORT}
CMD ["pnpm", "run", "dev"]

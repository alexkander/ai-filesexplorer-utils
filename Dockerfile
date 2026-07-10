FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS deps
RUN pnpm install --frozen-lockfile

# ---- dev: used by docker-compose.yml and .devcontainer ----
FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["pnpm", "run", "dev"]

# ---- builder: production build ----
FROM deps AS builder
COPY . .
RUN pnpm run build

# ---- runner: used by docker-compose.prod.yml ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]

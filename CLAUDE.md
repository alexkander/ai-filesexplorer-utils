# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Overview

Next.js 16 (App Router) + React 19 + TypeScript project, package-managed with
pnpm. Web utilities for organizing files (file counts per directory, content
checksums, folder sync, etc. — per the README) — the app is currently an
early-stage scaffold (`app/page.tsx` / `app/layout.tsx` only, no routes, no
tests yet).

## Commands

- `pnpm dev` — start the dev server (http://localhost:3000 by default; set
  `PORT` in `.env`/the environment to use a different port — read natively by
  `next dev`/`next start`)
- `pnpm build` — production build (`output: 'standalone'` in `next.config.ts`)
- `pnpm start` — run the production build
- `pnpm lint` / `pnpm lint:fix` — ESLint (flat config, `eslint.config.mjs`,
  based on `eslint-config-next` + `eslint-config-prettier`)
- `pnpm format` / `pnpm format:check` — Prettier

There is no test suite configured yet (no test script in `package.json`).

## Git hooks

Husky + lint-staged run ESLint (`--fix`) and Prettier on staged files
automatically on every commit (`.husky/pre-commit` → `pnpm exec lint-staged`).
No manual step is needed; just commit as usual.

## TypeScript / style conventions

- `tsconfig.json` has `strict: true`; path alias `@/*` maps to the repo root.
- Prettier: single quotes, semicolons, trailing commas everywhere, 80-col print
  width (`.prettierrc.json`).

## Docker / devcontainer

Local dev and prod both build from the same multi-stage `Dockerfile`, so there's
nothing duplicated between them:

- `dev` stage: `node:22-bookworm-slim`, installs deps with pnpm, runs
  `pnpm run dev`. Used by `docker-compose.yml` (`network_mode: host`, source
  mounted as a volume for hot-reload, `node_modules`/`.next` as anonymous
  volumes).
- `runner` stage: `node:22-alpine`, copies only the Next.js `standalone` output
  — no pnpm, no source. Used by `docker-compose.prod.yml` (port `3000:3000` by
  default, published, no bind mounts — both sides of the mapping come from
  `PORT` in `.env`).

`.devcontainer/devcontainer.json` (VS Code Dev Containers) does **not** use the
`Dockerfile` or Compose at all: it builds from the plain `node:22-bookworm-slim`
image directly and runs `corepack enable && pnpm install --frozen-lockfile` via
`postCreateCommand`. `node_modules`/`.next` live in named volumes
(`ai-filesexplorer-utils-node_modules`, `ai-filesexplorer-utils-next`). The dev
server is not started automatically — run `pnpm dev` in the container's
terminal.

Wrapper scripts (`scripts/dev.sh`, `scripts/dev-down.sh`, `scripts/prod.sh`,
`scripts/prod-down.sh`) just call
`docker compose [-f docker-compose.prod.yml] up --build -d` / `down` from the
repo root.

## Architecture

- `app/` — Next.js App Router pages/layouts.
- No environment variables are required currently; if any are added, follow
  Next.js convention (`.env.local` for local values, `NEXT_PUBLIC_` prefix only
  for values that must reach the browser).

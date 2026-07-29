# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Overview

Next.js 16 (App Router) + React 19 + TypeScript project, package-managed with
pnpm. Web utilities for organizing files, built as independent tools reachable
from a shared dashboard shell: **Count and Size** (per-directory file counts and
sizes), **Compare Directories** (side-by-side comparison of two trees via
content checksums) and **Find Duplicates** (duplicate files and folders inside
one directory). There is no test suite — see "Testing" below and the
constitution's Principle IV.

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

Hexagonal, sliced per feature (see `.specify/memory/constitution.md`, Principle
II). Dependencies point inward: `infrastructure` → `application` → `domain`.

- `domain/` — pure rules, no `fs`/SQL/React imports. One directory per feature
  (`count-and-size/`, `directory-comparison/`, `duplicate-finder/`,
  `navigation/`), plus the shared `scanning/` module.
- `application/` — use cases and the ports (TypeScript interfaces) they depend
  on, same per-feature split, plus shared `scanning/` ports.
- `infrastructure/` — the only place with `fs`, `crypto`, `better-sqlite3` and
  React components. Each feature owns its SQLite client, adapters, background
  worker and `ui/` components.
- `app/` — App Router pages and Route Handlers only; they call one use case and
  render an `infrastructure/ui` component, nothing more.

**Cross-slice rule**: a feature slice does not import from another feature's
slice. The only intentional exception is the shared `scanning` module; small
helpers (size formatting, checksum derivation) are deliberately duplicated
instead. Reading another tool's data is done through a read-only overlay adapter
that lives in the _consuming_ slice (e.g.
`infrastructure/duplicate-finder/comparison-checksum-readonly-adapter.ts`).

Each tool keeps its own SQLite database under `data/`, and each one can be
redirected at a throwaway file — always do this when testing by hand, never
point them at the real `data/` files:

- `COUNT_AND_SIZE_DB_PATH` → `data/count-and-size.sqlite`
- `DIRECTORY_COMPARISON_DB_PATH` → `data/directory-comparison.sqlite`
- `DUPLICATE_FINDER_DB_PATH` → `data/duplicate-finder.sqlite`

Any other environment variable should follow Next.js convention (`.env.local`
for local values, `NEXT_PUBLIC_` prefix only for values that must reach the
browser).

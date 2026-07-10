# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Overview

Next.js (App Router) + TypeScript project, package-managed with pnpm.

## Commands

- `pnpm dev` — start the dev server
- `pnpm build` — production build
- `pnpm start` — run the production build
- `pnpm lint` / `pnpm lint:fix` — ESLint (flat config, `eslint.config.mjs`,
  based on `eslint-config-next`)
- `pnpm format` / `pnpm format:check` — Prettier

## Git hooks

Husky + lint-staged run ESLint (`--fix`) and Prettier on staged files
automatically on every commit (`.husky/pre-commit`). No manual step is needed;
just commit as usual.

## Architecture

- `app/` — Next.js App Router pages/layouts.
- Docker/devcontainer setup for local dev and prod (`Dockerfile`,
  `docker-compose*.yml`, `scripts/*.sh`, `.devcontainer/`).

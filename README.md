# ai-filesexplorer-utils

Web utilities for organizing files: file counts per directory, content checksum
tracking, folder synchronization, and more.

## Requirements

- Node.js 22+
- [pnpm](https://pnpm.io/) 11+ (or Docker, see below)

## Local development

```bash
pnpm install
pnpm dev
```

The app is available at [http://localhost:3000](http://localhost:3000).

Other available scripts:

```bash
pnpm build   # production build
pnpm start   # run the production build
```

## Development with Docker

```bash
./scripts/dev.sh
# equivalent to: docker compose up --build -d

./scripts/dev-down.sh
# equivalent to: docker compose down
```

The service runs with `network_mode: host`, so it's directly available at
`http://localhost:3000` on the host. The source code is mounted as a volume for
hot-reload; `node_modules` and `.next` live in anonymous volumes inside the
container so they don't clash with the host's.

This same `docker-compose.yml` is used by `.devcontainer/devcontainer.json` (VS
Code Dev Containers extension), so both containerized development paths share
the exact same image and configuration — nothing is duplicated between them.

## Production with Docker

```bash
./scripts/prod.sh
# equivalent to: docker compose -f docker-compose.prod.yml up --build -d

./scripts/prod-down.sh
# equivalent to: docker compose -f docker-compose.prod.yml down
```

Uses the `runner` stage of the `Dockerfile` (multi-stage build), which runs
Next.js's `standalone` output: a minimal image with no pnpm or full source code,
just the compiled server. It's exposed at `http://localhost:3000` via port
mapping (no `network_mode: host`, no bind mounts).

## Environment variables

The project currently doesn't require any environment variables to run.

If any are added in the future, follow the Next.js convention:

- `.env.local` for local values (not versioned, add to `.gitignore`)
- `NEXT_PUBLIC_` prefix only for variables that must be exposed to the
  client/browser

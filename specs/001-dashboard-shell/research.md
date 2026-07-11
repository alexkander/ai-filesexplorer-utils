# Phase 0 Research: Dashboard Main View (Header, Sidebar & Home)

All Technical Context items are resolved below; no `NEEDS CLARIFICATION` markers
remain.

## Decision 1: Introduce Tailwind CSS + shadcn/ui now

**Decision**: Add Tailwind CSS and shadcn/ui (Radix UI-based components,
`lucide-react` icons) to the project as part of this feature.

**Rationale**: The constitution's Technology & Language Constraints mandate
shadcn/ui + Tailwind as the only allowed UI stack, but neither is installed yet
(`app/page.tsx` today is unstyled JSX). This is the first UI-bearing feature, so
it's the natural place to set up the stack once, rather than hand-rolling CSS
that would need to be thrown away later.

**Alternatives considered**: Plain CSS Modules or hand-written global CSS
(rejected — violates the constitution's UI constraint);
styled-components/Emotion (rejected — same reason, plus an extra runtime
dependency the constitution doesn't allow without an amendment).

## Decision 2: Use shadcn/ui's Popover primitive for the help icon

**Decision**: Implement the help icon's info panel with shadcn/ui's `Popover`
component (built on Radix UI's `Popover` primitive).

**Rationale**: FR-007 requires a click-triggered,
dismissible-by-outside-click-or-Escape panel. Radix's `Popover` already
implements that dismiss behavior and reasonable focus handling out of the box,
so it satisfies the requirement without hand-rolling outside-click/Escape/focus
logic, and it's the constitution-mandated component library.

**Alternatives considered**: A custom `<div>` + manual `mousedown`/`keydown`
listeners (rejected — reimplements accessible behavior Radix already provides
correctly, more code and more risk for no benefit); a shadcn `Dialog`/modal
(rejected — too heavyweight/blocking for a small informational panel anchored to
an icon).

## Decision 3: `lucide-react` for the help icon glyph

**Decision**: Use `lucide-react`'s `CircleHelp` (or equivalent) icon for the
help action.

**Rationale**: It's shadcn/ui's default companion icon set, tree-shakeable, and
requires no extra configuration beyond installing the package — avoids
introducing a second icon library.

**Alternatives considered**: Heroicons or a hand-drawn inline SVG (rejected — no
reason to diverge from the icon set shadcn/ui already assumes).

## Decision 4: Commit-hash resolution across dev/build environments

**Decision**: Compute the short commit hash (`git rev-parse --short HEAD`,
wrapped in a try/catch that falls back to the literal string `"unknown"`) inside
`next.config.ts`, and expose it to the app via Next's `env` config key. To make
this work in the Docker `builder` stage — which currently does not receive
`.git` because the root `.dockerignore` excludes it — remove the `.git` line
from `.dockerignore`. This is a global change (Docker's `.dockerignore` applies
to the whole build context, not per stage — there is no way to scope it to only
the `builder` stage), but it stays safe for the shipped image regardless,
because the `runner` stage's `COPY --from=builder` instructions only ever copy
`.next/standalone`, `.next/static`, and `public` — never `.git` — so the final
image stays free of source/git no matter what the build context contains.

**Rationale**: One mechanism, three environments:

- **Local `pnpm dev`/`pnpm build`**: `.git` is already present in the working
  directory.
- **Docker dev (`./scripts/dev.sh`)**: `docker-compose.yml` bind-mounts the
  whole repo (`.:/app`), so `.git` is present at container runtime when
  `next dev` starts, regardless of `.dockerignore` (bind mounts aren't filtered
  by it).
- **Docker prod (`./scripts/prod.sh`)**: the `builder` stage runs
  `pnpm run build` from a `COPY . .` of the build context, which is what
  `.dockerignore` currently blocks `.git` from reaching. Removing that one
  `.dockerignore` line is the only change needed; it also makes `.git` visible
  to the `dev`/`deps` stages' build context, which is harmless (the `dev` stage
  already gets `.git` at runtime via its bind mount anyway), and the shipped
  `runner` image is unaffected either way since it never copies `.git`.

Computing the hash at `next build`/`next dev` invocation time (not at
request/runtime) also matches the spec's Assumption that build info is "sourced
from build metadata."

**Alternatives considered**: Passing the hash as a Docker `--build-arg` computed
on the host (rejected — requires threading a new argument through
`scripts/prod.sh`, `scripts/dev.sh`, and both compose files, more moving parts
than a one-line `.dockerignore` adjustment); a CI-generated version file
(rejected — this project has no CI, per the constitution's
single-user/self-hosted scope, so there's nothing to generate it).

## Decision 5: App version resolution

**Decision**: Statically import the `version` field from `package.json` inside a
server-only module (TypeScript's `resolveJsonModule` is already enabled in
`tsconfig.json`).

**Rationale**: The bundler inlines the imported value at build time, so the
compiled `.next/standalone` output has no runtime dependency on a `package.json`
file being present — important since the `runner` image doesn't otherwise ship
one. This also gives a single source of truth (no separate version constant to
keep in sync).

**Alternatives considered**: Reading `package.json` via `fs.readFileSync` at
request time (rejected — the file isn't present in the `runner` image outside
the bundler's own resolution, so this would break in prod); a duplicate version
constant in an env var (rejected — two sources of truth, drift risk, unnecessary
per Constitution Principle I).

## Decision 6: Domain/application/infrastructure split for this feature

**Decision**:

- `domain/navigation/`: the `MenuEntry` type, the static entry list (today: just
  `Home`), and a pure `findActiveEntry(pathname, entries)` matcher — no
  framework imports.
- `application/build-info/`: the `BuildInfoPort` interface and a one-line
  `getBuildInfo(port)` use case that calls it.
- `infrastructure/build-info/`: the concrete `BuildInfoPort` adapter
  (package.json import + `process.env` commit hash).
- `infrastructure/ui/`: the Next.js/React components (Header, Sidebar,
  HelpPopover, DashboardShell) plus the shadcn/ui primitives they use.
- `app/layout.tsx` stays thin — it renders `<DashboardShell>` and nothing else.

**Rationale**: Required by Constitution Principle II for anything crossing a
system boundary (here: reading `process.env` / bundled package metadata) and by
Principle III (SOLID — `BuildInfoPort` is a small, substitutable interface). The
route-matching logic is genuinely reusable, framework-agnostic logic (today:
exact-match only, per the spec's Assumption that nested routes are out of
scope), so it earns a place in `domain/` rather than being inlined into a
component.

**Alternatives considered**: Putting `BuildInfo` resolution directly in the
`HelpPopover` component (rejected — violates Principle II's port requirement and
would hard-code a system-boundary read into a UI component); skipping the
domain/application split entirely as overkill for "one array `.find()`"
(considered seriously, given Principle I's YAGNI framing, but the constitution
states the layering as a MUST for `app/`, not as optional, and the
`BuildInfoPort` in particular has a real system boundary to isolate — so the
split is kept minimal rather than dropped).

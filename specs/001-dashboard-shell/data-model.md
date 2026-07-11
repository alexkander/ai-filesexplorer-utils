# Phase 1 Data Model: Dashboard Main View (Header, Sidebar & Home)

Neither entity is persisted — both are resolved fresh from static in-code config
or build metadata on every server render. There is no database, no
lifecycle/state transitions beyond "active vs. not active" for a `MenuEntry`,
which is derived, not stored.

## MenuEntry

Represents one navigable item in the sidebar (spec Key Entities: "Menu Entry
(Tool)").

| Field   | Type     | Notes                                                                                                                                          |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`   | `string` | Stable identifier, e.g. `"home"`. Unique across all entries (FR-009: each entry maps to exactly one route).                                    |
| `label` | `string` | Display text shown in the sidebar and (when active) in the header title, e.g. `"Home"`. Non-empty.                                             |
| `route` | `string` | The app path this entry links to, e.g. `"/"`. Unique across all entries — this is what `findActiveEntry` matches against the current pathname. |

**Validation rules**:

- `route` MUST be unique within the entry list (two entries can't claim the same
  route).
- `label` MUST be non-empty (it's what the user reads).

**Relationships**: None — a flat list. The spec's Assumptions explicitly put
nested/sub-route matching out of scope, so `MenuEntry` has no parent/child
structure today.

**Initial data**: exactly one entry —
`{ key: "home", label: "Home", route: "/" }` (FR-010, FR-012).

**Derived, not stored**: "is this entry active?" is computed per-render by
`findActiveEntry(pathname, entries)` comparing the current route to each entry's
`route` (FR-011). No `isActive` field is persisted on the entity itself, to
avoid a second source of truth that could drift from the actual URL.

## BuildInfo

Represents the read-only data shown via the help popover (spec Key Entities:
"Application Build Info").

| Field        | Type     | Notes                                                                                                                                                                         |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appName`    | `string` | Always the literal `package.json` name, `"ai-filesexplorer-utils"` (FR-003). Constant, not user-editable.                                                                     |
| `version`    | `string` | The `package.json` `"version"` field (semver, e.g. `"0.1.0"`), introduced by this feature. Resolved at build time via a static import.                                        |
| `commitHash` | `string` | The 7-character short git commit hash (FR-007), or the literal `"unknown"` fallback when it can't be determined at build/dev-start time (Edge Cases; research.md Decision 4). |

**Validation rules**:

- `commitHash` is either exactly 7 hex characters or the literal string
  `"unknown"` — never blank, never a partial/broken value (Edge Cases).

**Relationships**: None. `BuildInfo` is a single, unkeyed value object — there's
only ever one instance, resolved once per server build/start and read on demand.

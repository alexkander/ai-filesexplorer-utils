# Feature Specification: Dashboard Main View (Header, Sidebar & Home)

**Feature Branch**: `001-dashboard-shell`

**Created**: 2026-07-11

**Status**: Draft

**Input**: User description: "Create the spec to implement the dashboard's main
view. It must be full width. It will have a header of about 96px where only the
title is placed on the left side, and on the right side there can be options
that will be added later. The first option on the right side will be just a help
icon that shows the app name, the version, and the current commit hash of the
repository. The main body will have a sidebar on the left side where menus will
be placed, to be defined later. For now only a Home entry will be left. Each
sidebar menu corresponds to a tool that maps to a route. When on a tool, the
sidebar must mark/highlight the tool the user is currently on. The initial view
will be this Home view, which for now will show a hello world and will be
defined later. The app title in the header, besides the app name, must also show
the name of the menu/section the user is currently in."

## Clarifications

### Session 2026-07-11

- Q: package.json has no "version" field today, but FR-007 requires showing the
  app's current version via the help popover. How should that version value be
  sourced? → A: Add a semver field to package.json (starting e.g. at 0.1.0) as
  the single source of truth for the displayed version, bumped manually going
  forward alongside Conventional Commits.
- Q: What should be shown as the "application name" in the header title and help
  popover? → A: Use the exact package.json name, "ai-filesexplorer-utils",
  everywhere the app name is shown.
- Q: What format should the commit hash be shown in via the help popover? → A:
  Short hash, 7 characters (the standard git abbreviated hash).
- Q: How should the header title combine the application name and the current
  section name? → A: Single line, em-dash separator, e.g.
  "ai-filesexplorer-utils — Home".

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Land on the dashboard shell with the Home view (Priority: P1)

A user opens the application and immediately sees the persistent dashboard shell
— a full-width header and a left sidebar — wrapping the default Home view, so
the app feels like a structured tool rather than a bare page.

**Why this priority**: This is the foundational layout every other tool in the
app will be built inside of. Without it, no other feature has a place to live.
It is the minimum viable slice: header, sidebar, and a placeholder Home screen.

**Independent Test**: Open the application root URL. Verify the header, sidebar,
and Home placeholder content all render together, with no other tool implemented
yet.

**Acceptance Scenarios**:

1. **Given** the user navigates to the application's root URL, **When** the page
   finishes loading, **Then** a full-width header of approximately 96px in
   height is visible at the top, and a left sidebar is visible in the body below
   it.
2. **Given** the dashboard shell has loaded, **When** the user looks at the main
   content area, **Then** it displays the Home view's placeholder content
   ("Hello World").
3. **Given** no other tool exists yet, **When** the user looks at the sidebar,
   **Then** it contains exactly one entry, "Home".

---

### User Story 2 - See current location reflected in header and sidebar (Priority: P2)

While using any tool, a user can tell at a glance where they are in the
application: the sidebar highlights the tool they're currently in, and the
header title states both the application name and the current section's name.

**Why this priority**: This is the navigational feedback that makes the sidebar
useful once more than one tool exists. It builds directly on User Story 1's
shell and is testable with the single "Home" entry available today, but is what
makes the shell scale to future tools.

**Independent Test**: With only the Home route available, load the app and
confirm the "Home" sidebar entry is marked active and the header title reads as
the app name plus "Home". This behavior can be verified now and will extend
automatically as new tool routes are added.

**Acceptance Scenarios**:

1. **Given** the user is on the Home route, **When** the page renders, **Then**
   the "Home" entry in the sidebar is visually marked as the active/current
   selection.
2. **Given** the user is on the Home route, **When** they read the header title,
   **Then** it shows both the application's name and "Home" as the current
   section.
3. **Given** a future tool route is added and the user navigates to it, **When**
   the page renders, **Then** the sidebar entry for that tool becomes the one
   marked active (and the "Home" entry is no longer marked active), and the
   header title updates to that tool's name.

---

### User Story 3 - Inspect app info via the help icon (Priority: P3)

A user who wants to know exactly which build of the application they're running
(for support or debugging purposes) can open a help icon in the header and see
the application name, its version, and the current commit hash of the repository
it was built from.

**Why this priority**: Useful diagnostic information, but not required for the
shell or navigation to function. It's the first of what will become a series of
right-side header actions, so it also establishes that extension point.

**Independent Test**: With the shell loaded, activate the help icon in the
top-right of the header and confirm the displayed application name, version, and
commit hash are present and correct, independent of which route is active.

**Acceptance Scenarios**:

1. **Given** the dashboard shell is loaded, **When** the user looks at the right
   side of the header, **Then** a help icon is the first (and currently only)
   item shown there.
2. **Given** the user activates the help icon, **When** the resulting info is
   displayed, **Then** it shows the application's name, its version, and the
   current commit hash of the repository.

---

### Edge Cases

- What happens when the commit hash cannot be determined at build/run time
  (e.g., building outside of a git working copy, or from a shallow clone without
  metadata)? The help info MUST show a clear fallback (e.g., "unknown") instead
  of a broken or blank value.
- What happens when the current route does not correspond to any defined sidebar
  entry (e.g., a not-found page)? No sidebar entry MUST be marked active, and
  the header title MUST fall back to showing just the application name.
- What happens as more menu entries are added to the sidebar over time than fit
  in the visible vertical space? The sidebar's own list MUST become
  independently scrollable while the header remains fixed at the top.
- What happens when more right-side header actions are added after the help
  icon? They MUST be able to coexist with the help icon in the same right-side
  area without requiring a redesign of the header.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST render a persistent dashboard shell — consisting
  of the header and the sidebar — that wraps every route in the application,
  including the Home view and every future tool.
- **FR-002**: The header MUST span the full width of the viewport and MUST be
  approximately 96px tall.
- **FR-003**: The header MUST show a title on its left side. The application
  name portion of this title MUST be the literal `package.json` name,
  "ai-filesexplorer-utils".
- **FR-004**: The header title MUST display both the application's name and the
  name of the currently active section (tool), whenever the current route
  matches a known section, as a single line in the form "AppName — Section"
  (em-dash separated, e.g. "ai-filesexplorer-utils — Home").
- **FR-005**: The header MUST provide a right-side area capable of holding zero
  or more optional actions; further actions are expected to be added by future
  features over time, without redesigning the header.
- **FR-006**: The first (and currently only) right-side header action MUST be a
  help icon.
- **FR-007**: Clicking the help icon MUST open a dismissible popover/panel
  revealing the application's name, its current version, and the current commit
  hash of the repository, shown as the standard 7-character short hash. The
  popover MUST be dismissible (e.g., by clicking outside it or pressing Escape).
- **FR-008**: The main body MUST include a left sidebar listing the
  application's navigable tools.
- **FR-009**: Each sidebar entry MUST correspond to exactly one application
  route/tool.
- **FR-010**: The sidebar MUST initially contain a single entry, "Home", with
  further entries to be defined by future features.
- **FR-011**: Whenever the current route matches a sidebar entry's route, that
  entry MUST be visually marked as the active/current selection; when the
  current route does not match any entry, no entry MUST be marked active.
- **FR-012**: The application's default route (what loads when the app is opened
  with no further path) MUST be the Home view.
- **FR-013**: The Home view MUST display placeholder content ("Hello World")
  until its final content is defined by a future feature.
- **FR-014**: The dashboard shell (header, sidebar, and content area together)
  MUST occupy the full width of the browser viewport. The sidebar MUST have a
  fixed, constant width and MUST always be visible — this feature does not
  include a collapse/expand or toggle control for the sidebar.
- **FR-015**: The main content area MUST use the remaining viewport width and
  height not occupied by the header and sidebar, stretching edge-to-edge with no
  centered/maximum-width cap, regardless of screen size.

### Key Entities

- **Menu Entry (Tool)**: A single navigable item in the sidebar. Represented by
  a display label, an associated application route, and whether it is currently
  the active selection. "Home" is the only entry that exists at the start of
  this feature.
- **Application Build Info**: The data shown through the help icon — application
  name, version, and current repository commit hash. Read-only, informational
  only. Version is a semantic-version string maintained in the project's package
  metadata (`package.json`), introduced by this feature since no version field
  exists there yet.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user opening the application sees the fully rendered dashboard
  shell (header, sidebar, and Home content) with no additional action required
  beyond loading the page.
- **SC-002**: At any time, the sidebar shows exactly one entry marked active
  when the current route matches a defined tool, and zero entries marked active
  otherwise — never more than one active entry simultaneously.
- **SC-003**: A user can find the application's name, version, and current
  commit hash in a single interaction with the help icon, without navigating
  away from their current tool.
- **SC-004**: The dashboard shell renders without unintended horizontal
  scrolling on standard desktop viewport widths (1280px and above).
- **SC-005**: A new tool can be introduced to the sidebar (new entry plus route)
  without requiring changes to the header or to how existing sidebar entries
  behave.

## Assumptions

- This feature covers only the shell (header + sidebar + routing/highlighting
  behavior) and the Home view's placeholder content. The final content and
  behavior of the Home view, and of any tool other than Home, are out of scope
  and will be defined by future features.
- Per the project's single-user, self-hosted deployment model, no authentication
  or per-user personalization applies to the shell, sidebar, or help info.
- The application's commit hash is sourced from the project's existing build
  metadata (git commit at build time). The application's version is sourced from
  a new `package.json` "version" field introduced by this feature (starting at a
  low semver value such as 0.1.0), since no version field exists in project
  metadata today.
- Desktop browser viewports are the primary target, consistent with this being a
  personal, self-hosted utility app; no dedicated mobile-specific layout is
  required by this feature beyond not breaking on standard desktop widths.
- Sidebar entries map one-to-one with top-level routes; nested/sub-routes within
  a single tool are out of scope for this feature's active-state logic, since no
  tool with sub-routes exists yet.
- The sidebar is fixed-width and always visible for this feature; a
  collapsible/toggleable sidebar is not required now and can be introduced later
  if a real need arises (YAGNI).
- The help icon's info is revealed via a click-triggered, dismissible popover
  rather than a hover tooltip, so the same interaction works consistently across
  desktop and touch input.
- Both extension points this feature establishes — the header's right-side
  actions area (FR-005/FR-006) and the sidebar's menu entries list
  (FR-009/FR-010) — are intentionally minimal today (one action, one entry).
  Their contents are expected to keep changing over multiple future specs as new
  tools and header actions are defined; this feature's job is only to make sure
  either list can grow without redesigning the header or sidebar, not to build
  out their eventual contents.

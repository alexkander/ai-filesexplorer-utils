# Contract: MenuEntry (sidebar registry)

This is the contract every future tool must satisfy to appear in the sidebar
(spec SC-005: "a new tool can be introduced... without requiring changes to the
header or to how existing sidebar entries behave"). It lives in
`domain/navigation/menu-entry.ts`.

## Shape

```ts
interface MenuEntry {
  key: string; // stable, unique identifier, e.g. "home"
  label: string; // display text, non-empty, e.g. "Home"
  route: string; // app path this entry links to, e.g. "/"
}
```

## Registry

```ts
const menuEntries: MenuEntry[] = [{ key: 'home', label: 'Home', route: '/' }];
```

## Rules a caller/consumer can rely on

- `route` is unique across the whole list — no two entries ever match the same
  pathname.
- The list is read top-to-bottom in the order entries should render in the
  sidebar.
- Adding a new tool means appending one `MenuEntry` to this list and creating
  its route under `app/`; nothing in `infrastructure/ui/header.tsx` or
  `sidebar.tsx` needs to change.
- Exactly zero or one entry is ever "active" for a given pathname — never more
  than one (enforced by uniqueness of `route`, consumed via `findActiveEntry`).

## Consumer: `findActiveEntry`

```ts
function findActiveEntry(
  pathname: string,
  entries: MenuEntry[],
): MenuEntry | undefined;
```

Returns the entry whose `route` exactly matches `pathname`, or `undefined` if
none matches (Edge Cases: unmatched routes mark no sidebar entry active and the
header falls back to just the app name).

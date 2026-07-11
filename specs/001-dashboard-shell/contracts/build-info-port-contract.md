# Contract: BuildInfoPort

The port the `infrastructure/ui/help-popover.tsx` component depends on
(indirectly, via the `application/build-info/get-build-info.ts` use case) to
display the app name, version, and commit hash. Defined in
`application/build-info/build-info-port.ts`.

## Shape

```ts
interface BuildInfo {
  appName: string; // always "ai-filesexplorer-utils"
  version: string; // package.json "version", e.g. "0.1.0"
  commitHash: string; // 7-char short hash, or "unknown"
}

interface BuildInfoPort {
  getBuildInfo(): BuildInfo;
}
```

## Use case

```ts
function getBuildInfo(port: BuildInfoPort): BuildInfo {
  return port.getBuildInfo();
}
```

## Implementations

- **`infrastructure/build-info/build-info-adapter.ts`** (the only implementation
  for this feature): `appName` is a literal constant; `version` comes from a
  static import of `package.json`; `commitHash` comes from
  `process.env.NEXT_PUBLIC_COMMIT_HASH`, populated by `next.config.ts` at
  build/dev-start time (research.md Decision 4), falling back to `"unknown"` if
  unset or empty.

## Rules a consumer can rely on

- `getBuildInfo()` is synchronous and side-effect-free from the caller's
  perspective — safe to call during a Server Component render.
- The returned `BuildInfo` is stable for the lifetime of the running server
  process (it does not change between requests).
- `commitHash` is never blank — it is either a valid 7-character short hash or
  the literal string `"unknown"`.

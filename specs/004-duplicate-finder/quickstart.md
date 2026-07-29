# Quickstart: Duplicate Finder — manual verification

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**:
2026-07-29

This project has no automated tests (Constitution Principle IV). This is the
verification script to run end-to-end before considering the feature done. Each
scenario names the requirement it proves.

## Safety first: never verify against the real databases

The real data files under `data/` hold hours of hashing. Point every database at
a throwaway location for the whole session:

```bash
export DUPLICATE_FINDER_DB_PATH=/tmp/df-verify/duplicate-finder.sqlite
export DIRECTORY_COMPARISON_DB_PATH=/tmp/df-verify/directory-comparison.sqlite
mkdir -p /tmp/df-verify
pnpm dev
```

With `DIRECTORY_COMPARISON_DB_PATH` pointing at a file that does not exist, the
read-only overlay degrades to "no cached checksums" — which is itself scenario 8
below. Unset it (or point it at the real file) only for scenario 9, and never
set `DUPLICATE_FINDER_DB_PATH` back to `data/` while testing destructive-looking
flows.

## Build the fixture tree

```bash
FIX=/tmp/df-verify/tree
rm -rf "$FIX" && mkdir -p "$FIX"/{photos/2024,backup/2024,downloads,unique,empties}

# a duplicated file pair, far apart in the tree
head -c 200000 /dev/urandom > "$FIX/photos/2024/img.bin"
cp "$FIX/photos/2024/img.bin" "$FIX/backup/2024/img.bin"
cp "$FIX/photos/2024/img.bin" "$FIX/downloads/img.bin"     # third copy, outside both folders

# a second file, duplicated ONLY inside the two folders
head -c 120000 /dev/urandom > "$FIX/photos/2024/notes.bin"
cp "$FIX/photos/2024/notes.bin" "$FIX/backup/2024/notes.bin"

# small files (below the 64 KB partial threshold) that are duplicates
head -c 1000 /dev/urandom > "$FIX/photos/small.bin"
cp "$FIX/photos/small.bin" "$FIX/downloads/small.bin"

# same size, different content — must NOT be reported
head -c 50000 /dev/urandom > "$FIX/unique/a.bin"
head -c 50000 /dev/urandom > "$FIX/unique/b.bin"

# every file here has a distinct size — used for the "no reads at all" check
for n in 11 22 33 44; do head -c "$n"000 /dev/urandom > "$FIX/unique/size-$n.bin"; done

# empties
: > "$FIX/empties/zero-a.txt"
: > "$FIX/empties/zero-b.txt"
mkdir -p "$FIX/empties/empty-one" "$FIX/empties/empty-two"

# a symlink pointing back inside the tree — must never inflate a group
ln -s "$FIX/photos/2024/img.bin" "$FIX/downloads/img-link.bin"
```

`photos/2024` and `backup/2024` now hold exactly the same two files, so they are
duplicated folders; `img.bin` additionally has a third copy outside both.

## Scenarios

### 1. Files-only scan (FR-001, FR-002, FR-012, FR-018, FR-019, SC-001 — Story 1)

Open **Find Duplicates** from the sidebar, enter `/tmp/df-verify/tree`, leave
the checkbox **off**, press **Scan**. Count the interactions on the way in:
typing the path and pressing Scan must be enough — at most three including the
checkbox, with nothing else required before the scan starts (SC-001). Reopen the
view afterwards and confirm the path came back pre-filled (FR-003), so the
second scan of the same directory is a single click.

Expect, once finished: groups for `img.bin` (3 occurrences), `notes.bin` (2),
`small.bin` (2), and the zero-byte pair (2). Expect **no** group for
`unique/a.bin` + `unique/b.bin` (same size, different content) and **no**
occurrence of `img-link.bin` anywhere (FR-011). Expand each row and check the
paths are exactly the ones created above.

### 2. Empty content is marked, not hidden (FR-016)

The zero-byte group and — in scenario 5 — the empty-folder group must be visibly
badged as empty, and must still be listed.

### 3. Sorting and pagination (FR-018, FR-020, SC-004)

Switch the sort between size and occurrences: `img.bin` (200 KB) leads by size,
and by occurrences too (3). Reload the page — the sort choice must persist
(FR-020). To exercise paging, scan a real directory with more than 50 groups,
step through pages, and confirm no group appears twice or is skipped.

**SC-004 needs a bigger result set than any convenient fixture**, so seed one
directly into the throwaway database instead of hashing a real 100 000-group
tree. With the dev server stopped:

```bash
sqlite3 "$DUPLICATE_FINDER_DB_PATH" "
  WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 100000)
  INSERT INTO duplicate_groups (checksum, kind, size, occurrence_count, is_empty, scan_seq)
  SELECT printf('%064x', i), 'file', (i * 7919) % 1000000000, 2 + (i % 5), 0,
         (SELECT scan_seq FROM scan_state WHERE id = 1)
  FROM n;"
```

(Any SQLite client works; the `sqlite3` CLI is just the shortest.) Restart the
server and time the listing: the first page, a page deep in the middle
(`?page=1200`), the last page, and a sort switch must each come back in under 2
seconds. Then delete the throwaway database and re-run scenario 1 before
continuing — the remaining scenarios assume real scan output, and hand-seeded
groups have no occurrences behind them.

### 4. The cascade really avoids reads (FR-013, SC-002)

Scan `/tmp/df-verify/tree/unique` on its own. Every file there has a distinct
size, so the scan must report zero duplicates and finish at listing speed. To
prove no content was read, watch the process while it runs:

```bash
strace -f -e trace=openat -p "$(pgrep -f 'next dev' | head -1)" 2>&1 | grep 'size-'
```

Nothing should appear for the `size-*.bin` files.

### 5. Folder detection and collapsing (FR-014, FR-015, SC-003 — Story 2)

Re-scan the same root with the checkbox **on**.

- A folder group must appear with `photos/2024` and `backup/2024`.
- `notes.bin` must **disappear** as its own group — both of its occurrences are
  explained by that folder group.
- `img.bin` must **still be listed in full, with all three paths**, because the
  copy in `downloads/` is not explained by the folder group. This is the
  regression the collapsing rule exists to prevent (research.md Decision 7).
- The two empty folders must form their own folder group, badged as empty.

Then rename a file inside one of the two folders and re-scan: the folder group
must vanish (folder identity is sensitive to child names), and the inner files
must reappear as their own groups.

### 6. Background scan, progress, Stop (FR-005, FR-006, FR-007, SC-005)

Point the scan at a genuinely large directory. While it runs:

- The panel shows the phase, the current path, a processed/total counter and the
  unreadable count.
- Navigate away to another tool and back — the scan is still running and the
  panel picks it up again.
- Press **Scan** again → it must be refused with "stop the running scan first"
  (FR-008), and the running scan must be undisturbed.
- Press **Stop** while a large file is being hashed → the scan must halt within
  ~2 s, the state becomes stopped, and whatever groups were found are shown and
  labelled partial.

### 7. Persistence across a restart (FR-023, SC-006)

After a completed scan, stop the dev server (`Ctrl-C`) and start it again. Open
the view: the same results and the same scan timestamp must be there, with no
re-scan and no user action. Confirm too that a scan interrupted by killing the
server comes back as **stopped**, never as "running" with nothing behind it.

### 8. The overlay is optional (FR-017, contract: ChecksumCachePort)

With `DIRECTORY_COMPARISON_DB_PATH` pointing at a non-existent file, everything
above must still work — the feature simply hashes everything itself.

### 9. The overlay accelerates, and stays read-only (FR-017, FR-030, SC-008)

Point `DIRECTORY_COMPARISON_DB_PATH` at a **copy** of the real comparison
database:

```bash
cp data/directory-comparison.sqlite /tmp/df-verify/directory-comparison.sqlite
sha256sum /tmp/df-verify/directory-comparison.sqlite   # before
```

Scan a directory that tool has already compared. It must be measurably faster
than the same scan against the empty overlay, and the checksum of the overlay
file must be **identical** afterwards. Then edit one file in that tree and
re-scan: the edited file must be re-hashed (its mtime changed), not grouped from
the stale value.

### 10. Re-scan reuse (SC-009, FR-009)

Scan the fixture tree twice in a row. The second run must be faster (checksums
reused from `scanned_files`) and must **replace** the previous results, not
duplicate them — occurrence counts stay the same, they do not double.

### 11. Ignore list (FR-024 — FR-028 — Story 3)

- From a results row, mark `/tmp/df-verify/tree/backup` as ignored. It must
  disappear from the listing immediately, and any group left with a single
  occurrence must disappear with it (FR-026).
- Re-scan: no reported path may lie under `backup/` (SC-007).
- Open the ignored-paths view: the entry is there with its date. Un-ignore it,
  re-scan, and the content comes back (FR-027).
- Ignore a path in the **Compare Directories** tool and confirm it is still
  reported here — the two lists are independent (FR-028).
- Scan `/tmp/df-verify/tree/backup` while it is ignored: the scan must refuse
  with the `root_ignored` message rather than silently returning nothing.

### 12. Error paths (FR-004, FR-010)

- Scan a path that does not exist → "not found", no scan started.
- Scan a file instead of a directory → "not a directory".
- Scan a directory with `chmod 000` → "unreadable".
- Make one file inside a readable tree unreadable (`chmod 000`) and scan → the
  scan completes, that file is counted in the unreadable count, and every other
  duplicate is still reported.

### 13. Nothing was touched (FR-029, SC-008)

Before and after the whole session:

```bash
find /tmp/df-verify/tree -type f -exec sha256sum {} + | sort | sha256sum
```

The digest must be identical, and `data/directory-comparison.sqlite` and
`data/count-and-size.sqlite` must not have been opened for writing at all.

## Cleanup

```bash
rm -rf /tmp/df-verify
unset DUPLICATE_FINDER_DB_PATH DIRECTORY_COMPARISON_DB_PATH
```

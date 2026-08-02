# Task 2 Report: Move push-side to `sync/` and node tests to `tests/node/`

## Status

**DONE**

## Commit

- **SHA:** `870f946`
- **Subject:** `refactor: scripts/ → sync/ push CLI + tests/node/ feature tests`

## Summary

Completed Steps 1–5 from the task brief:

1. **git mv** — All listed files moved from `scripts/` to `sync/`, `sync/lib/`, `sync/converter/`, and `tests/node/`. Removed leftover `scripts/` directory (contained only `.DS_Store`).
2. **Import depth fixes** — Updated relative imports per brief:
   - `sync/push.ts`: `./sync/*` → `./lib/*`
   - `tests/node/api.test.ts`: `../src/` → `../../src/` (imports + `vi.mock`)
   - Feature test subdirs: `../../src/` → `../../../src/`
   - `tests/node/statblock-importer/importer.test.ts`: `../converter/dom.js` → `../../../sync/converter/dom.js`
   - `sync/lib/*` and `sync/converter/*`: no changes (depth unchanged)
3. **Configs** — `package.json`, `tsconfig.scripts.json`, `vitest.config.ts` updated per brief.
4. **Verify** — `npm run verify` PASS.
5. **Commit** — Single commit with specified message.

## Verification (`npm run verify`)

```
> npm run typecheck && npm run lint && npm test && npm run build

typecheck:runtime — PASS
typecheck:scripts — PASS
lint — PASS
test — 19 files, 380 passed (380)
build — vite build PASS (55 modules, dist/module.js 295.65 kB)
```

## `git show --stat HEAD`

```
 package.json                                               |  2 +-
 scripts/converter/... → sync/converter/...                 | (renames, 0 content delta)
 scripts/sync/... → sync/lib/...                           | (renames, 0 content delta)
 scripts/forge-sync.ts => sync/push.ts                      |  4 ++--
 scripts/api.test.ts → tests/node/api.test.ts               | 14 +++++++-------
 ... (remaining test renames with import path updates only)
 tsconfig.scripts.json                                      |  2 +-
 vitest.config.ts                                           |  2 +-
 29 files changed, 35 insertions(+), 35 deletions(-)
```

## Import edits note

No unexpected import fixes were required in `sync/lib/*` or `sync/converter/*`.

## Test file recovery

Three test files (`api.test.ts`, `prad/intercept-attack.test.ts`, `target-helper/save-roll.test.ts`) had been corrupted with read-tool artifact prefixes during an interrupted prior edit. Restored from the staged rename (pre-import-fix) and reapplied **only** the brief-mandated import path depth changes. No assertions or test logic were modified.

## Non-goals confirmed

- No `sf2e-forge-custom` or `forge-sync` string/identifier renames in the diff (file move `forge-sync.ts` → `push.ts` preserves in-file strings for a later task).
- No files outside the brief's Files list were modified beyond the three config files.

## Concerns

None.

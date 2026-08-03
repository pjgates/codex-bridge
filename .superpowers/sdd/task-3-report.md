# Task 3 Report: Entity index

## Status

**DONE_WITH_CONCERNS**

Concern: Step 2 dev check (scratch Character create/edit/rename/delete in Obsidian) is pending manual verification — cannot run Obsidian interactively in this session.

## Commit

- **SHA:** `d82c5839a9ada58e63e4996d591e56a1585f698c`
- **Subject:** `feat(plugin): add entity index with metadata cache lifecycle`

## Summary

Implemented `EntityIndex` in `plugin/src/entityIndex.ts` and wired lifecycle in `plugin/src/main.ts`:

- **Initial build:** waits for metadata cache readiness via `metadataCache.on("resolved")` with `workspace.onLayoutReady` fallback; guarded to run once.
- **Maintenance:** `metadataCache.on("changed")`, `vault.on("rename")`, `vault.on("delete")` — all via `this.registerEvent`.
- **API:** `records()`, `campaigns()` (unique `{key, label}` sorted by label), `onChanged()` subscription, `destroy()` on unload.
- **Mapping:** `buildEntityRecord(path, cache)` produces `EntityRecord` for `type: Character` only; uses `parseCampaigns`, `getAllTags` (#-stripped, deduped), portrait wikilink strip, defaults (`depth` 1, `status` "active", `onstage` only when `true`); skips non-integer depth; no body reads.

## Files changed

| Path | Change |
|------|--------|
| `plugin/src/entityIndex.ts` | Created |
| `plugin/src/main.ts` | Modified — owns index lifecycle |

## Verification

Command: `npm run verify`

```
Test Files  22 passed (22)
     Tests  411 passed (411)
typecheck:runtime — PASS
typecheck:scripts — PASS
typecheck:plugin — PASS
lint — PASS
build — PASS
plugin:build — PASS
```

## Self-review

| Area | Finding |
|------|---------|
| Completeness | Brief interfaces implemented; events registered via `registerEvent`; unload calls `destroy()`. |
| Quality | Change emissions deduped when record data unchanged; `buildEntityRecord` exported for future tests/consumers. |
| Discipline | Single commit scope; no Obsidian imports in `core/`; bodies not read. |
| Testing | No mocked-App tests (per plan Decision 5); full verify green. |

## Pending manual dev-check (Step 2)

In Obsidian with plugin enabled:

1. Create a scratch `type: Character` note → `plugin.entityIndex.records()` includes it (DevTools console).
2. Edit frontmatter (e.g. `onstage`, `depth`) → index updates without reload.
3. Rename the note → `records()` reflects new path, old path gone.
4. Delete the note → entry removed from index.

Suggested console snippet: `app.plugins.plugins['codex-dashboard'].entityIndex.records()`

## Concerns

- Manual dev-check not executed in this session (blocked on Obsidian UI).
- Invalid `depth` frontmatter excludes the note from the index (fail-safe; matches sync converter strictness without throwing).


## Fix wave 1

**Commit:** `830e4d32c9d5ba4e4a734dcb5c5493cff2f9a050`

Controller adjudication: nullable `depth`/`status` — invalid or missing depth no longer excludes notes; no fabricated defaults.

### Changes

- `EntityRecord.depth`: `number | null` — missing, empty, or non-integer frontmatter → `null`, note stays indexed
- `EntityRecord.status`: `string | null` — missing/empty frontmatter → `null` (no `"active"` default)
- `sortRoster`: depth-desc, null depths sort last, then name
- `filterRoster`: null-depth records match only when `depths` filter is empty/undefined

### Test evidence

Command: `npm test -- tests/node/dashboard/roster`

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

New cases:
- `keeps null-depth records when no depth filter is applied`
- `excludes null-depth records when a depth filter is active`
- `sorts null-depth records after every numeric depth`

Command: `npm run verify`

```
 Test Files  22 passed (22)
      Tests  414 passed (414)
 typecheck:runtime — PASS
 typecheck:scripts — PASS
 typecheck:plugin — PASS
 lint — PASS
 build — PASS
 plugin:build — PASS
```

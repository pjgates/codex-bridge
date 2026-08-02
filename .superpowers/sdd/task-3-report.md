# Task 3 Report: Module id `codex-foundry` + legacy flags read fallback

## Status

**DONE_WITH_CONCERNS**

Concern: `module.json` GitHub/release URLs still reference the `sf2e-forge-custom` repository and zip artifact names (repo rename is out of scope for Task 3; Task 5 covers README/CHANGELOG). The strict acceptance grep gate for `src/` / `tests/` / `sync/` passes; including `module.json` in the brief's grep command surfaces those URLs.

## Commit

- **SHA:** `2ccc8de`
- **Subject:** `feat!: module id sf2e-forge-custom → codex-foundry; legacy flags read fallback`

## Summary

Renamed module id from `sf2e-forge-custom` to `codex-foundry` across `src/`, `tests/`, and `sync/`, added `LEGACY_MODULE_ID` read fallback in `moduleFlags`, flipped `module.json` metadata, and renamed module-specific API types from `Sf2eForgeCustom*` to `CodexFoundry*`. All 382 tests pass via `npm run verify`.

---

## TDD Evidence

### RED #1 — `moduleFlags` not exported

Command: `npx vitest run src/sync/import.test.ts`

```
 FAIL  src/sync/import.test.ts > legacy module flags > reads sync identity from the legacy sf2e-forge-custom flag key
TypeError: (0 , __vite_ssr_import_1__.moduleFlags) is not a function

 FAIL  src/sync/import.test.ts > legacy module flags > prefers codex-foundry flags when both keys are present
TypeError: (0 , __vite_ssr_import_1__.moduleFlags) is not a function

 Test Files  1 failed (1)
      Tests  2 failed | 12 passed (14)
```

### RED #2 — fallback wired; journal shell expectations still on old key

Command: `npx vitest run src/sync/import.test.ts` (after Step 2: `LEGACY_MODULE_ID`, exported `moduleFlags`, `MODULE_ID = "codex-foundry"`)

```
 FAIL  src/sync/import.test.ts > journal shell folder placement > create payload uses Entities/JournalEntry folder; adopt update omits folder
AssertionError: expected { 'codex-foundry': { …(2) } } to deeply equal { 'sf2e-forge-custom': { …(2) } }

     ✓ reads sync identity from the legacy sf2e-forge-custom flag key
     ✓ prefers codex-foundry flags when both keys are present

 Test Files  1 failed (1)
      Tests  1 failed | 13 passed (14)
```

Note: With `MODULE_ID` already `"codex-foundry"` in Step 2, the prefers-new test passes (not fails). The remaining red signal before bulk rename is the journal-shell flag-key assertions.

### GREEN — full suite after Steps 3–5

Command: `npm run verify`

```
 Test Files  19 passed (19)
      Tests  382 passed (382)
✓ built in 438ms
```

(`src/sync/import.test.ts`: 14 tests including both legacy fallback tests.)

---

## Grep gate

### `src/` `tests/` `sync/` (acceptance scope)

Command: `rg -n 'sf2e-forge-custom' src/ tests/ sync/`

```
src/constants.ts:8:export const LEGACY_MODULE_ID = "sf2e-forge-custom";
src/sync/import.test.ts:189:    it("reads sync identity from the legacy sf2e-forge-custom flag key", () => {
src/sync/import.test.ts:192:                "sf2e-forge-custom": { syncId: "fs-abc123", syncKind: "entity-journal", importedHash: "h1" },
src/sync/import.test.ts:202:                "sf2e-forge-custom": { syncId: "old-id" },
```

`src/sync/import.ts` uses `LEGACY_MODULE_ID` (no literal string) — import + fallback semantics as specified.

### Brief command (includes `module.json`)

Command: `rg -n 'sf2e-forge-custom' src/ tests/ sync/ module.json`

```
module.json:43:    "url": "https://github.com/pjgates/sf2e-forge-custom",
module.json:44:    "manifest": "https://github.com/pjgates/sf2e-forge-custom/releases/latest/download/module.json",
module.json:45:    "download": "https://github.com/pjgates/sf2e-forge-custom/releases/download/v0.3.0/sf2e-forge-custom.zip",
module.json:46:    "bugs": "https://github.com/pjgates/sf2e-forge-custom/issues",
module.json:47:    "changelog": "https://github.com/pjgates/sf2e-forge-custom/releases"
(+ src/constants.ts and src/sync/import.test.ts lines above)
```

---

## `module.json`

| Field | Value |
|-------|-------|
| `id` | `codex-foundry` |
| `title` | `Codex Foundry` |
| `version` | `1.0.0` |
| `system` | `["sf2e"]` |
| `relationships.systems[0].id` | `sf2e` (unchanged) |

---

## Identifier renames (Step 5)

### Renamed (module-specific)

| Old | New | Files |
|-----|-----|-------|
| `Sf2eForgeCustomApiErrorCode` | `CodexFoundryApiErrorCode` | `src/api.ts`, `src/types/fvtt-augments.d.ts` |
| `Sf2eForgeCustomApiError` | `CodexFoundryApiError` | same |
| `Sf2eForgeCustomApiFailure` | `CodexFoundryApiFailure` | same |
| `Sf2eForgeCustomApiResult` | `CodexFoundryApiResult` | same |
| `Sf2eForgeCustomCreatedMessageResult` | `CodexFoundryCreatedMessageResult` | same |
| `Sf2eForgeCustomApi` | `CodexFoundryApi` | same |
| `Sf2eResolvedUuidDocumentName` | `CodexFoundryResolvedUuidDocumentName` | `src/types/fvtt-augments.d.ts`, `src/api.ts` |
| `Sf2eResolvedUuidDocument` | `CodexFoundryResolvedUuidDocument` | same |
| `Sf2eGameModule` | `CodexFoundryGameModule` | `src/types/fvtt-augments.d.ts` |

Also bulk-renamed string `sf2e-forge-custom` → `codex-foundry` across `src/`, `tests/`, `sync/` (lang keys, flag paths, settings keys, templates, tests), then restored intentional legacy literals per brief.

### Deliberately left (sf2e *system* / ruleset)

- `Sf2eGame`, `Sf2eGameNamespace` — `game.pf2e` / SF2e namespace accessors
- `Sf2eActor`, `Sf2eActorSystemData`, `Sf2eActorSheet`, `Sf2eActorExtensions`
- `Sf2eTokenDocument`, `Sf2eUserTargetToken`, `Sf2eActiveToken`
- `Sf2eItem`, `Sf2eStatistic`, `Sf2eCheckModifierInstance`, `Sf2eModifier`, `Sf2eRawCheckRollContext`
- `Sf2eRollCallback`, `Sf2eRollDieTerm`, `Sf2eRerollResource`, `Sf2eRerollHookOptions`
- `Sf2eFoundryGlobal`
- `"sf2e"` in `module.json` `system` and `relationships`
- `src/rulesets/sf2e/**` path and all SF2e ruleset implementation code
- `forge-sync` strings (Task 4)

---

## Key implementation

**`src/constants.ts`**

```ts
export const MODULE_ID = "codex-foundry";
export const LEGACY_MODULE_ID = "sf2e-forge-custom";
```

**`src/sync/import.ts` — `moduleFlags`**

```ts
export function moduleFlags(doc: { flags: Record<string, unknown> }): SyncModuleFlags {
    // ponytail: legacy-key read fallback keeps pre-rename docs managed; removal = one-time flag-migration script if cleanup is ever wanted
    return ((doc.flags[MODULE_ID] ?? doc.flags[LEGACY_MODULE_ID]) ?? {}) as SyncModuleFlags;
}
```

---

## Non-goals respected

- No `forge-sync` renames
- No layout moves
- No README/CHANGELOG edits

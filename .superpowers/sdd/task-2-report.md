# Task 2 Report: Pure core + tests

## Status

**DONE**

## Commit

- **SHA:** `e3231ee948ad2017cc41f8b100689f0461e6fed4`
- **Subject:** `feat(plugin): add dashboard pure core modules and tests`

## Summary

Implemented the codex-dashboard pure logic core with TDD:

- `splitSecret(fileText)` — strips frontmatter, leading H1, and portrait `![[...]]` embed; extracts first description paragraph; splits on a line whose trimmed content is exactly `%%Secret%%`; fail-safe `secret: null` when absent; `gmSectionCount` = `## ` H2 count below marker.
- `parseCampaigns(frontmatterValue)` — wikilink parse + Decision 2 slug normalizer (`codex/` prefix strip, `/index` or `.index` suffix strip); label from alias or title-cased slug.
- `EntityRecord` + `filterRoster` / `sortRoster` — campaign/onstage/depth/query filters; depth-desc then name sort; case-insensitive name+alias search.

No Obsidian imports in `plugin/src/core/`.

## Files changed

| Path | Change |
|------|--------|
| `plugin/src/core/secretSplit.ts` | Created |
| `plugin/src/core/campaign.ts` | Created |
| `plugin/src/core/roster.ts` | Created |
| `plugin/src/core/index.ts` | Created (barrel) |
| `tests/node/dashboard/secret-split.test.ts` | Created |
| `tests/node/dashboard/campaign.test.ts` | Created |
| `tests/node/dashboard/roster.test.ts` | Created |
| `tests/node/dashboard/fixtures/randall.md` | Created (vault copy for realistic split fixture) |

## Self-review

| Area | Finding |
|------|---------|
| Completeness | All brief interfaces implemented; census campaign variants, valor list, randall-shaped split, marker absent/variant cases covered. |
| Quality | Pure functions only; no Obsidian deps; normalizer matches Decision 2. |
| Discipline | TDD order followed (tests before implementation); single commit. |
| Testing | 19 new dashboard tests; full `npm run verify` green (411 tests). |

## Concerns

None. Randall fixture reports 11 GM H2 sections (Voice Card subsections included) — matches spec rule counting all `## ` headings below the marker.

## TDD evidence

### RED

Command: `npm test -- tests/node/dashboard`

```
 FAIL  tests/node/dashboard/campaign.test.ts
Error: Cannot find module '../../../plugin/src/core/campaign.js'

 FAIL  tests/node/dashboard/roster.test.ts
Error: Cannot find module '../../../plugin/src/core/roster.js'

 FAIL  tests/node/dashboard/secret-split.test.ts
Error: Cannot find module '../../../plugin/src/core/secretSplit.js'

 Test Files  3 failed (3)
      Tests  no tests
```

Expected: modules did not exist yet; import resolution fails before any assertions run.

### GREEN

Command: `npm test -- tests/node/dashboard`

```
 Test Files  3 passed (3)
      Tests  19 passed (19)
```

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

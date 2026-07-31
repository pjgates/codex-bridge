# Task 3 — Payload building report

## Implementation

Created `scripts/sync/build-payload.ts`. `buildPayload` reads all Markdown entities and statblocks for a campaign, mints and persists missing `syncId` values, detects duplicate IDs across both source directories, produces the payload and manifest hashes, stages portrait sources as `art/<syncId><ext>`, and reports portrait-less Characters without excluding their journals. It includes unpublished entities and converts only recognised entity wikilinks to `@ForgeSync` placeholders (using case-insensitive vault-slug lookup).

## TDD evidence

### RED

`npx vitest run scripts/sync/build-payload.test.ts` failed before implementation because `./build-payload.js` did not exist:

```
Error: Cannot find module './build-payload.js'
```

### GREEN

After implementation, `npx vitest run scripts/sync/build-payload.test.ts` passed with 5/5 tests. The tests cover syncId persistence and art staging, duplicate-ID rejection, missing-portrait rejection, unpublished inclusion with GM content, and creature statblock transport.

Regression and narrow type checks also passed:

```
npx vitest run scripts/sync/frontmatter.test.ts  # 4/4 passed
npx tsc --noEmit --target ES2022 --module Node16 --moduleResolution Node16 --strict --esModuleInterop --skipLibCheck --types node,fvtt-types scripts/sync/build-payload.ts scripts/sync/frontmatter.ts  # passed
```

## Fixture and fallback decision

The creature test is self-contained: it pastes the smallest `statblock: true` parser-test fixture and derives the brief-required Dust Manta name and level from it, without importing a fixture. It retains the required `attributes`, `modifier`, `saves`, `speed`, `ac`, and `hp` fields. `parseEntity` accepts the current bestiary frontmatter shape (its required fields have defaults), so the conditional `readOptionalSyncFields` fallback was not needed; creature mechanical data remains exclusively sourced from `parseCreature`.

## Self-review

- Portrait-less Characters generate a warning while retaining their entity payload.
- Art source entries map to `art/<syncId><original-extension>`.
- Unknown links become display text; only present entity slugs become ForgeSync placeholders.
- `published` is copied as visibility data and never filters payload inclusion.
- Missing IDs are written to source files and reported via `mintedFiles`.

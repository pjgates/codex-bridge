# Task 6 Report: Sync Plan Pure Diff Logic

## Commit

- Message: `feat(sync): pure sync-plan diff with (docType, syncId) identity and name adoption`

## Implementation

- Added `src/sync/plan.ts`, a Foundry-independent sync planner consuming `SyncPayload` and world snapshots.
- Exported the full Task 6 contract: managed document and sync-kind types, snapshots, action types, stale-document type, plan type, `payloadItems`, `actionKey`, and `computeSyncPlan`.
- `payloadItems` emits an entity journal for every entity, a people actor only for character entities with portraits, and a creature actor for every creature.
- The planner uses `(docType, syncId)` for managed-document lookup, exact `(docType, name)` for one-to-one adoption, and reports unmatched flagged documents as stale without deletion.
- Payload `contentHash` is used only for payload-side change detection; actor state uses `importedBaseline` and `currentHash` to compute `modifiedInFoundry`.

## TDD Evidence

1. Added the 10 specified behavioural tests in `src/sync/plan.test.ts` before `plan.ts` existed.
2. `npx vitest run src/sync/plan.test.ts` initially failed as expected because `./plan.js` did not exist.
3. Implemented the minimal pure planner and reran the focused suite successfully.

## Verification

```text
npx vitest run src/sync/plan.test.ts
Test Files  1 passed (1)
Tests  10 passed (10)

npm run typecheck
> tsc --noEmit -p tsconfig.json
> tsc --noEmit -p tsconfig.scripts.json
```

## Self-review

- Confirmed managed identity never falls back to `syncId` alone, preventing journal/actor collisions.
- Confirmed adoption refuses both ambiguous world candidates and ambiguous payload names, consuming a valid candidate only once.
- Confirmed the two hash domains are not compared: `importedHash` is compared with the payload content hash, while `currentHash` is compared only with `importedBaseline`.
- Confirmed stale documents are collected but not removed or otherwise mutated.

## Scope

The pre-existing modified `.superpowers/sdd/task-3-report.md` was left untouched and excluded from this task.

# Foundry Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make movement features configurable and make the module's existing settings understandable without losing world preferences.
**Architecture:** Keep feature-owned setting registration and native Foundry forms; a small settings presenter groups rows and updates dependencies. Migrate effective preferences before ready-time activation.
**Tech Stack:** Foundry v14 settings, TypeScript, Vitest with the existing happy-dom dependency for form tests.
**Spec:** [Configuration supplement](../specs/2026-09-21-regions-movement/CONFIGURATION.md).

## Global Constraints

Inherit the [main plan](2026-09-21-regions-movement.md). No new dependency, new settings application, secret migration to world storage or automatic activation of previously disabled utilities. These slices extend the approved implementation plan.

## Review Focus

Unsaved parent toggles; child values omitted by disabled HTML inputs; rules-off upgrades; partially completed migrations; runtime entry points bypassing disabled controls. Each is covered below or by the owning movement slice.

### Slice S1: Group and clarify existing settings

Files: create `src/settings/presentation.ts`, `tests/node/settings/presentation.test.ts`; modify `src/hooks/init.ts`, `src/shared/lang/en.json`, `eslint.config.js` only as needed to admit the settings presenter at the existing import boundary. No behavioural settings migration in this slice.
Interfaces: `activateSettingsPresentation(): void` replaces `onRenderSettingsConfig`; `settingDependencies(values: Readonly<Record<string, boolean>>): Readonly<Record<string, boolean>>` returns disabled status for dependent setting keys. Add only known dependencies; do not create a generic settings schema framework.

```ts
expect(settingDependencies({enableCustomRules:true,enableTargetHelper:false,playersRollAllDice:true}).pradStrictDCs).toBe(true);
```

- [ ] Add red DOM tests using `// @vitest-environment happy-dom`: unsaved Target Helper/PRAD toggles, preserved child preference on save, repeated rendering, module search, player-visible client settings and sync-button coexistence. Run `npm test -- tests/node/settings/presentation.test.ts`.
- [ ] Move the existing dependency presenter into the settings file; group existing Codex rows under the supplement's headings and listen for local form changes. Preserve field names and native submit behaviour. Disabling a row must not clear a stored true value when native FormData omits its input. Keep utility dependencies unchanged until S2's migration ships.
- [ ] Rerun green and the common typecheck/lint/build checks. In Foundry, save a parent off then on and confirm the child value survives; search for “sync” and open its existing button. Update copy beside its existing keys rather than changing those keys.

### Slice S2: Separate utilities from rules without enabling them during upgrade

Files: create `src/settings/migration.ts`, `tests/node/settings/migration.test.ts`; modify `src/hooks/ready.ts`, `src/sync/dialog.ts`, `src/rulesets/sf2e/statblock-importer/import-dialog.ts`. Include the small presenter dependency update in `src/settings/presentation.ts` when runtime separation lands. Depends on S1.
Interfaces: `utilityUpgrade(master:boolean, sync:boolean, importer:boolean): {enableCodexSync:boolean; enableStatblockImporter:boolean}`; `migrateSettings(): Promise<void>` is called before features start. Register a hidden world migration version during init through the existing presenter/settings initialization entry point; preserve that version on repeat runs.

```ts
expect(utilityUpgrade(false,true,true)).toEqual({enableCodexSync:false,enableStatblockImporter:false});
expect(utilityUpgrade(true,false,true)).toEqual({enableCodexSync:false,enableStatblockImporter:true});
```

- [ ] Test the two mappings, stable keys, repeat runs, partial failure, explicit utility off, and client-local passphrase untouched; run `npm test -- tests/node/settings/migration.test.ts` red.
- [ ] Only the designated active GM writes migration changes. Until completion, other clients retain the old effective utility gates; do not block the entire ready hook or wait forever when no GM is connected. Set completion after successful writes and use the normal reload notification for activation. Remove the rules gate from `syncGatesPass` and Statblock Importer's button after migration; move the ready-time sync check outside the rules-only early return. Keep their own switches and existing GM checks.
- [ ] Rerun green/common checks and verify two upgraded disposable worlds, rules on/off. The rules-off world keeps both formerly suppressed utilities off; the GM can then enable either independently. No fetching/import side effects occur before migration completes. Include the one-time mapping in README/CHANGELOG.

### Slice S3: Register movement controls and migrate preferences

Files: create `src/rulesets/sf2e/movement/settings.ts`, `tests/node/settings/movement.test.ts`, `src/rulesets/sf2e/movement/lang/en.json`; modify `src/hooks/init.ts`, `src/settings/migration.ts`; create the small `src/rulesets/sf2e/movement/index.ts` public export entry point. Depends on S2; land registration before movement slice 7a, and wire each gate in its owning movement slice rather than building an unused parallel controller.
Interfaces: `registerMovementSettings(): void`; `movementFeatureEnabled(feature: "climbing"|"falling"|"flightUpkeep"|"forcedMovement"): boolean`; `movementOutcomeMode(): "advisory"|"apply"`. Export through movement's index so init respects feature import boundaries. The configuration supplement defines all persistent keys.

```ts
// Stub settings.get with the registered defaults, then override explicit preferences.
expect(movementOutcomeMode()).toBe("advisory");
expect(movementFeatureEnabled("flightUpkeep")).toBe(false);
```

- [ ] Test defaults, master-off override, upkeep's falling dependency, explicit new preference preserved and legacy climb/check combinations. Run `npm test -- tests/node/settings/movement.test.ts tests/node/settings/migration.test.ts` red.
- [ ] Register world-scoped switches and outcome choices with explanatory hints/reload semantics, and extend the idempotent migration according to the supplement. Add headings/dependencies in the presenter as each feature ships. Retire the visible `enforceClimb` control only when slice 17 removes its final runtime use; retain its saved value for migration.
- [ ] Rerun green/common checks; inspect GM/player forms and explicitly opt in to application. Owning slices 7–17 each add off/advisory/apply tests: no automatic coordinate/damage/condition mutation in Advisory, no macro bypass, no late application after settings change. Final checkpoint verifies both modes and each feature off.

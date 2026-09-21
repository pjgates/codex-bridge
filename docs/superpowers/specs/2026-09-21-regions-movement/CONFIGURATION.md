# Foundry settings and upgrade behaviour

Status: feature switches, shared outcome mode, utility separation and opt-in automatic consequences confirmed by the user on 2026-09-21. This supplements the approved component specs. The concrete controls and migration mapping below are part of the approved implementation plan.

## Purpose and organization

Expose feature configuration under Foundry's existing **Configure Settings → Codex Foundry** entry. Keep one installable module and one settings namespace. Group native rows with clear headings: **Rules**, **Movement and terrain**, **Gridless combat**, **Imports and sync**, and **Diagnostics**. Preserve native save, search, reset, permissions and keyboard navigation; do not build a separate settings application merely to reorganize the form.

“Enable Custom Rules” governs game-rule automation only. Vault Sync and Statblock Importer use their own switches. Region type registration, compatibility reads and data migration remain available with rules off: disabling automation must not make stored scene documents invalid. Tile clipping remains independent as it is today.

## Current inventory and cleanup

| Setting | Group / treatment |
|---|---|
| `enableCustomRules`, `enableTargetHelper`, `playersRollAllDice`, `pradStrictDCs`, `heroicRerolls` | Rules; keep keys and existing defaults; explain Target Helper → PRAD dependency. |
| `enforceClimb`, `promptMovementChecks` | Replace outdated climb semantics through the migration below; retain Squeeze prompting independently. |
| `gridlessCombat`, `movementPreview`, `movementLattice` | Gridless combat; describe their gridless-only scope and whether reload is needed. |
| `enableCodexSync`, `codexSyncPassphrase`, `enableStatblockImporter` | Imports and sync; independent of the rules switch; preserve the sync action button. |
| `movementDebug` | Diagnostics; retain client scope. |
| `codexSyncLastManifest` | Internal state; remain hidden. |

Dependent controls must update from the unsaved form values, not only the stored settings at render time. Disabled controls display a short explanation and retain their saved preference. Re-enabling a parent restores the child preference rather than resetting it. Repeated rendering must not duplicate headings/buttons/listeners. Keep the passphrase client-local and never move it into a world setting or include its value in logs, screenshots or migration reports.

## Movement controls

| Key | User-facing control | Scope and proposed default |
|---|---|---|
| `enableClimbing` | Resolve climbing checks | World; on for new worlds; upgrades derive from legacy climb/check preferences. |
| `enableFalling` | Detect and resolve falls | World; on, with the advisory outcome mode below. |
| `enableFlightUpkeep` | Check flight upkeep at turn end | World; off until enabled, since this is new turn automation. |
| `enableForcedMovement` | Enable forced-movement dragging and API | World; on; F/API use is explicit and outcomes start advisory. |
| `movementOutcomeMode` | Movement outcomes: Advisory / Apply after choices | World; Advisory until the GM opts into application. |

Feature switches govern both UI and runtime entry points, including macros, condition/effect hooks, preview and pending decisions. A rules switch overrides all these features. Flight upkeep requires falling; show that dependency without discarding the upkeep preference. Forced movement can remain available with falling off, but must not silently apply falls; leave dangerous consequences for the GM. Turning off climbing does not turn a collision wall into a walkable surface.

**Advisory** still identifies a consequential transition and offers applicable system actions/reactions, then presents the proposed movement, damage and conditions for manual GM resolution. It does not automatically commit those consequences. **Apply after choices** follows the agreed pause → choice/check → movement/damage/condition flow. Neither mode auto-spends an optional reaction. Ordinary supported travel and short treads retain normal movement; neither mode pauses every drag.

Keep the configurable F binding in Foundry's native Configure Controls, and explain its location beside the forced-movement setting. Existing elevation/preview bindings remain there too. Region-specific DCs belong on the region sheet, with the module settings pointing users there; do not duplicate them as global defaults.

## Upgrade contract

Run an idempotent, GM-authoritative settings migration before feature activation. Never overwrite a new setting already explicitly stored. Record migration completion only after all intended writes succeed; report an interrupted migration rather than treating it as complete.

- Preserve stable setting keys, types, scope and stored values when only labels/order change.
- Seed `enableClimbing` from `enforceClimb || promptMovementChecks` only when it has no stored value. Keep the legacy values hidden for migration history; after cutover neither may permit an unchecked climb.
- Retain `promptMovementChecks` for its remaining Squeeze purpose, relabelling it clearly after the Climb consumer moves. Its stored value remains unchanged.
- Default automatic outcome application to Advisory; no legacy combination implies consent to automatic damage or conditions.
- If `enableCustomRules` was off before utility separation, preserve the effective disabled state of Sync and Statblock Importer by storing their independent switches as off. If rules were on, retain each utility's current value. Explain this one-time mapping in release notes.
- Turning a feature off while its decision is pending prevents subsequent automatic writes; stop/recover the request visibly. For settings requiring reload, use Foundry's normal reload notice. Do not claim immediate effect for ready-time-only hooks.

## Verification

Verify saved and unsaved dependencies, a rules-disabled upgraded world, explicit new preferences, repeated migration, player versus GM forms, client-local values, and cancelled/reloaded pending movement. Test each feature switched off through drag, macro and actor hooks. Both outcome modes must produce the same proposed rules result; only authorized application differs. Confirm native settings search and the sync button still work after grouping.

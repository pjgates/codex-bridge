# Spec: movement-rules

Status: design approved on 2026-09-21. Depends on `surface-resolution`; inherits the shared engineering contract in [README](README.md).

## Objective

Resolve PF2e/SF2e elevation transitions at the point they become consequential. Use system actions and their check results, then apply permitted movement, damage and conditions once.

## Movement intent and interaction

All runtime entry points obey the feature switches and shared outcome mode in [Configuration](CONFIGURATION.md). Automatic consequences below require Apply after choices; Advisory computes and presents them for manual GM resolution. Rules-off does not unregister region types or disable utility tools.

Distinguish walking, climbing, flying, jumping, teleportation, forced movement and deliberate GM placement. Foundry's `displace` action alone must not be treated as a shove: it can also represent administrative placement.

Hold **F**, configurable in Foundry controls, to mark movement as forced; show “Forced” in the preview and capture that intent on submission. Release/cancel/window blur clears transient key state. Ordinary drags retain their selected movement mode. The macro API supplies the same explicit intent and distinguishes push/pull from other forced effects.

When a forced path encounters a dangerous destination and the effect's permission is unknown, ask whether it is push/pull, another effect that explicitly permits danger, or an effect that cannot enter danger. Do not charge forced movement against the victim's voluntary movement allowance or route it around obstacles to consume their Speed.

## Resolution lifecycle

1. Read the submitted intent and trace physical transitions through the path.
2. Execute only the safe prefix and pause at the first consequential transition.
3. Obtain missing terrain rulings from the GM; offer eligible actions/reactions to the controlling user.
4. Invoke the system's action/check API with the selected statistic, DC and actor. A cancelled roll is not a failed check.
5. Apply the selected result through system damage/condition interfaces and Foundry movement, preserving destination level and collisions.
6. Resume a still-valid continuation or stop where the result requires. Revalidate after an asynchronous decision; a stale dialog cannot move a token that has since moved elsewhere.

Use Foundry's movement identity and pause/resume APIs for client coordination. Only the responsible initiator/GM applies outcomes. A second client, repeated event or double click cannot duplicate damage or movement. Cancellation, disconnect or an unresolved ruling leaves a recoverable stop and a clear GM decision rather than an invisible permanent pause.

## Rule scope

| Situation | Required result |
|---|---|
| Existing short stair/ramp transition | Retain the workshop's 2.5 ft tread convention without asking for a Climb roll at every tread. |
| Rise beyond a tread while on foot | Stop at the rise and offer Climb or cancellation; resolve required Athletics check before vertical progress. |
| Deliberate descent using Climb | Apply climbing rules, not an unconditional fall or a check after arrival. |
| Climb result | Limit progress to the action's allowed distance; failure makes no progress, critical failure invokes the applicable fall/prone outcome. Account for climb Speed and system adjustments. |
| Wall attempt | A climbable, described vertical face can use the Climb flow. A collision wall alone does not prove a climbable route or a clear destination; ask for the missing GM ruling without disabling all walls. |
| Unsupported grounded movement | Stop at support loss, offer available edge reactions, then fall to the first supporting surface if not caught. |
| Forced push/pull over an edge | Resolve support loss and fall without a voluntary Climb prompt; other forced effects respect their destination restrictions. |
| Active flight above terrain | Preserve altitude; do not snap to every lower floor or fall merely because the floor ends. Respect solid obstructions. |
| Flight is lost | Enter the same fall resolution, including condition eligibility and available reactions. A forced move by itself does not end flight. |
| Grab an Edge | Offer the system action when an edge/handhold is reachable; resolve hand availability, DC and degree of success before deciding whether the creature catches itself. |
| Arrest a Fall | Offer when the creature can use the reaction and has a fly Speed. A successful check prevents fall damage; it does not itself establish resumed hovering. |
| Landing | Resolve distance, supported mitigation and actual damage through the system; apply Prone according to the resulting rule outcome. Change to the supporting surface's level. |
| No mapped landing | Pause for the GM to supply a landing or another ruling. |
| Explicit teleport/GM placement | Do not reinterpret the traversed line as walking through every region; any destination consequence must be explicit. |

Use system data and action results rather than duplicating Athletics/Acrobatics modifiers or rolling raw d20s. Preserve existing fall-mitigation capabilities after checking their conditions; do not assume every existing slug implies unconditional immunity. Retain the existing master rules switch.

Flight upkeep needs an explicit distinction between using Fly without displacement (hovering) and not using Fly. Proposed interaction: at turn end, ask when no authoritative Fly-use record exists; only a confirmed missed Fly action triggers the fall. Do not infer action expenditure from distance moved.

## Exceptional cases and integration boundaries

The first delivery automatically resolves mapped ledges, vertical climbs, ordinary-gravity falls and water landings with known depth. Unknown handholds, special movement abilities, unsupported mitigation, unusual gravity, long falls spanning rounds, collision with another creature during a fall, and ambiguous action/reaction availability require a visible GM ruling before consequences. They must not silently receive an ordinary landing result.

Jump intent must not fall at the first gap crossed, but this work does not replace the system's full Leap/High Jump/Long Jump action automation. Preserve supported jumping and ask for missing trajectory/landing facts. Squeeze prompting remains a separate existing concern.

## Structure, tests and acceptance

Keep rule decisions in `src/rulesets/sf2e/` (shared by both systems). Integrate the existing `gridless/elevation.ts`, `floors.ts`, `checks.ts`, and `flying/fall.ts` through one transition owner. Remove superseded duplicate elevation/fall handling as each consumer cuts over. Keep ruler previews and movement costs consistent with executed paths.

Test resolved outcomes through system-action fakes, then exercise the real action dialogs and damage APIs in both systems. Include one GM plus one player client, cancellation, stale decision, and repeat-event cases.

Acceptance: the specified 20 ft cross-level push waits for reactions and lands on the lower region; successful edge catch prevents that landing; active flight crosses the gap unchanged; a climb cannot finish before its check; a long drag cannot skip a fall; each outcome is applied once; a missing landing/DC produces the agreed GM interaction. Existing imported maps and their previews continue to work after the chosen compatibility transition.

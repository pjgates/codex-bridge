# Movement Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve consequential elevation movement with player choices and system outcomes.
**Architecture:** One movement feature owns transitions; geometry stays in canvas/regions and system-specific rolls stay in narrow action/damage adapters.
**Tech Stack:** Foundry v14 movement/checkpoints, PF2e/SF2e action and damage APIs, TypeScript/Vitest.
**Spec:** [movement-rules](../specs/2026-09-21-regions-movement/SPEC-movement-rules.md).
## Global Constraints
Inherit [all index constraints and contracts](2026-09-21-regions-movement.md), including the configuration supplement. S3 supplies `M/index.ts`, `M/settings.ts` and `M/lang/en.json` before these slices; entries below that say create those files must instead extend their existing contents. `M/` means `src/rulesets/sf2e/movement/`; tests live in `tests/node/movement/`. “Common checks” means the commands in the index, not a substitute for each live scenario. Each mutation test explicitly selects Apply after choices; add a corresponding Advisory/no-write case and feature-off case at the same runtime entry point.
## Review Focus
Player/GM ownership, stale/repeated decisions, unavailable reactions, temporary HP/IWR, modifier lifecycle and hovering without displacement.

### Slice 7a: Pause at a physical transition
Files: create `M/index.ts`, `M/transitions.ts`, `tests/node/movement/transitions.test.ts`; modify `src/hooks/ready.ts`, `src/rulesets/sf2e/gridless/floors.ts`. Depends on 6. Produces `activateMovementTransitions(): void`; consumes `traceContacts` and `MovementIntent`. Keep token-creation floor placement; replace only conflicting path rewriting for transitions now owned here.
```ts
// Verify the real hook lifecycle with a stub TokenDocument and registered hooks.
expect(token.pauseMovement).toHaveBeenCalledWith(`codex-foundry:${movementId}:0`);
expect(token.update).not.toHaveBeenCalledWith(expect.objectContaining({elevation:-20}));
```
- [ ] Write the red hook test for a path with support loss, capturing actual callbacks as the existing floors tests do; run `npm test -- tests/node/movement/transitions.test.ts tests/node/gridless/floors.test.ts`.
- [ ] Insert a native checkpoint at the safe prefix during path preparation; retain the requested remainder. Pause from the initiating client's movement event while it has pending movement, not from preMoveToken before native state exists. Ordinary treads continue; no automatic roll/damage yet. Show a GM-readable stop reason and native stop/resume recovery.
- [ ] Rerun green/common checks. In Foundry, confirm pending path really remains paused at the edge for both player- and GM-initiated movement, hidden tab included. Do not proceed if the lifecycle test fails; adjust to the documented native event order first.

### Slice 7b: Persist and resolve movement decisions
Files: create `M/decisions.ts`, `M/lang/en.json`, `tests/node/movement/decisions.test.ts`; modify `M/transitions.ts`, `M/index.ts`. Depends on 7a. `openDecision(ref: TransitionRef, reason: string): Promise<string>` creates a persistent chat request; `isCurrentTransition(ref, token): boolean` compares token UUID, native movement ID and checkpoint. Use structural token types with only these fields.
```ts
expect(isCurrentTransition({tokenUuid:"Scene.s.Token.t",movementId:"old",checkpoint:0},
  {uuid:"Scene.s.Token.t",movement:{id:"new"},checkpoint:0})).toBe(false);
```
- [ ] Test stale token movement, duplicate response, cancelled decision, initiator disconnect and no active GM; run `npm test -- tests/node/movement/decisions.test.ts` red.
- [ ] Render request/response buttons through `renderChatMessageHTML`. Store reference, authorized chooser, reason and pending/resolved status in Codex message flags. A chooser who cannot update the request posts an authored response; the designated resolver validates author ownership and the referenced request before acting. Reuse existing designated-owner selection where its permission semantics fit; avoid a second socket framework.
- [ ] GM rulings are GM-authored; player choices/checks are actor-owner-authored. The original initiator alone pauses; one active designated resolver persists the decision and resumes with native movement ID/key. If the initiator disconnected or moved, stop the old request and let the GM explicitly reissue from current state; never replay stale callbacks. Test two simultaneous clicks and reloaded chat cards, rerun green/common checks, then run checkpoint 7.

### Slice 8: Configure terrain DCs
Files: create `src/canvas/regions/config.ts`, `tests/node/regions/config.test.ts`; modify `src/canvas/regions/index.ts`, `src/canvas/regions/lang/en.json`, `src/hooks/init.ts`. Depends on 7b. Store optional `flags.codex-foundry.climbDC` and `grabEdgeDC`; expose `regionDC(flags, action): number | null`, using Climb DC for Grab an Edge when the latter is absent.
```ts
expect(regionDC({climbDC:20},"grab-an-edge")).toBe(20);
expect(regionDC({},"climb")).toBeNull();
```
- [ ] Add red tests for absence, zero, override and invalid form input; run `npm test -- tests/node/regions/config.test.ts`.
- [ ] Add labelled optional fields to native region configuration with boundary validation on submit. Preserve unrelated flags. Missing DC routes to the existing GM decision card instead of a hidden default.
- [ ] Rerun green/common checks and edit/reload DCs as GM; as player, trigger a missing-DC transition and verify only the GM can supply it. Region configuration must not change geometry or importer schemas.

### Slice 9: Resolve climbing before advancing
Files: create `M/climb.ts`, `M/checks.ts`, `tests/node/movement/climb.test.ts`; modify `M/transitions.ts`, `src/rulesets/sf2e/gridless/checks.ts`. Depends on 8. `rollMovementCheck(actor, slug, statistic, dc): Promise<0|1|2|3|null>` uses `game.pf2e.actions.get(slug).use`; null means cancelled. `climbDistance(speed: number, degree: 0|1|2|3): number` covers ordinary climbing before actor-specific overrides.
```ts
expect(climbDistance(25,2)).toBe(5);
expect(climbDistance(25,3)).toBe(10);
expect(climbDistance(25,1)).toBe(0);
```
- [ ] Add red tests for success, failure, critical failure from stable ground versus already climbing, cancellation, hands unavailable and climb Speed; run `npm test -- tests/node/movement/climb.test.ts tests/node/gridless/checks.test.ts`.
- [ ] Await system degree of success, cap progress to the chosen action, and route critical-failure falls to the shared transition flow. Read climb-Speed/system adjustments; use the GM decision when a wall does not establish a climbable face or destination. Retain Squeeze prompting but remove the old post-move Climb prompt for owned transitions.
- [ ] Rerun green/common checks; verify a tall wall cannot be cleared by one ordinary successful Climb, downward Climb is distinct from stepping off, and no collision wall is globally disabled. Once enabled, `enforceClimb` cannot authorize an unchecked ascent; retire that obsolete bypass when its final consumers move in slice 17.

### Slice 10: Apply ordinary falling outcomes
Files: create `M/landing.ts`, `M/damage.ts`, `tests/node/movement/landing.test.ts`; modify `M/transitions.ts`, `src/rulesets/sf2e/flying/index.ts`. Depends on 7b. Export existing pure `fallOutcome`/`fallProfile` and `setFlying` through the flying public entry point; movement consumes those functions without reverse imports. `applyFallDamage(actor, token, amount, ref): Promise<number>` returns actual applied damage; `resolveLanding(ref): Promise<void>` uses current support identity.
```ts
// With no mitigation: typed damage applied once, lower level selected from support.
expect(damageRoll.formula).toContain("10[bludgeoning]");
expect(token.move).toHaveBeenCalledWith(expect.objectContaining({elevation:-20,level:"lower"}),expect.anything());
```
- [ ] Test 20 ft cross-level fall, nearer intermediate floor, unknown landing, zero damage, full resistance and damage absorbed by temporary HP; run `npm test -- tests/node/movement/landing.test.ts tests/node/flying/fall.test.ts` red.
- [ ] Construct the system's registered `DamageRoll`, evaluate it, and call `actor.applyDamage({damage: roll, token, rollOptions})`; never pass a plain number or `final:true` because those bypass IWR. Correlate the system damage operation to the actor/transition using a unique roll option and its resulting damage context. Inspect the system's `damageTaken` operation and damage-taken message to establish actual damage, including temporary HP; do not infer it solely from HP loss. Pin the supported PF2e/SF2e runtime contract in adapter tests before using it for Prone.
- [ ] Land through native movement using the selected support's level, remove airborne state, and apply system Prone only when the rule outcome requires it. Keep choices manual through slice 7b until slice 11 supplies reaction buttons. Record application phases on the request; uncertain interrupted damage application requires GM recovery, never an automatic retry that can duplicate damage.
- [ ] Rerun green/common checks and apply a real fall to a normal actor, resistant actor and actor with temporary HP in both systems. Verify exactly one damage record and correct Prone. No result is reported as automated if the adapter cannot establish its actual outcome.

### Slice 11: Resolve fall reactions before landing
Files: create `M/reactions.ts`, `tests/node/movement/reactions.test.ts`; modify `M/decisions.ts`, `M/landing.ts`, `M/lang/en.json`. Depends on 8, 10. `edgeCatch(degree:0|1|2|3, freeHand:boolean): boolean` determines ordinary catch success. Use slice 9's check adapter for Reflex/Acrobatics; system rule text is recorded in the design's source investigation.
```ts
expect(edgeCatch(2,false)).toBe(false);
expect(edgeCatch(3,false)).toBe(true);
```
- [ ] Test reachable edge and free-hand requirements, success/critical success, declined/unavailable reaction and Arrest a Fall with fly Speed even without an embedded action item; run `npm test -- tests/node/movement/reactions.test.ts` red.
- [ ] Offer eligible reactions before descent; ask about ambiguous availability/handholds. Apply Grab an Edge's distance adjustment or critical-failure impact, stopping at the actual caught edge. Arrest a Fall suppresses damage on success while still descending; do not restore hovering. Preserve explicit choice of statistic and cancelled checks. Use GM adjudication for optional actor-specific reactions not mechanically supported.
- [ ] Rerun green/common checks; player catches an edge during a GM shove, declines a reaction, and successfully arrests a fall. Check only one owner rolls, reaction expenditure is confirmed where system tracking is absent, then run checkpoint 11.

### Slice 12: Hold F for forced dragging
Files: create `M/forced.ts`, `tests/node/movement/forced.test.ts`; modify `M/index.ts`, `src/hooks/init.ts`, `M/transitions.ts`. Depends on 11. `forcedIntent(held:boolean): MovementIntent` snapshots intent at submission; register the editable F binding and reset held state on blur/cancel. Use existing native ruler custom-label seam to show “Forced”, including localization in this slice if that adds a sixth small file.
```ts
expect(forcedIntent(true)).toEqual({kind:"forced",danger:"unknown"});
expect(forcedIntent(false)).toEqual({kind:"voluntary"});
```
- [ ] Test held/released/blur states, editable binding, intent retained after keyup and ordinary GM drag unchanged; run `npm test -- tests/node/movement/forced.test.ts` red.
- [ ] Attach intent to the drag submission before terrain/cost decisions and preserve it through rewritten moves. At a dangerous contact ask permission semantics once: push/pull or explicit danger permission allows it; forbidden stops safely. Bypass voluntary action cost and route detours for forced movement while preserving wall collision.
- [ ] Rerun green/common checks; hold F to push a token off the upper floor, release during the reaction dialog, and verify the lower-level fall. A forbidden Reposition remains at the last legal point and a flyer retains flight. Do not use native `displace` as the forced-movement flag.

### Slice 13: Expose forced movement to macros
Files: modify `src/api.ts`, `M/forced.ts`, `M/index.ts`, `tests/node/api.test.ts`, `README.md`. Depends on 12. Public API: `api.movement.forceMove({tokenUuid:string, waypoints:{x:number,y:number,elevation?:number,level?:string}[], danger:"allowed"|"forbidden"})`, returning the existing API result shape after native submission; the transition card tracks completion.
```ts
expect(await api.movement.forceMove({tokenUuid:"Actor.wrong",waypoints:[],danger:"allowed"}))
  .toMatchObject({ok:false,error:{code:"invalid-argument"}});
```
- [ ] Test invalid UUID/coordinates, non-GM caller and rules disabled; run `npm test -- tests/node/api.test.ts tests/node/movement/forced.test.ts` red.
- [ ] Reuse existing runtime argument/result conventions, restrict forcing other creatures to GM authority, bound waypoint count consistently with existing API collections, and dispatch through the same forced pipeline. The API does not infer shove direction or distance; the originating effect supplies its legal path.
- [ ] Rerun green/common checks and execute the documented macro against a disposable token. An API move and equivalent F drag must produce the same decision/landing outcome.

### Slice 14: Unify flight loss with falls
Files: modify `src/rulesets/sf2e/flying/fall.ts`, `flying/index.ts`, `src/hooks/ready.ts`, `M/transitions.ts`, `tests/node/flying/fall.test.ts` (the abbreviated flying path is under `src/rulesets/sf2e/`). Depends on 11. Keep pure fall/profile calculations in flying; change `activateFlying` to accept `requestFall: (tokenUuid:string) => Promise<void>`. The ready hook supplies movement's exported `requestFall`, preventing reverse imports.
```ts
expect(endsFlight([{action:"fly"}],{fly:{}})).toBe(false);
// Hook test: forced movement alone must not delete the Flying effect or start a fall.
expect(requestFall).not.toHaveBeenCalled();
```
- [ ] Add red tests for active flight over a gap, explicit landing, relevant grounding conditions, loss of fly support, effect removal and repeated actor hooks; run `npm test -- tests/node/flying tests/node/movement`.
- [ ] Replace immediate `fall()` relocation/chat-only hooks with the injected fall-request callback, keyed by token UUID. Export `requestFall(tokenUuid: string): Promise<void>` from movement's index and connect it in ready orchestration. Verify condition eligibility against system rules rather than treating the current `grabbed` slug list as authoritative. Detect deletion of the Flying effect through the same registered flight hooks. Support explicit altitude changes; clear flight only on actual landing/loss, and preserve current actor-linked token semantics with an explicit multi-token test.
- [ ] Rerun green/common checks; fly across the same hole that drops a grounded creature, then lose flight and resolve one reaction/fall. Verify the current level base is never selected as a synthetic landing.

### Slice 15: Water and conditional fall mitigation
Files: modify `src/canvas/regions/support.ts`, `M/landing.ts`, `M/damage.ts`, `tests/node/movement/landing.test.ts`, `tests/node/flying/fall.test.ts`. Depends on 14. `softLandingReduction(depth:number, diving:boolean): number` is capped by local depth; the landing model keeps surface and bed distinct.
```ts
expect(softLandingReduction(10,false)).toBe(10);
expect(softLandingReduction(50,true)).toBe(30);
```
- [ ] Add red tests for shallow water, dry bridge above water, missing local depth and existing mitigation with/without its prerequisites; run `npm test -- tests/node/movement/landing.test.ts tests/node/flying/fall.test.ts`.
- [ ] Apply ordinary water reduction using local geometry and intentional-dive choice; do not move every creature to the water surface as though it were solid floor. Preserve verified existing abilities; conditional or unsupported abilities invoke a GM ruling. Treat long falls, unusual gravity and landing on creatures as the spec's explicit exceptional cases before damage.
- [ ] Rerun green/common checks; resolve shallow/deep pools and a dry bridge with real system damage. Record the chosen supported water endpoint (surface/swimming versus bed) in the decision; ask when actor capability does not settle it.

### Slice 16: Confirm uncertain flight upkeep
Files: create `M/upkeep.ts`, `tests/node/movement/upkeep.test.ts`; modify `M/index.ts`, `M/decisions.ts`, `M/lang/en.json`. Depends on 14. `needsFlightConfirmation(airborne:boolean, flyUsed:boolean|null): boolean` requests a decision only for unknown upkeep; explicit missed use starts the fall flow.
```ts
expect(needsFlightConfirmation(true,null)).toBe(true);
expect(needsFlightConfirmation(true,true)).toBe(false);
```
- [ ] Add red tests for no movement, zero-distance hover confirmed by owner, actual Fly action, unrelated turn changes and no duplicate prompt; run `npm test -- tests/node/movement/upkeep.test.ts`.
- [ ] Register the system's end-turn event after verifying its signature in the installed PF2e/SF2e version; use authoritative action use where exposed, otherwise ask “Did you use Fly, including hovering?” through the decision flow. Movement distance alone is never proof of expenditure.
- [ ] Rerun green/common checks; end a flying player's turn after hovering and after confirmed missed Fly. Confirm the turn-start reminder remains independent and no inactive GM creates duplicate requests.

### Slice 17: Match previews and movement accounting
Files: modify `src/rulesets/sf2e/gridless/label.ts`, `routing.ts`, `floors.ts`, `tests/node/gridless/label.test.ts`, `tests/node/gridless/routing.test.ts` (three source paths under gridless). Depends on 9, 12, 15, 16. Consume the same contacts/intents as execution; retain native route search for ordinary horizontal walking.
```ts
// Keep the existing stair case while extending the same setup with stacked-floor fixtures.
const {chain,labels}=setup({floors:true});
expect(labels(chain([{x:0},{x:200}]))[1]?.elevation.total).toBe("+2.5");
```
- [ ] Add red tests for above-floor flight, forced straight path, a narrow gap, explicit jump/teleport, and an approved partial climb; run `npm test -- tests/node/gridless tests/node/movement tests/node/flying`.
- [ ] Preview only the safe prefix and decision point before an unresolved check. Do not show a guaranteed full climb/fall outcome before its choice. Pass explicit forced intent through cost calculation and preserve voluntary budget; charge only actual voluntary progress. Remove obsolete climb-setting/bypass consumers and unused floor rewrite exports as part of this cutover, retaining Squeeze and token placement.
- [ ] Rerun green/common checks and checkpoint 17. Include small accompanying updates to `src/rulesets/sf2e/gridless/lang/en.json`, README/CHANGELOG and `docs/testing/regions-movement.md` for retired settings and migration/modifier/API/DC/rule scope documentation. These are required documentation, not unrelated cleanup. Personally review every task diff and validate every spec acceptance case before requesting final independent review.

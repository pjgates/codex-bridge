# Regions and movement verification

Foundry **14.368**, **SF2e 1.5.1**, 2026-09-21. All scene mutations were restricted to the user-designated **Testing Scene**, using **Bob**. Early ownership tests used GM and Peter. At the user's direction, subsequent tests use only the built-in GM browser; the user owns the remaining player checks. PF2e runtime testing was explicitly waived.

The user approved test deployment. Both installed modules were backed up first at:
`/home/ubuntu/codex-test-backups/regions-movement-20260921/modules-before.tgz`.

## Automated verification

- Codex: **730 tests / 73 files pass**. All three TypeScript targets, lint and Foundry build pass. Lint has one pre-existing unused `clearance` warning.
- Workshop/importer: **229 tests pass**.
- Obsidian plugin compilation passes with its unrelated vault-copy plugin omitted; the normal aggregate `verify` command attempts that external vault copy.
- Independent Astra review: no remaining Critical or Important findings after corrections. Independent focused run: 63 tests / 22 files. Parent reviewed implementation, tests and importer diff personally.
- Regression coverage includes namespace/ID preservation, idempotent migration, disabled markers, nearest cross-level support, narrow contacts, coordinate rounding, native collision, stale/cancelled requests across awaited writes, feature-off guards, advisory no-write behavior, typed damage/IWR/temp HP, Quick Climb, held/released F, item-driven flight loss, water depth and upkeep deduplication.
- Removed tests described the retired unchecked floor rewriter (including free descents and 25 px corner clipping). The replacement evaluator has explicit contact, transition, preview and resolution coverage.

## Runtime evidence

- Canonical floor definitions persist after manifest reload. Visible names match the importer definitions.
- Native settings: ordered groups, search, unsaved parent dependencies, retained child preferences and independent Vault Sync action verified as GM.
- GM and Peter pause at x1349, y1000, elevation100000, upper level, before a 20 ft drop. GM cancellation reaches the initiating player and clears native pending movement.
- System Climb: failure grants 0 ft; Peter's success advances only 5 ft up a 20 ft face. Advisory does not apply progress.
- Ordinary cross-level fall: exactly one system damage card, 10 damage absorbed by temporary HP, HP 78 unchanged, Prone, completed at99980/lower.
- Full bludgeoning resistance: exactly one additional damage card, actual0, HP/temp unchanged, no Prone.
- Grab an Edge: system Reflex success/critical success stops at the upper edge with no damage. Final GM test verifies the owned Off-Guard condition.
- Arrest a Fall with a fly Speed and no embedded action item: system reaction succeeds, descends to lower floor, no damage/Prone, no restored Flying effect.
- Flight across the gap retains altitude. Removing Flying creates a stationary native pause, then one resolved fall. A second linked Bob token independently receives an unmapped-landing ruling.
- Forced API and registered F onDown/onUp callbacks retain forced intent after release, pause before the edge and use zero movement cost. Successful GM Grab an Edge resolves through the same request. Physical hold-and-drag remains a user check.
- Shallow water: local depth10, fall to surface10, zero damage; explicit bed endpoint.
- Final reviewed build: deep water depth40, intentional dive, surface endpoint, fall20, actual0, resolved. GM ordinary-fall confirmation exercised before application.

Additional GM verification:

- Migration: preview 2 / apply 2 / repeat 0; preserved behaviour IDs, name, flags and elevation. Foundry14 requires `ForcedReplacement` for the system payload during subtype changes. Canonical definitions persist with the importer disabled. Importer was restored afterward.
- Flight upkeep: a temporary Testing Scene encounter produced a turn-end prompt; hover resolved without falling; missed Fly produced the shared fall workflow. The temporary encounter was deleted.
- Exploration: with outside-combat Swim checks off, ordinary water movement completed at the same height with no pending path. The GM scene-session override then produced exactly one Swim decision. Calm-water resolution completed at x1750/y1000/elevation99990, no pending path, one resolved decision.

- Behaviour fields: native floor form saved Climb DC 18 and Grab an Edge DC 21; persisted system data confirmed both. Water form shows all condition presets and custom DC. Flowing-river preset requested system Swim at DC 15; a failed roll resolved with 0 ft progress and no queued movement. Calm-water resolution advanced 15 ft.
- Free Climb outside combat: with the override off, Bob moved from 100000 to 100020 on the authored higher floor, completed with no pending path or additional decision.

- Final reviewed build: forbidden forced movement stopped at x1349/100000 with no pending path. Ordinary movement still paused there with exploration checks disabled. Dry 20 ft fall then completed at 1351/99980, actual 10 absorbed by temporary HP, HP 78 unchanged, Prone, one resolved request.
- Native multi-checkpoint path: completed at 1150/100000 with final movement ID different from the issued ID and `chain` containing that root; no extra request or pending path.
- Cleanup restored saved Climbing=false, outcome=Advisory, flight upkeep=false, Swimming=true, both outside-combat check switches=true, importer=true. Removed test fly-Speed effect/Prone/tempHP, placed probe safely on upper floor, deleted 10 private follow-up messages and verified none selected remain.

- Final GM reload: session override cleared, importer active, zero today’s Testing Scene/Bob messages, probe completed/pending0, HP78/temp0, no Prone or temporary fly-Speed effect.

## Test chat incident

The extension runtime test exposed a continuation loop that generated over 1,031 test decision cards. The probe was stopped and today's Testing Scene/Bob messages were removed at the user's request; a separate audit verified zero remaining and no queued probe movement. Campaign chat was retained. A proposed world-wide rule disable was rejected by automatic approval review; it was not performed.

Confirmed defects: native Foundry continuations discard custom update options, receive new IDs, and preserve their ancestry in `chain`. The previous scheduler could replan those continuations and lose ownership of overlapping requests. Codex now tracks native ancestry, refuses unresolved or superseded continuations, stops late superseded responses, and accepts completed child segments only with matching state/position. Regression tests reproduce lost options and overlapping submissions. The event that initially triggered the historical loop remains unproven.

The reviewed fix was deployed and checked privately as GM: exactly one Swim request stayed paused, then resolved with no extra requests or growing remainder. Further test messages are GM-only and removed during cleanup.

## Remaining player checks (user-owned)

Reload Peter's client after deployment. Use only Testing Scene and Bob. Enable the desired movement switches; choose Apply after choices only for the consequence checks, then restore your preferred mode.

1. Physically hold F while dragging Bob toward the test edge. Confirm the ruler says Forced, release F while the request is open, and verify the chosen reaction/outcome still follows forced movement. Repeat after changing the binding and after cancelling a drag.
2. Start a move as Peter and cancel it from the GM request. Confirm Peter's token stops and no pending path remains. Move Bob elsewhere while an old request is open; the old request must not move or damage him.
3. Roll Climb and one fall reaction as Peter on the final build. Confirm only the resolved progress/consequence applies. For simultaneous owners, coordinate who rolls; outcome application is single-claim, but the system can display more than one requested roll.
4. Confirm a stationary Fly/hover at turn end, then test a missed Fly. The GM receives the fall workflow; hovering must not cause a fall.
5. Disable outside-combat Climb/Swim checks and verify ordinary travel; have the GM toggle Require terrain checks this scene session and confirm both checks return. Enter combat and confirm checks apply without the override.
6. Open module settings as Peter: world controls should respect Foundry permissions, and client options remain usable.

## Verification limits

The full standalone archive-import UI flow was not run: it creates scenes outside the user-designated Testing Scene. Provider conversion is covered by importer tests, and migration/persistence with the importer disabled was verified live. Upgrade preference combinations are covered by tests and the live settings workflow, rather than two separate disposable worlds. Remaining player checks above are user-owned; PF2e runtime was explicitly skipped.

## Fixtures and recovery

Test IDs start `codexTest`; upper/lower surfaces use elevations100000/99980. The shared macro is `Macro.eqW02Qtvt4Ml31gl`. The checked-in [pause probe](regions-pause-probe.js) uses explicit placement for fixture reset; a normal uphill update correctly triggers climbing now.

Recovery requests are not retried automatically. Inspect native position, conditions and the correlated system damage card before manually completing an interrupted outcome. Exceptional gravity, creature collisions, uncertain mitigation, unsupported climb abilities and unmapped landings require a GM ruling. Use explicit Displace/placement for adjudicated relocation.

## Travelling follow-up (2026-09-21)

Fidget’s live route exposed a higher-floor lookup defect across native levels. The resolver now treats an unambiguous higher floor on another level as a climb when no support at/below is present; forced ascent still requires a ruling. Red/green regression and GM Testing Scene verification passed: −7.5ft → +2.5ft selected Climb, then completed on the upper level using Climb Speed20.

Grab an Edge and Arrest a Fall selectors now default to the stronger eligible prepared statistic, including native action/check-type/trait roll options, and show each bonus. GM verification showed Acrobatics+44 selected over Reflex+18; the choice remains editable. Independent review passed16 focused tests; full suite714 passed.

Fidget also crosses a thin unmapped geometry strip, and Climb automation was disabled. The user approved ground-first Travelling and will repair the geometry themselves. Climbing is now enabled; no general small-gap bypass or cavern geometry edit was introduced.

Adaptive Travelling uses prepared speeds in Apply mode: ordinary Climb presets through Expert, calm/flowing Swim, then flight where necessary. Custom/unspecified/hazardous terrain keeps the existing decision workflow. Red/green tests cover explicit and forced actions, real gaps, ground/water action boundaries, surface takeoff versus submerged swimming, and asynchronous takeoff/landing effect writes. Independent review cleared the slice with36 focused tests. GM runtime: walk→climb→walk crossed −7.5ft to +2.5ft on native levels, completed with zero chat. Flight into the authored gap completed at −7.5ft with Flying active and the Travelling selector retained.


Final adaptive GM verification also passed: flight at an unsupported gap retained Travelling; returning to ground produced fly→walk and removed Flying; entering ordinary water produced walk→swim with no Flying effect. The final full suite passed with two workers. A preceding run during severe host contention exceeded an unchanged unrelated clearance timing assertion (198ms versus150ms); no test threshold was changed. Runtime typecheck, lint and build pass, with the existing unused `clearance` warning only.

Cleanup verified: three fixture regions restored, Bob1050/1000/100000 on the test upper level, completed/pending0, temporary effects0, one private test message removed. GM returned to Mining Site -- Depths, Climbing=true and Apply retained. Fidget geometry unchanged.

## Climbing and Swimming statuses (2026-09-21)

Added visible token effects and GM Toggle Climbing/Toggle Swimming macros. Automatic transitions require the respective feature and Apply mode. Incomplete climbs retain their status even with Climb Speed; the movement state and Off-Guard penalty are separate. Native in-memory Off-Guard preserves other condition sources. Prepared Speeds are sampled after native preparation and refreshed on actor/item updates and GM/canvas load: speed predicates alone run too early in the in-memory grant phase. Combat Climber uses the native `feat:combat-climber` option; Underwater Marauder uses `aquatic-combat:not-off-guard`. Existing effects migrate to the corrected predicate through `terrainStatusVersion`.

GM Testing Scene verification on Bob:
- No Climb Speed: Climbing icon active, Off-Guard true.
- Gain Climb20/Swim20: status retained, Off-Guard false for each.
- Lose Swim Speed: Swimming retained, Off-Guard restored.
- Underwater Marauder and Combat Climber: status retained, Off-Guard false. Combat Climber also passed after reload/refresh of the earlier test effect.
- Native partial Climb at100005: Climbing active; water entry99990: Swimming active, Climbing cleared; dry upper floor100000: both cleared.
- Both custom SVG icons render in Foundry and macro sidebar.
- Cleanup: Bob1050/1000/100000 upper, completed, test items0, status items0, new Bob messages0; water restored disabled; GM returned to Mining Site -- Depths.

730 tests /73 files pass, runtime types/build/lint pass (existing clearance warning). Independent review passed26 focused tests and cleared the speed preparation/order fixes and Quick Swim cap. Remaining player tests remain user-owned. No PF2e runtime was added, as requested. Swim status applies the scoped Off-Guard rule, not the entire Aquatic Combat package.


## Movement cards and ruler UX (2026-09-22)

Approved layout: compact explanation and primary choice, secondary GM controls, with the original card updated to its resolved outcome. Grab an Edge/Arrest a Fall buttons and reaction previews use the native Pathfinder2eActions `R` glyph with an accessible Reaction label. Internal responses remain persisted for authority validation but are whispered to the responder/active GM and hidden from the chat UI; native rolls remain visible.

Ruler labels now apply on gridless, square and hex scenes while Custom Rules is enabled. They distinguish climbs, water, falls and unknown landings, and draw a display-only amber pause marker at the planned safe point. Budgets use the relevant prepared Speed, contiguous movement modes, native terrain costs and turn history; uncertain check progress is an estimate. Budgets count movement actions, not other actions spent on the sheet. No movement execution rules were changed in this slice.

Verification:
- 742 tests /76 files pass; runtime typecheck and build pass. Lint has only the existing unused `clearance` warning.
- Independent review identified and verified fixes for history counted twice, missing regenerated terrain, square diagonal parity, preview-only geometry, marker visibility, prepared-Speed feat exemptions and observer Speed visibility.
- Native SF2e retained core's generic 2× Climb/Crawl multiplier. Display measurement now removes that multiplier when using actual Climb/Crawl allowances, retaining native terrain/clearance and other action costs. Recorded Climb/Crawl terrain is repriced for display without changing movement execution.
- Live GM Testing Scene: actual paused Climb and Fall cards displayed correct DC choices; Stop here updated the original card. The reaction glyph's computed font was Pathfinder2eActions. Hidden receipts were absent from the visible log.
- Native ruler rendering exercised fully measured planned paths (same terrain/measurement data shape as native dragging). Screenshot verified the exact pause marker, fall explanation and reaction glyph. This was GM-side rendering, not a player drag test.
- For a 5ft path, all three live grid types showed one action and remaining walk20 / climb5 / crawl0 / swim15 / fly35, using prepared Speeds25 /10 /5 /20 /40. Temporary Speeds were removed afterward.
- Cleanup verified grid0, Bob1050/1000/100000 on codexTestUpper01, completed/pending0, temporary effects0, Climb fixture restored disabled, and four test messages removed. Original region data was restored. Cavern geometry was unchanged.

Player gesture/ownership checks remain user-owned; PF2e runtime remains waived. Test evidence snapshots are on the Testing Scene probe macro under uxGrid0/1/2, with uxBackup/uxGridBackup restoration data.

### Compact tooltip follow-up

Foundry's flex row combined with PF2e's 55% label scale made the extended preview wide and reduced secondary text to about 7px. The Codex label now uses explicit wrapping rows, a 240px width cap and 14px text with canvas zoom compensation. Repeated prose is replaced by short hints; longer budget qualifications remain in the accessible label.

Live GM Testing Scene rendering verified the fall preview at zoom 1 and 0.5: width stayed about 220px (previously 344px), with no overflow. Ordinary movement rendered at 122px wide with distance, action cost, mode and remaining movement. Both were visually inspected. Display-only probes moved no tokens and created no chat messages. All 742 tests pass; runtime typecheck/build pass, and lint retains only the existing clearance warning.

### Approved action-glyph layout

Implemented the iterated HTML design: movement types first with right-aligned PF2e glyphs, `Climb*`/`Swim*` estimates, distance with remaining allowance in parentheses, elevation and a separate amber warning. Width is 160–240px. Ordered mixed-mode distances exclude turn history and terrain surcharges; a paused mixed breakdown ends at the first transition. History still contributes to the action budget. The final mixed-route surcharge calculation removes the native generic Climb/Crawl multiplier while retaining authored terrain costs.

Verification: 744 tests /76 files, runtime typecheck and build pass; lint retains the existing clearance warning. New regressions cover repeated movement modes, history exclusion, native multiplier removal and estimated transition labels. Live GM Testing Scene native ruler rendering showed `Walk → Climb* → Walk` with `5 ft + 10 ft + 5 ft`, right-aligned glyphs and no false final surcharge (238px). Bob has no Climb Speed, so the four-action estimate uses the three-action glyph plus `+`. Fall rendering retained the reaction glyph and pause warning; the forced keybinding callback produced `Forced —` and the effect-type warning. Ordinary movement at half zoom stayed 160px wide with 14px text. No tested label overflowed. These were display-only probes: no token moves, actor edits or chat messages. Forced mode was released, the ruler cleared and the GM view restored to Mining Site -- Depths upper.

The initial mixed-mode probe assigned Climb to a horizontal loop to verify segment formatting; it did not demonstrate a height change. After user feedback, a real +20ft floor transition with the expert DC20 preset was previewed in Testing Scene. It rendered `Walk → Climb*`, `14.95 ft + 20 ft`, and `↑ 20 ft · DC 20 · Check`. The 14.95ft is the safe approach before the ledge. The test region's original disabled/system fields were saved on the probe macro as glyphClimbBackup and restored afterward. The user selected one final tooltip. Intermediate label contexts are now suppressed while Custom Rules is enabled; native waypoint markers remain.

The single-tooltip follow-up was deployed and checked on the same real +20ft/DC20 climb with an intermediate planned waypoint: exactly one `.codex-waypoint` rendered, with the correct approach/climb distances and height warning. Fixture data was restored and the display cleared. The full 744-test suite, runtime typecheck, build and diff checks pass; lint has only the existing clearance warning.


### Check outcomes, exploration notices and Swim upkeep (2026-09-22)

Implemented optional unchecked Climb/Swim notices, continuation of partial climbs through Travelling, explicit vertical progress on resolved checks, wall-aware GM manual movement, protection-aware Swim critical-failure reminders and GM turn-end sinking/current choices. Breath tracking remains manual by user choice. Ordinary Climb failure makes no progress; only critical failure falls.

Verification: 756 tests /81 files pass; runtime typecheck/build pass and lint retains only the existing unused clearance warning. Regressions cover success versus failure/critical failure, manual collision options and GM authority, notice deduplication/toggle, environmental protection and upkeep success/stale guards.

Live SF2e GM tests in Testing Scene:
- Travelling from a partial climb offered Climb instead of a generic ruling. A native critical success moved Bob from elevation100010 to100020 and completed the climb.
- Native Climb critical failure at100010 created a10ft fall with the authored Grab an Edge DC. Declining the reaction landed at100000, dealt5 damage and applied Prone.
- Resolve manually stopped at a closed test door; after opening it, a new request reached the intended upper destination.
- Unchecked Climb and Swim each emitted one compact notice; disabling the notice setting emitted no additional message.
- An active environmental-protection effect prevented the air-loss reminder on a native Swim critical failure.
- GM sinking moved10ft to the mapped bed; a specified eastward current moved10ft.
- A native successful Swim moved5ft and recorded success for round3. Advancing the real encounter to round4 produced no upkeep prompt. The following turn without a success produced one; No consequence resolved it.

Cleanup verified:27 test messages removed, disposable combat and door removed, original region data/settings restored, Bob1050/1000/100000 upper with78HP/0temporaryHP, completed/pending0 and no temporary test items. Returned GM view to Mining Site -- Depths upper. Evidence is persisted on the probe macro in continuationProof, fallFollowupProof, manualBlockedProof, manualArrivalProof, noticeToggleProof, swimNoticeProof, sinkProof, currentProof, swimSuccessProof and followupCleanupProof. Player testing stays user-owned; PF2e runtime remains waived.


### Default ledge descent (2026-09-22)

Walking/Travelling into a mapped drop greater than5ft now chooses Climb down, using the upper ledge’s DC in both preview and check resolution. Partial descents retain that upper-wall context. Exactly5ft, forced movement, deliberate falls and unknown landings retain their prior handling. Existing exploration-check settings and special Speeds still apply.

Baseline88 movement tests passed; new regressions failed before implementation. Final760 tests/82files, runtime typecheck, build and diff check pass; lint retains the existing clearance warning. Tests cover the strict threshold, cross-level/declared descents, upper-wall DC, partial continuation, unchecked exploration and forced/unknown exceptions.

Live GM Testing Scene: unchecked descent completed with one compact notice. With checks temporarily enabled, a20ft descent offered Climb down with the upper fixture’s DC0. Two actual native critical successes moved10ft each: first x1349/elevation99990 with Climbing, then x1351/elevation99980 on codexTestLower01 with Climbing cleared. The second Travelling attempt offered the remaining10ft at the same upper DC. Saved evidence: probe macro descentProof.

Cleanup verified:7 test messages removed; original region data restored; Bob returned to x1050/elevation100000, completed/pending0; original settings restored (climbOutsideCombat=false, enableClimbing=true, outcomes=apply). GM view returned to Mining Site -- Depths upper. No cavern geometry changes.


### Unchecked exploration distances (2026-09-22)

Preserve Climb/Swim segment actions when checks are waived, including ordinary Walk intent, water crossed between dry endpoints, vertical climbs and vertical swimming. Unchecked ledge paths separate the approach, vertical climb and departure. The same native path measurement supplies tooltip distances and completed Climb/Swim chat totals. Repeated movement callbacks are deduplicated while continuation legs accumulate. The user selected hiding action icons and remaining-movement budgets for unchecked exploration; estimate markers are also omitted.

Regression evidence:106 baseline movement/label tests passed; new route/notice tests failed before implementation. The corrected tooltip test failed with budget hiding removed, then passed after restoration. Final764 tests/83files, runtime types/build and diff check pass; lint retains only the existing clearance warning.

Live GM Testing Scene: native ruler rendering showed Walk → Climb → Walk,7.45ft +20ft +5.05ft, elevation+20; unchecked Swim showed10ft. Both were visually inspected with no action glyph, remaining budget or estimate marker. Actual native Walk-intent moves completed and posted exactly one notice each: Codex pause probe climbs20ft / swims10ft. The climb reached100020; Swim moved1500→1700 at99990. Saved evidence on probe macro distanceProof.

Cleanup verified:2 task notices deleted, original region behaviours and three settings restored, Bob1050/100000 completed/pending0, GM returned to Mining Site -- Depths upper. No cavern geometry edits. Final build497.47kB includes an additional tested explicit vertical Climb mode correction.

### Surface geometry follow-up (2026-09-22)

Climb decisions now require an authored exposed face. Solid/reaching slabs retain Climb; thin decks produce an unsupported descent or an ascent ruling, including unchecked exploration and Climb Speed. Partial checks retain their owning face and reject changed landing/route geometry before applying movement. See [geometry, native visibility and artwork evidence](surface-visibility.md) for the runtime cases,792-test verification and remaining standalone/player checks.

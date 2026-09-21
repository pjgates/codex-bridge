# Natural dressing with FA Nexus and Jev

Status: proposed written design for user review. The user approved natural dressing, an in-Foundry workflow, and a personal Jev key held on the Foundry server and configured through Foundry settings. This document does not authorize deployment or replace the separate regions/movement work.

## Outcome

A GM selects part of a scene, describes its natural dressing, previews a proposed arrangement of accessible Forgotten Adventures assets, and accepts or discards it. Initial subjects are rocks, fungi, bones and rubble. Accepted props are ordinary editable Foundry tiles. The entire creative workflow stays in Foundry.

The first usable version provides select area → describe → preview → regenerate → accept → undo last batch. Furniture, camps, buildings, terrain texture painting and automatic map generation are outside this version. Natural dressing is the first milestone, not a restriction on later use cases.

## Evidence and constraints

- A live throwaway macro was verified in Testing Scene on Foundry 14.368 and FA Nexus 0.5.3. Nexus supplied names, grid dimensions, availability checks and resolved asset paths. Four mushroom assets rendered in a selected rectangle; closing cleared them; serialized scene data was unchanged.
- The Assets view contained 161,173 records; the combined catalog had 167,687 records. The mushroom search had 2,164 accessible matches. Premium-only remote resolution remains unverified.
- Nexus's catalog, lock-check and placement resolver methods used by the proof are internal interfaces. Contain that dependency in one adapter and verify compatibility when Nexus changes.
- TypeSafe's public endpoint rejected a credential-free preflight from the Foundry domain with `Disallowed CORS origin`. A same-origin server helper will make the upstream requests.
- The Foundry host currently runs Caddy, proxying to localhost:30000. A dedicated helper route can share its HTTPS origin without exposing another public port.
- Ordinary world settings replicate to connected clients. The existing sync passphrase deliberately uses client storage for that reason. Neither an ordinary world setting nor a masked field is suitable secret storage.
- Region definitions and surface resolution have a separate approved design in this repository. Consume their feature interface once available; do not implement another elevation model inside the decorator or modify movement behavior.

## Interaction

Add a GM-only **Decorate area** control to the Tiles tools, independent of the house-rules master switch. Require FA Nexus to be active; explain an unsupported Nexus version before making changes.

The GM selects a floor Region or draws a rectangle. A Region preserves its actual shape and holes. Bind the operation to the current scene and selected native Scene Level. For a known floor, obtain its elevation from shared surface resolution. A manually selected rectangle on an unmapped scene requires an explicit placement elevation; a level's display base is not evidence of a physical floor.

The panel accepts a description such as “Sparse brown fungi and scattered bones near the cave edges; leave the middle open,” plus a modest prop-count control. Show the selected area and count throughout preview. A preview is visible only to that GM. **Regenerate** replaces the preview, **Accept** commits it, and **Cancel** removes it. Closing, changing scenes or changing levels cancels the pending work and makes late model/download results ineligible to update the canvas.

The first version regenerates a whole proposed batch; individual props remain manually editable after acceptance. Do not add per-prop AI editing, saved styles or a second asset browser in this slice.

## Asset selection and placement

Use Nexus's configured local/cloud sources and access checks. Nexus owns entitlement, signed asset URLs, downloads and cache paths. Do not copy its authentication data, bypass locks, or submit asset URLs to Jev. Before preview, resolve and load each selected image through Nexus. A failed image resolution prevents acceptance of that incomplete proposal and offers a retry.

Jev chooses among supplied candidates; it does not generate filenames, image data or arbitrary coordinates. Narrow the catalog through its folder hierarchy: ask Jev to rank relevant natural-dressing branches, then rank assets within those branches. Include names, category paths and dimensions, group color/shape variants where possible, and include a skip/no-fit option. A Choice has at most 255 options; keep every stage within that limit. Do not rely on literal keyword overlap alone for descriptions such as “recent rockfall.”

Geometry code constructs valid candidate positions and tags them with available context, such as edge/interior, nearby water and existing props. Jev can select among those candidates based on the description. Build a batch incrementally so later choices see earlier placements. Bound the number of calls by the requested prop count; do not run an autonomous model loop.

Preserve asset grid scale and aspect ratio. Reject candidate footprints that cross the selected boundary, a hole, a wall or a floor-height boundary. Exclude existing prop footprints on the same surface; background/terrace/height-overlay tiles are not props. Treat stairs, ledges, doors and narrow passages as reserved space rather than filling every available point. Use existing scene geometry where available; disclose that a flat image without wall/floor data cannot provide these guarantees. The initial placement implementation must specify and test its conservative footprint and clearance rules before claiming passage preservation.

Keep Jev's semantic judgments separate from geometric eligibility. A high-confidence model answer cannot override a failed placement check. When space is insufficient, preview fewer objects and state the count rather than shrinking the assets or weakening clearance. A deterministic seed makes a given candidate arrangement reproducible for tests.

## Acceptance and undo

Preview and commit share the same tile placement data, including Foundry v14 anchor coordinates, scale, rotation, elevation and native level membership. Recheck scene/level identity, relevant geometry and candidate occupancy at acceptance. If the proposal is stale, require a new preview.

Create the batch through Foundry's document API, with a decorator batch flag and the returned document IDs recorded for undo. Integrate Nexus's compatible tile metadata without copying its whole placement UI. Verify the committed tiles against the preview in Foundry, including level switching.

**Undo last batch** removes only the tiles created by that batch. It never rewrites a whole scene snapshot or touches pre-existing tiles. If any batch tile has subsequently been edited, make the affected count explicit before removing the batch. Undo history is session-local in this first version. Failed or partial creation must report the actual created IDs and permit cleanup of that subset; it must not claim atomicity that Foundry does not guarantee.

## Server helper and key settings

Run a small Node service on loopback on the Foundry host. Caddy routes a dedicated path, proposed `/codex-dressing/`, to it while keeping all existing Foundry traffic on its current route. The helper has a fixed TypeSafe upstream and exposes only configuration status, replace/clear key, test connection, and bounded dressing evaluations. It is not a generic URL proxy, file browser or code executor.

The restricted **Jev connection** settings menu provides a password input, **Save key**, **Test connection**, **Remove key**, and configured/not-configured status. A blank password field preserves the existing key. Never return a saved key to the browser. The normal settings database stores no key, no model credential and no helper administrator secret.

Store the Jev key in an owner-readable server file outside Foundry's `Data`, application and static directories. Use a dedicated service account, a private directory, mode 0600 for the file and atomic replacement. Keep it out of source control, client bundles, diagnostics, URLs, scene exports and request logs. The helper attaches it only to the fixed TypeSafe HTTPS request. Backups of the helper's private directory must be treated as containing secrets.

### Proposed authentication choice

Use independent helper pairing rather than reading Foundry's private session store or trusting a browser-supplied `isGM` value. The settings menu remains GM-only, while the helper independently requires its own administrator session for both configuration and paid model requests.

During server setup, generate a single-use expiring pairing code, delivered privately to the operator. The GM enters it once in the settings menu. On successful redemption, issue an opaque `Secure`, `HttpOnly`, `SameSite=Strict` session cookie scoped to the helper route. Retain only a digest of session tokens server-side with an expiry. A server command can revoke sessions and create a replacement pairing code. Pairing requests are rate-limited and codes are never world settings.

Validate the exact Foundry Origin for state-changing requests, require JSON/custom request headers, reject unauthenticated requests, and bound request sizes, candidate counts and concurrent evaluations. CORS or a hidden menu alone is not authentication. The pairing grants helper access independently of Foundry roles, so revoking a user's GM role does not automatically revoke their helper session; administrative revocation must be explicit. A second browser pairs separately.

The one-time pairing step is an addition proposed here for review. It avoids a fragile dependency on an undocumented server-side Foundry session-verification interface. No helper, pairing credential or proxy route has been installed yet.

## Jev request contract

Send the GM's description, relevant candidate names/category metadata, dimensions and abstract placement facts. Keep artwork, download links, FA credentials, chat, journals and unrelated scene data out of requests. Local candidate IDs map returned choices to the exact offered records; reject unknown IDs and malformed/missing answers at this external boundary.

Use the documented TypeSafe evaluation endpoint and an explicitly configured model identifier. Handle timeout, cancellation, unavailable quota and authorization failure as visible errors while preserving the current scene. Do not silently substitute random output or another AI provider. Show operation progress and request usage without putting credentials in logs. No calls occur merely by opening the settings or decorating panel; a connection test is an explicit action and may make a small billable evaluation.

## Dependency-ordered delivery slices

These are proposed PR-sized concerns, not an approved implementation plan. Target roughly 200 changed lines per slice; split further before any slice exceeds 400.

1. **Nexus adapter:** normalize natural asset metadata, apply availability checks and resolve selected images; preserve the working prototype as evidence.
2. **Helper authentication:** loopback service, pairing and session/Origin enforcement, with no model key or model calls yet.
3. **Private key storage:** protected persistence and configured/replace/remove endpoints behind helper authentication.
4. **Foundry connection settings:** pair, configure and test the helper through the GM settings menu.
5. **Bounded Jev client:** fixed upstream, validated request/response contract, cancellation and a live minimal connection test.
6. **Natural asset retrieval:** category/variant selection over the accessible Nexus catalog, evaluated against representative prompts.
7. **Area and placement geometry:** Region/rectangle scope, surface context, conservative footprints, exclusions and deterministic candidates; depends on shared surface resolution for mapped multi-height scenes.
8. **Decoration preview:** description/count controls, incremental Jev selections, native asset rendering, regeneration and cancellation.
9. **Accept and undo:** level-correct tile batches, stale-preview rejection and scoped undo.
10. **Host integration and acceptance:** review the concrete service/Caddy diff, deploy within authorization, test GM/player boundaries and natural dressing in Testing Scene, then replace the throwaway macro.

## Verification

- Unit tests cover adapter contracts, missing/locked assets, containment with holes, oversized props, overlap, surface boundaries and stale proposals. Use meaningful red/green tests for new behavior.
- Helper integration tests cover unpaired/expired access, wrong Origin, key status without disclosure, invalid upstream answers and upstream failure without repeated paid retries.
- A player client cannot configure the helper, obtain its key or make an unauthenticated paid request. A denied request must be rejected server-side, not only hidden in the UI.
- Foundry verification compares preview and committed placements, checks correct native level/elevation, confirms cancel leaves documents unchanged, and proves undo preserves an unrelated tile created between accept and undo.
- Test at least “sparse brown fungi near edges,” “rockfall and rubble with an open central route,” and “a few scattered bones.” Compare thematic choices with the search/random prototype; report observed quality rather than claiming model confidence proves quality.
- Verify an accessible premium remote asset after the user's Nexus authentication is available; never infer premium success from the free-asset proof.
- Run relevant unit tests, typecheck, lint and builds for executable changes, followed by the repository's full verification once implementation is complete. No product tests are needed for this design-only change.

## Sources

- [FA Nexus source](https://github.com/Forgotten-Adventures/FA-Nexus), inspected alongside the live 0.5.3 installation.
- [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice) and [API contract](https://docs.typesafe.ai/api).
- [Foundry v14 developer API and public/private API guidance](https://foundryvtt.com/api/).
- Existing `src/sync/settings.ts` documents why the sync passphrase is not stored as a world setting.

Next gate: user reviews this written design, particularly the one-time helper pairing. After design approval, produce the detailed implementation plan and select execution as required by the brainstorming workflow.

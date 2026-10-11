# PF2e Combat Notebook Chrome Extension Design

## Summary

PF2e Combat Notebook is a player-installed Chrome extension for Foundry VTT. It observes information available inside the player's authenticated browser session and builds an encounter-local creature notebook. It estimates defenses and durability, records observed capabilities, and distinguishes exact client data from observations and inferences.

The extension requires no Foundry module, GM installation, server change, or world-document update. Its interface consists of a compact PixiJS overlay above the currently targeted token and an extension-owned HTML sidebar containing full records and evidence.

## Goals

- Work as a Manifest V3 Chrome extension with player-only installation.
- Support Chromium, Foundry VTT 14, and PF2e 8.5 in the first release.
- Read structured Foundry/PF2e runtime events when available.
- Fall back to parsing rendered chat when a structured event is unavailable.
- Maintain separate encounter-local records for individual tokens.
- Report AC, saves, HP, mitigation, and observed abilities with explicit provenance.
- Remain read-only and local to the player's browser.
- Fail without interrupting Foundry gameplay.

## Non-goals

- Installing or enabling a Foundry module.
- Changing actors, tokens, chat messages, settings, or other world documents.
- Requesting documents or data that the server has not delivered to the authenticated client.
- Persisting a campaign-wide bestiary.
- Cloud synchronization or telemetry.
- Supporting Firefox or Foundry/PF2e versions outside the initial compatibility target.
- Claiming certainty when multiple PF2e mechanics can explain an observation.

## Product boundaries

The extension may inspect Foundry objects already instantiated in the page, including values that the client received but the Foundry interface does not display. It must not call server APIs to retrieve additional restricted documents, fabricate permissions, or alter the current user's access.

All stored values must include one of these provenance levels:

- **Exact client data:** a value present in an in-memory client document or structured event.
- **Observed:** a value explicitly shown or used during play.
- **Inferred:** a bounded conclusion calculated from one or more observations.
- **Possible:** a hypothesis for which multiple explanations remain.

An exact value is a timestamped snapshot, not a guarantee that a later context has the same value.

## Architecture

The extension lives in a new top-level `extension/` package so it remains separate from the existing Foundry module build.

```text
Foundry/PF2e runtime                 Rendered chat DOM
        |                                    |
        v                                    v
Main-world adapter -----> Pixi overlay   DOM fallback
        |                                    |
  validated event bridge                     |
        |                                    |
        +---------------+--------------------+
                        v
              Isolated content script
                  |             |
                  v             v
              Inference       Shadow DOM
              engine          sidebar
                  |
                  v
             MV3 service worker
                  |
                  v
             Session storage
```

### Main-world adapter

Chrome's isolated content-script world cannot directly use Foundry's runtime objects. A small adapter therefore runs in the page's `MAIN` world and:

- Detects Foundry generation, system ID, and PF2e version.
- Initializes immediately when the game is ready or waits for Foundry's ready lifecycle when injected earlier.
- Registers only the supported Foundry hooks.
- Reads already-instantiated messages, actors, tokens, combatants, and target state.
- Converts runtime objects into plain, serializable observation events.
- Emits a bootstrap snapshot so installation or reload does not depend on having observed earlier hooks.
- Owns the PixiJS overlay and accepts only a constrained overlay view model.
- Detaches hooks and destroys Pixi objects when disabled or when the canvas changes.

The adapter contains no extension API calls, storage, inference logic, or network access.

### Event bridge

The main-world adapter and isolated content script exchange versioned, schema-validated messages through a page event bridge. Messages contain plain data rather than Foundry objects or HTML nodes.

Every observation includes:

- Protocol version.
- Unique event ID.
- Foundry and PF2e versions.
- World, scene, combat, message, actor, and token identifiers when available.
- Event timestamp.
- Event type and type-specific payload.

The bridge exposes no general-purpose method invocation. Commands from the content script are limited to overlay updates, overlay removal, and adapter teardown.

### Content script

The isolated content script:

- Validates and deduplicates observations.
- Runs the pure inference engine.
- Injects the sidebar into a Shadow DOM root.
- Sends compact overlay view models to the page adapter.
- Runs a MutationObserver fallback for supported rendered chat cards.

### Service worker

The Manifest V3 service worker:

- Handles the player's explicit enable or disable action for the current Foundry origin.
- Dynamically registers the isolated content script and main-world adapter for the authorized origin.
- Persists and restores serializable notebook snapshots through `chrome.storage.session`.
- Requests adapter teardown, unregisters both scripts, and removes current-session data when the player revokes the origin.

It does not inspect Foundry data, perform inference, or make network requests. The content script retains live state while the tab is open and checkpoints it after state changes so service-worker suspension is harmless.

### Permissions

The extension requests `scripting` and `storage`, plus optional HTTP/HTTPS host access. A toolbar action lets the player enable the current Foundry origin through a user-initiated Chrome permission prompt. It does not require access to every site at installation time.

## Compatibility modes

The sidebar always displays one of three states:

- **Active:** the Foundry/PF2e adapter version is supported and structured capture is running.
- **Fallback:** only supported DOM observations are being captured.
- **Unsupported:** capture is disabled because the page or data version is unknown.

Unknown structured data must not be interpreted optimistically. An adapter handshake must complete before runtime capture starts. DOM selectors and structured extractors are versioned independently.

## Encounter identity and lifecycle

Records use scene and token identity as the primary creature key. Actor identity is supporting metadata only, because multiple tokens may share an actor while having different current state.

When combat is active, the current notebook scope is keyed by world, user, and combat ID. Outside combat, it is keyed by world, user, scene, and browser-session scope. Entering a new combat opens a new empty scope. The user can clear the current scope manually.

`chrome.storage.session` preserves the current scope through page reloads and service-worker suspension but clears it when the browser session ends. The extension does not retain a campaign history.

## Observation model

Initial observation types are:

- Runtime snapshot of a token and its actor.
- Target selected or cleared.
- Chat message created or updated.
- Check or attack roll with total, die result, degree, modifiers, and target.
- Damage or healing roll.
- Applied damage, healing, temporary HP, or current HP change.
- Public health-description transition.
- Actor or token update.
- Combat and scene lifecycle event.
- Item, action, reaction, spell, aura, or strike observed in use.

Events without a reliable creature association remain in a short diagnostic queue for the current scope and do not affect creature estimates.

## Fact and evidence model

Each creature record contains:

- Display identity and token metadata.
- Defense facts: AC, Fortitude, Reflex, Will, and Perception.
- Durability facts: current HP, maximum HP, temporary HP, and health description.
- Mitigation facts: weaknesses, resistances, immunities, regeneration, and recovery behavior.
- Capability facts: attacks, actions, reactions, spells, auras, and traits observed in use.
- Append-only evidence entries.
- Contradictions and discarded duplicate IDs.

A fact contains:

- Kind and optional context key.
- Exact value, interval, set of candidates, or text.
- Provenance.
- Confidence and explanation.
- IDs of supporting and contradicting evidence.
- First- and last-observed timestamps.

Exact facts cannot be overwritten by inferred facts. New contradictory evidence either creates a context-specific fact, widens or splits an inferred candidate set, or marks the fact disputed.

## Defense inference

For a roll total `T` against defense `D`, the unadjusted PF2e degree gives these integer ranges:

| Base degree | Defense range |
|---|---|
| Critical success | `D <= T - 10` |
| Success | `T - 9 <= D <= T` |
| Failure | `T + 1 <= D <= T + 9` |
| Critical failure | `D >= T + 10` |

The engine reverses a natural 20's one-step increase or a natural 1's one-step decrease before deriving candidates. Where clamping permits more than one base degree, it takes the union of all valid ranges. Known degree adjustments from PF2e message context are reversed as well. Unknown adjustments mark the result as possible rather than inferred.

Each new compatible observation intersects the existing candidate set. An empty intersection does not force a value: it creates a contradiction for contextual analysis.

Defense observations are context-sensitive. Target-visible effects such as off-guard, cover, raised shields, and explicit bonuses or penalties are stored with a context fingerprint. The UI reports the effective defense for that context and promotes a baseline estimate only when the evidence supports one. Targetless rolls do not update a creature defense.

## HP and health inference

An exact current or maximum HP value already present in an instantiated client document is recorded as exact client data. Otherwise:

- Structured applied-damage and healing events update the known net change.
- Damage-roll totals alone do not count as applied damage.
- Public health descriptions map through a versioned PF2e threshold table to percentage intervals.
- A transition between percentage intervals, combined with reliable net applied changes, constrains candidate maximum HP.
- Unobserved changes, temporary HP, Shield Block, resistance, weakness, immunity, and manual GM edits widen or invalidate the affected inference.

The engine may display a broad interval or only the public health description. It must not manufacture a precise HP value from insufficient evidence.

## Weakness, resistance, immunity, and regeneration

Exact values present in client runtime data are recorded as exact snapshots. Otherwise:

- Explicit PF2e adjustment messages are observations.
- A difference between raw and applied damage creates a possible mitigation hypothesis only when other explanations remain.
- Repeated type-specific evidence can strengthen a hypothesis.
- Immunity requires an explicit message or repeated zero-application evidence with no competing explanation.
- Regeneration is observed from explicit regeneration events or repeated typed healing behavior.

The evidence view explains alternative causes such as hardness, Shield Block, temporary HP, save degree, or manual adjustment.

## Observed capabilities

The notebook records an action, strike, reaction, spell, aura, or trait when it appears in a structured message, runtime event, or supported chat card. Each entry retains its source message and observed parameters.

The extension does not infer an exhaustive stat block from a partial action list. Runtime-exposed item data is labeled exact client data; chat-only entries are labeled observed.

## Interface

### Calm canvas overlay

Only the currently targeted token receives an overlay. It contains:

- Creature name.
- Best supported AC value or range.
- Current public or inferred health summary.

The overlay uses a non-interactive `PIXI.Container` attached to Foundry's interface layer. It follows token movement, pans, zooms, scene changes, target changes, and canvas reconstruction. Text counter-scales to remain readable. The adapter removes the container and all children during teardown.

The overlay deliberately omits saves, mitigation, abilities, and evidence so it does not obscure crowded maps.

### Sidebar

The content script mounts the notebook in a Shadow DOM root to isolate it from Foundry and module styles. The sidebar contains:

- Compatibility status.
- Creature list for the current encounter.
- Selected-creature summary.
- Facts grouped by defenses, durability, mitigation, and capabilities.
- Provenance labels and confidence.
- Expandable evidence and contradiction history.
- A manual **Clear encounter** action.

Selecting a creature in the sidebar does not target or modify its Foundry token.

### Toolbar action

The toolbar action shows whether the current site is enabled and supports three operations: enable this Foundry origin, disable this origin, and open the notebook sidebar. Enabling always requires a user gesture and Chrome's origin permission prompt.

## Error handling

- Hook callbacks catch and report their own errors without throwing into Foundry.
- Invalid bridge messages are discarded and counted in diagnostics.
- Duplicate event IDs are ignored.
- Missing targets or unsupported message structures do not update estimates.
- Scene and canvas transitions teardown stale overlay objects before rebuilding.
- Storage corruption resets only the affected notebook scope after preserving a diagnostic reason.
- Service-worker suspension does not lose live tab state; the content script reconnects and checkpoints when the worker resumes.
- Adapter failure switches to fallback mode when the DOM parser is supported.
- Unsupported versions disable capture and explain the compatibility requirement.

Diagnostics are local, redact chat content by default, and provide no telemetry.

## Security and privacy

- No observation or notebook data leaves the browser.
- No remote scripts or analytics are loaded.
- Chat-derived HTML is treated as untrusted input and parsed without executing markup.
- Bridge payloads and storage values are schema validated.
- Sidebar text uses text nodes or escaping rather than unsanitized HTML.
- Page-to-extension messages cannot trigger general extension capabilities.
- The extension performs no writes to Foundry documents and no privilege escalation.

## Delivery increments

### Increment 1: foundation and defenses

- MV3 package and optional site authorization.
- Version handshake, main-world adapter, event bridge, and fallback observer.
- Encounter identity, session storage, and diagnostics.
- AC and save observations and candidate inference.
- Calm Pixi overlay.
- Shadow DOM sidebar with evidence.

### Increment 2: durability

- Exact and inferred HP.
- Public health-description thresholds.
- Applied damage, healing, and temporary HP.
- Weakness, resistance, immunity, and regeneration evidence.

### Increment 3: creature notebook

- Observed attacks, actions, reactions, spells, auras, and traits.
- Evidence search and filtering.
- Fixture adapters for additional supported PF2e releases.

## Testing

Pure Vitest suites cover:

- Degree and defense candidate ranges, including natural 1, natural 20, clamping, and known degree adjustments.
- Candidate intersections, unions, contextual partitions, and contradictions.
- HP threshold and net-damage constraints.
- Ambiguous mitigation evidence.
- Provenance precedence.
- Event deduplication and scope reset.
- Runtime payload and storage schema validation.

Integration fixtures cover:

- Supported PF2e chat cards and structured message shapes.
- Main-world/content-script bridge serialization.
- Service-worker injection, origin authorization, checkpoint, and restore behavior.
- Unexpected and hostile chat HTML.
- Adapter handshake and compatibility fallback.
- Shadow DOM mounting and teardown.
- Pixi overlay creation, target changes, canvas reconstruction, and teardown.

Manual acceptance testing runs in Foundry 14 with PF2e 8.5 and verifies:

- No GM module or server installation is required.
- The extension activates only on an authorized Foundry origin.
- Attack evidence narrows the correct target's defense.
- Reload restores the current encounter and browser restart clears it.
- Overlay text follows the target and remains readable while panning and zooming.
- Disabling the extension removes all injected UI and listeners.
- Malformed or unsupported observations do not interrupt rolls, chat, or canvas interaction.

## Acceptance criteria

Increment 1 is complete when a player can authorize their Foundry site, target a creature, observe supported PF2e attack/check messages, and see defensible AC/save ranges in the sidebar plus the selected calm overlay. Every displayed conclusion must link to evidence and provenance. Reloading must preserve the encounter, clearing must remove it, and extension failure must not affect Foundry.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- **Gridless Combat:** optional PF2e/SF2e support with continuous distance and reach, native flanking, center-based automatic cover, and wall-aware area targeting.
- **Gridless guides:** a flanking position guide and a turn-based remaining-movement ring with native action glyphs. Movement rings appear during movement or hold-to-preview.
- **Movement preview options:** the remaining-movement overlay renders as the reachable-area ring (default), a plain circle of the remaining distance that still includes routed path costs, or nothing at all.
- **Attack distances:** ready melee attacks show translucent reach circles. Ranged attacks show outline-only range rings. Equal distances share labeled circles.
- **Gridless routing:** automatic terrain-weighted routes and reachable-movement outlines account for token clearance without snapping movement to squares.
- **Movement lattice:** a new **Movement Lattice** setting adds a fixed hex lattice at one tenth of a square. Normal routes use the token's full footprint. A separate cramped-passage fallback runs only when no full-footprint route exists. Continuous geometry remains the default.
- **Cramped passages:** Small creatures use 2.5-foot passages normally. Medium and larger creatures can use smaller passages at difficult-terrain cost. Tighter gaps require Squeeze.
- **Pathfinder compatibility:** the module manifest now permits PF2e worlds.
- **Movement Debug:** an optional client-only overlay fills reachable hex cells at low opacity. Terrain tags select fill colors. White, amber, and red outlines show movement cost.
- **Hex flanking guide:** low-opacity red cells mark native flank-eligible positions on the shared lattice, with normal token-footprint wall clearance. Continuous mode retains directional wedges.
- **Floors:** map-workshop `setElevation` floor regions now move tokens between floor heights from Codex Foundry, including the drop-time path rewrite, the **Refuse climbs on foot** setting, and floor snapping for dropped tokens. The importer module keeps only the region behavior type.
- **Floor-aware preview:** in hex lattice mode the drag label shows the planned floor height at each waypoint and flags waypoints past a refused ledge. The reachable ring and automatic routes stop at ledges the movement action cannot climb.
- **Blocked frontier:** in hex lattice mode the reachable ring now shows red cells with the Climb action's icon along ledges the current action cannot climb and a compress icon at gaps that need a Squeeze, taking the token's movement action and size into account.
- **Squeezing:** on the hex lattice, gaps between half and the full cramped footprint are now routed as greater difficult terrain. The squeezed stretch costs triple in movement measurement and the ruler label shows a compress icon on that leg. Small and Tiny creatures squeeze gaps down to half their half-space footprint.

### Changed

- **One ruler label:** the remaining-movement text and action glyph moved from a separate overlay label into the native ruler waypoint label, alongside distance, surcharge, and elevation. The reachable ring is now outline only.
- Normal movement no longer draws a hex-cell trail. The native ruler line and movement outline remain available.

### Fixed

- **Dense wall scenes:** the wall-clearance build no longer compares every wall against every other one. A 4,000-wall level built in 35 seconds and froze the tab; it now takes a fraction of a second.
- **Long movement budgets on the hex lattice:** the reachable flood threw for budgets of 80 ft or more on large scenes.
- **Floor treads at other heights:** floor entries are now traced along the path geometrically. Foundry's region segmentiser only reports a region whose elevation band contains the token, and map-workshop exports put `setElevation` on zero-height bands, so a token at one height never saw the next tread.
- **Concave regions on the hex lattice:** difficult-terrain and floor regions were rasterised with a convex-only containment test, so any concave region, which is most hand-drawn or cave-shaped ones, applied no cost or height at all. Regions now use even-odd containment.
- **Difficult terrain on the hex lattice:** movement costs now apply throughout each region, not just at entry. Search and reachable outlines use native terrain rates and terrain-ignore abilities. Straightening no longer discards cheaper terrain detours.
- **Movement preview cleanup:** normal movement previews clear when movement finishes or a drag is cancelled. Hold-to-preview remains available.
- **Hex corner clearance:** removed corner displacement and the four-foot routing preference that produced sharp zigzags. Search and straightening now check complete segments against the selected footprint.
- **Cave routing:** destination searches use A* and skip distant wall geometry. Route corners remain clear after native pixel rounding.
- **Movement preview:** continuous dragging no longer cancels every outline calculation. The previous outline stays in place until its replacement is ready.
- **Gridless movement:** spent distance now carries forward when the active combatant inherits its scene from the encounter.
- **Gridless terrain:** prepared abilities that ignore all difficult or greater difficult terrain now affect native gridless movement costs.
- **SF2e creature imports:** condition links now use compendium document IDs instead of names, fixing Dazzled, Blinded, and other linked conditions in abilities. This applies to new imports and explicit reimports; existing actors are not automatically updated.
- **SF2e conditions:** ability descriptions now recognize Glitching with a numeric value, Suppressed, and Untethered. Existing explicit condition links are preserved.

## 1.0.2

### Changed

- **Vault bestiary format:** creature statblocks moved from YAML frontmatter to ` ```statblock ` body fences, declared by a `creatures: [id, …]` frontmatter array. A file can now hold several creatures (e.g. `praetorians.md`); each fence carries its own `id`, `syncId`, `published`, and `portrait`. Push mints missing syncIds into the fence. Old frontmatter statblocks fail the build with a migration error naming the file.
- **Statblock Importer:** pasting a multi-creature file offers a creature picker; public notes now exclude the statblock fences.

### Fixed

- **Vault Sync:** creature portraits now drive the prototype token texture, not just the actor image. Foundry only applies default artwork at creation, so previously synced creature actors kept their old (default-icon) token texture on reimport; reimport now rewrites `prototypeToken.texture.src` from the vault portrait. Creatures without a portrait are untouched — GM-set token art is never clobbered.

## 1.0.1

### Fixed

- **Security (docs):** the 1.0.0 migration procedure carried the Vault Sync Passphrase through the browser console and a saved dump file. The corrected procedure below excludes the passphrase from the settings dump entirely and enters it only via the module Settings UI. If you migrated with the 1.0.0 instructions, clear your browser console history and delete the dump file.

## 1.0.0

**Breaking rename:** `sf2e-forge-custom` is now **codex-bridge** (module id `codex-foundry`, pipeline `codex-sync`).

### Migration (one-time, ~5 minutes)

1. **Before uninstalling** (old module still enabled), dump all non-secret settings. In the world, open the browser console and run:
   ```js
   const dump = {};
   for (const key of game.settings.settings.keys()) {
       if (!key.startsWith("sf2e-forge-custom.")) continue;
       const short = key.split(".")[1];
       if (short === "forgeSyncPassphrase") continue; // secret — handled via Settings UI only
       try { dump[short] = game.settings.get("sf2e-forge-custom", short); } catch {}
   }
   console.log(JSON.stringify(dump));
   ```
   Copy the JSON somewhere safe. This captures the 7 world toggles and the hidden `forgeSyncLastManifest`. The passphrase is deliberately excluded — never move it through the console or a file. Without the dump, prior state is unrecoverable.
2. In Foundry **Setup**, uninstall `SF2e Forge Custom Rules`.
3. Install from the new manifest URL: `https://github.com/pjgates/codex-bridge/releases/latest/download/module.json`
4. Enable **Codex Foundry** in your world, reload, then restore the dump in the console:
   ```js
   const dump = { /* pasted JSON — contains no passphrase */ };
   const keyMap = { enableForgeSync: "enableCodexSync", forgeSyncLastManifest: "codexSyncLastManifest" };
   for (const [short, value] of Object.entries(dump)) {
       await game.settings.set("codex-foundry", keyMap[short] ?? short, value);
   }
   ```
   An empty/absent `forgeSyncLastManifest` is fine to restore as-is.
5. Enter the Vault Sync Passphrase via **Module Settings > Codex Foundry > Vault Sync Passphrase** (the UI field, never the console). It is client-scoped by design: each GM browser enters its own. Clear your clipboard and delete the dump afterward.
6. Run a Vault Sync from the sync dialog. Expect **0 creates and 0 stale**; updates only where art URLs changed. If you see creates, stop and report — do not apply.
7. Historical chat cards keep working; their old flags are simply inert.

Self-hosting note: pre-rename world documents referencing `forge-sync/art/...` keep resolving via a server-side compatibility symlink (see the restructure spec).

### Changed

- Repository renamed to `pjgates/codex-bridge`; release zip is now `codex-foundry.zip`.
- Push pipeline: `forge-sync.config.json` → `codex-sync.config.json`, `FORGE_SYNC_PASSPHRASE` → `CODEX_SYNC_PASSPHRASE`, remote dir `Data/forge-sync/` → `Data/codex-sync/`.
- SF2e houserule features moved to `src/rulesets/sf2e/`; node-side tests to `tests/node/`; push CLI to `sync/`.

## 0.3.0 - 2026-08-02

### Added

- **Forge Sync** -- encrypted one-way vault → Foundry content pipeline (`npm run push`). Entities, journal entries, and bestiary creatures sync from the vault working copy to the world via AES-GCM payload; syncIds track identity across renames. Dynamic token ring subjects supported via per-entity `subject:` art (birefnet background removal, validated mask recipe). Passphrase entered once in module settings (client-scoped, GM-only). Adoption dialog for pre-existing world documents.

### Removed

- **Compendium packs** -- the `the-forge-entities` and `the-forge-bestiary` compendium packs, the vault submodule, the pack compiler (`compile-packs`), vault converter (`convert-vault`), and all pack-only converter code are retired. Content flows exclusively through forge-sync. `@foundryvtt/foundryvtt-cli` dependency removed.

## 0.2.0 - 2026-07-11

### Added

- **Statblock Importer** -- paste a vault bestiary markdown file into a new Import Statblock button in the Actors sidebar (GM only) to create the NPC in-world without a module release. The preview dialog rates every stat (AC, saves, HP, attributes, skills, Perception, strike attack/damage, resist/weak values, ability DCs) against the GM Core creature-building benchmarks for the creature's level, with hover tooltips showing the reference bands. Lenient about homebrew vocabulary: custom senses land in Perception details, unknown traits are kept as slugs. Imported actors get structured immunities/resistances/weaknesses and the markdown body as public notes.
- **Players Roll All Dice (PRAD)** -- variant rule that converts NPC attacks into player armor saves and NPC saves into player overcome checks, with sheet augmentation for DCs and modifiers.
- **Target Helper** -- per-target save/check rows on chat cards for spells, area effects, and other targeted actions. Compatible with PF2e Toolbelt's Target Helper.

### Changed

- The statblock parsing, enrichment, and actor-building core moved from `scripts/converter/` to `src/statblock/`, shared by the pack converter and the runtime importer. Pack output is unchanged (deterministic ids preserved); `scripts/converter/` keeps thin Node wrappers.

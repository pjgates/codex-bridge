# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

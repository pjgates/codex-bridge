# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

# Task 11 — Retire compendium pack pipeline

## Summary

Removed the vault submodule, compendium pack build scripts, pack-only converter code, and release zip pack steps. Campaign content now flows only through **forge-sync** (`npm run push`).

## Deleted

| Path |
|------|
| `vault/` (git submodule) |
| `scripts/compile-packs.ts` |
| `scripts/compile-packs.test.ts` |
| `scripts/convert-vault.ts` |
| `scripts/build-lock.ts` |
| `scripts/build-lock.test.ts` |
| `scripts/converter/bestiary-actor.ts` |
| `scripts/converter/bestiary-write.ts` |
| `scripts/converter/bestiary-types.ts` |
| `scripts/converter/folders.ts` |
| `scripts/converter/ids.ts` |
| `scripts/converter/journal.ts` |
| `scripts/converter/links.ts` |
| `scripts/converter/enrich.ts` |
| `scripts/converter/sanitize.ts` |
| `scripts/converter/sf2e-traits.ts` |
| `scripts/converter/snapshot-output.ts` |
| `scripts/converter/write.ts` |
| `scripts/converter/__tests__/convert-vault.test.ts` |
| `scripts/converter/__tests__/bestiary-actor.test.ts` |
| `scripts/converter/__tests__/bestiary-integration.test.ts` |
| `scripts/converter/__tests__/enrich.test.ts` |
| `scripts/converter/__tests__/ids.test.ts` |
| `scripts/converter/__tests__/journal.test.ts` |
| `scripts/converter/__tests__/links.test.ts` |
| `scripts/converter/__tests__/snapshot-output.test.ts` |
| `scripts/converter/__tests__/write.test.ts` |
| `.gitmodules` |
| `packs/` (local directory, was gitignored / untracked) |

## Modified

| Path | Change |
|------|--------|
| `package.json` | Removed `convert`, `compile-packs`, `sync`; `build` → `vite build`; `clean` → `dist` only |
| `.github/workflows/release.yml` | Removed vault submodule checkout and pack zip/validation; zip `dist/` + metadata only |
| `module.json` | `packs: []` (empty compendium list) |
| `README.md` | Removed pack build flow; added forge-sync pipeline section |
| `.gitignore` | Removed `packs/` ignore entry |
| `scripts/converter/types.ts` | Removed pack-only types |
| `scripts/converter/__tests__/markdown.test.ts` | Imports from `src/statblock/` instead of deleted converter wrappers |
| `src/statblock/index.ts` | Comment: forge-sync instead of pack converter |

## Kept (forge-sync / runtime)

- `scripts/forge-sync.ts`, `scripts/sync/*`
- `scripts/converter/parse.ts`, `bestiary-parse.ts`, `markdown.ts`, `dom.ts`, `types.ts` + related tests
- `src/statblock/*`, `src/statblock-importer/*` (runtime GM import UI)
- `scripts/statblock-importer/importer.test.ts`

## Verify

`npm run verify` — typecheck, lint, vitest (380 tests), vite build — all green.

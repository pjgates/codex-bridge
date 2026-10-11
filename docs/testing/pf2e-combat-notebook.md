# PF2e Combat Notebook verification

## Automated checks: passing

`npm run verify` passed on 2026-10-11 (Node 22.14, Vitest 4.0.18): all TypeScript
checks including `extension:typecheck`, lint (including `extension/src` and
`extension/tests`; one existing unused `clearance` warning in the Foundry module),
902 root tests in 113 files, 243 extension tests in 17 files, the Foundry module,
plugin, and extension builds, and 33 extension artifact smoke checks.

The smoke checks assert the built `extension/dist` file set, that `content.js`,
`main-world.js`, and `popup.js` are self-contained IIFEs, that the manifest has no
static content scripts, no `tabs` permission, and only optional host access, and that
no bundle calls `fromUuid`, `.update(`, `.create(`, embedded-document or flag writes,
`fetch`, or other network APIs. `.delete(` is forbidden in `main-world.js` and
`popup.js`; the content script and service worker use it only on `Map`/`Set` and
cannot reach Foundry documents.

The extension build is independent of the working directory: building from `/tmp`
produced byte-identical `extension/dist` output.

## Manual acceptance: not yet performed

No Foundry VTT 14 / PF2e 8.5 instance was available, so none of these steps has been
run. Each needs to be performed with `extension/dist` loaded unpacked in Chromium:

1. Grant only the current Foundry origin and reload.
2. Confirm status is Active and no GM module is enabled.
3. Target one NPC and make attacks producing at least a success and a failure.
4. Confirm AC candidates narrow and every fact links to evidence and provenance.
5. Pan and zoom; confirm the overlay follows and remains readable.
6. Reload; confirm the current encounter state restores.
7. Use **Clear encounter**; confirm the sidebar and overlay clear.
8. Disable the origin; confirm the sidebar, hooks, and Pixi objects disappear.
9. Open a world on an unsupported PF2e version; confirm Unsupported and no estimates.
10. Confirm Foundry rolls, chat, targeting, and canvas interaction still work after an
    injected malformed observation.

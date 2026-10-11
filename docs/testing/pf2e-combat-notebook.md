# PF2e Combat Notebook verification

## Automated checks: passing

`npm run verify` passed on 2026-10-11 (Node 22.14, Vitest 4.0.18): all TypeScript
checks including `extension:typecheck`, lint (including `extension/src` and
`extension/tests`; one existing unused `clearance` warning in the Foundry module),
902 root tests in 113 files, 265 extension tests in 19 files, the Foundry module,
plugin, and extension builds, and 45 extension artifact smoke checks.

The smoke checks assert the built `extension/dist` file set, that `content.js`,
`main-world.js`, and `popup.js` are self-contained IIFEs, that the manifest has no
static content scripts, no `tabs` permission, and only optional host access, and that
no bundle calls `fromUuid`, `.update(`, `.create(`, embedded-document or flag writes,
`socket.emit`, `game.settings.set`, `Hooks.call`/`Hooks.callAll`, `fetch`, or other
network APIs. `.delete(` is forbidden in `main-world.js` and
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
4. Confirm the sidebar shows the target's AC as exact client data when your client
   already holds it, and shows narrowing inferred/possible AC candidates only when no
   exact AC is available; every fact links to evidence and provenance.
5. Pan and zoom; confirm the overlay follows and remains readable.
6. Reload; confirm the current encounter state restores.
7. Use **Clear encounter**; confirm the sidebar and overlay clear.
8. Disable the origin; confirm the sidebar, hooks, and Pixi objects disappear.
9. Open a world on an unsupported PF2e version; confirm Unsupported and no estimates.
10. Confirm Foundry rolls, chat, targeting, and canvas interaction still work after an
    injected malformed observation.

While performing these steps, also confirm these PF2e 8.5 assumptions the adapter
relies on:

- `context.unadjustedOutcome` on attack rolls already includes the natural 1/20
  degree step but no other degree adjustment (the inference treats it that way).
- Saving-throw messages carry exactly one save statistic in `context.domains`.
- Whether players' clients receive `context.dc.value` for attacks against NPCs (when
  present it is recorded as exact client data).
- `game.user.targets` is already updated when the `targetToken` hook fires.
- Rendered chat cards mark the result with `.degree-of-success` markup (used only in
  Fallback mode).

## Behavior the automated tests pin

- AC is a DC; saves and Perception record the roller's own observed modifier, shown
  signed (for example `+12`) whether it came from exact client data or a roll.
- Provenance: "inferred" is derived from at least one roll; "possible" means an
  unknown degree adjustment widened the range. The overlay shows the name and AC
  estimate with the same provenance label as the sidebar.
- Fallback is entered when the Foundry adapter did not respond, failed after
  confirming a supported version, or found no runtime; it only records rendered checks
  as diagnostics and never estimates. An unreadable Foundry identity is reported as
  Unsupported, and a missing scene at startup keeps capture active until
  `canvasReady` supplies one.
- The sidebar starts collapsed.

## Known limitations

Contextual AC (cover, Raise a Shield, conditions already folded into the actor's AC,
`context.dc.value` reflecting situational modifiers) is currently treated as baseline
unless the roll options include `target:condition:*`; contextual partitions come in a
later increment.

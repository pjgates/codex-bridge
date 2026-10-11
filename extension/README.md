# PF2e Combat Notebook extension

A player-installed Chrome extension that keeps a local, encounter-scoped notebook of
what your own checks have revealed about the creatures you target in a Pathfinder 2e
game on Foundry VTT. Roll an attack against a targeted NPC and the notebook narrows
that creature's possible AC from the result; saves and Perception checks do the same
for those defenses.

Nothing is installed in Foundry. This is not the Codex Bridge Foundry module in the
repository root, needs no GM action, and works the same for every player who loads it.

## Compatibility

- Chromium-based browsers (Manifest V3)
- Foundry VTT 14
- Pathfinder 2e system 8.5.x

## Privacy

- The extension only reads objects the authenticated Foundry page has already loaded
  for your user. It requests no additional documents and makes no network requests.
- It never creates, updates, or deletes Foundry documents, flags, chat messages, or
  settings. Rolls, chat, targeting, and the canvas behave exactly as without it.
- Notebook records are stored in `chrome.storage.session`: they survive a page reload
  and are discarded when the browser session ends. Disabling a site also clears its
  records.
- The list of sites you enabled is stored in `chrome.storage.local` so the extension
  can re-register its scripts after a browser restart.
- The extension only runs on sites you enable. It asks for no `tabs` permission and
  holds no host access until you grant it for a site.

## Build

```bash
npm install
npm run extension:build
```

The unpacked extension is written to `extension/dist/` (git-ignored).

## Load unpacked in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `extension/dist`.
4. After rebuilding, press the reload icon on the extension's card.

## Enable a Foundry site

1. Open the Foundry game in a tab.
2. Select the **PF2e Combat Notebook** toolbar action.
3. Choose **Enable this Foundry site** and accept Chrome's permission prompt.
   The tab reloads once so the notebook can attach before Foundry starts.
4. To stop, open the popup again and choose **Disable this site**. The sidebar,
   overlay, and Foundry hooks are removed immediately and the site's records cleared.

Chrome host match patterns cannot restrict permission to one port. For a local
Foundry URL, Chrome therefore grants the extension access to that hostname on
all ports; the extension's own allowlist activates capture only on the exact
origin (including its configured port).

## Using the notebook

- **Sidebar.** A collapsible drawer on the Foundry page lists the creatures you have
  checked against in the current scene and combat. Choose a creature to see its AC,
  Fortitude, Reflex, Will, and Perception, the evidence behind each value, and any
  disputed (contradictory) results. The popup's **Open notebook** button and the
  drawer's ☰ button toggle it.
- **Overlay.** When structured capture is active, a small label above your current
  target shows its name and current AC estimate. It follows pans and zooms and never
  intercepts canvas clicks.
- **Scope.** Records belong to the Foundry world, your user, and the current scene and
  combat (or scene exploration outside combat). Starting a new combat starts a fresh
  notebook page.
- **Clear encounter.** The sidebar's **Clear encounter** button (with confirmation)
  resets the current scope.

## Provenance labels

Every displayed value carries one of these labels:

- **exact client data** — the value is present in data your client already holds.
- **observed** — a check result shown in chat directly established the value.
- **inferred** — the value is derived from several observations.
- **possible** — a range still consistent with every observation so far.

## Compatibility status

The sidebar header shows one of three modes:

- **Active** — structured Foundry/PF2e capture is running.
- **Fallback** — the Foundry adapter did not respond, so only supported, visibly
  rendered PF2e chat cards are recorded.
- **Unsupported** — the Foundry or PF2e version is not supported; capture and
  estimates are disabled, and the reason is shown.

Unrecognized chat cards or runtime shapes are ignored and never update estimates.

## Limitations

This is increment 1 of the design. It estimates AC, saving throw DCs, and Perception
DC only. Hit point and damage mitigation (resistance/weakness) inference and a full
observed-abilities notebook are planned for later increments.

## Verification

```bash
npm run extension:typecheck
npm run extension:test
npm run extension:build
npm run extension:smoke
```

`extension:smoke` checks the built `extension/dist`: the exact file set, that the page
scripts are self-contained IIFEs, that the manifest has no static content scripts, no
`tabs` permission, and only optional host access, and that no bundle contains Foundry
document writes or network calls. `npm run verify` runs these along with the rest of
the repository's checks.

## Manual acceptance checklist

These steps require a live Foundry VTT 14 world running PF2e 8.5 and have not yet been
performed against one.

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

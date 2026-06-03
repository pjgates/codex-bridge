/**
 * Heroic Rerolls — Settings
 *
 * Registers and exposes the setting that controls the Heroic Rerolls
 * variant rule.
 */

import { MODULE_ID } from "../constants.js";

/** Register the Heroic Rerolls setting during the `init` hook. */
export function registerHeroicRerollsSetting(): void {
    game.settings!.register(MODULE_ID, "heroicRerolls", {
        name: "sf2e-forge-custom.settings.heroicRerolls.name",
        hint: "sf2e-forge-custom.settings.heroicRerolls.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        requiresReload: true,
    });
}

/** Check whether the Heroic Rerolls variant rule is enabled. */
export function isHeroicRerollsEnabled(): boolean {
    return game.settings!.get(MODULE_ID, "heroicRerolls");
}

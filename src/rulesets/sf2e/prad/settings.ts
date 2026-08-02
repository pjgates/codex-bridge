/**
 * PRAD (Players Roll All Dice) — Settings
 *
 * Registers and exposes the module settings that control
 * the "Players Roll All Dice" variant rule and its DC mode.
 */

import { MODULE_ID } from "../../../constants.js";
import { DC_BASE_DEFAULT, DC_BASE_STRICT, setDCBase } from "../../../shared/dc.js";

/**
 * Register PRAD settings in Foundry's module configuration.
 * Called during the `init` hook.
 */
export function registerPradSettings(): void {
    game.settings!.register(MODULE_ID, "playersRollAllDice", {
        name: "sf2e-forge-custom.settings.playersRollAllDice.name",
        hint: "sf2e-forge-custom.settings.playersRollAllDice.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        requiresReload: true,
    });

    game.settings!.register(MODULE_ID, "pradStrictDCs", {
        name: "sf2e-forge-custom.settings.pradStrictDCs.name",
        hint: "sf2e-forge-custom.settings.pradStrictDCs.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        requiresReload: true,
    });
}

/**
 * Check whether the PRAD variant rule is currently enabled.
 */
export function isPradEnabled(): boolean {
    return game.settings!.get(MODULE_ID, "playersRollAllDice");
}

/**
 * Check whether strict DC mode (+12) is enabled.
 * When false (default), DCs use the +11 base.
 */
export function isPradStrictDCs(): boolean {
    return game.settings!.get(MODULE_ID, "pradStrictDCs");
}

/**
 * Apply the DC base setting to the shared DC utilities.
 * Called during the `ready` hook after settings are available.
 */
export function applyDCBaseSetting(): void {
    const strict = isPradStrictDCs();
    setDCBase(strict ? DC_BASE_STRICT : DC_BASE_DEFAULT);
    console.log(
        `${MODULE_ID} | PRAD: DC base set to ${strict ? DC_BASE_STRICT : DC_BASE_DEFAULT} (${strict ? "strict" : "default"} mode)`,
    );
}

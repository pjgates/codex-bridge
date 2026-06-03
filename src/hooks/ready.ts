/**
 * Called during the "ready" hook.
 * The game is fully loaded and all data is available at this point.
 */

import { MODULE_ID } from "../constants.js";
import { activateHeroicRerolls, isHeroicRerollsEnabled } from "../heroic-rerolls/index.js";
import { isPradEnabled, applyDCBaseSetting, registerAttackInterceptHook, registerPradSheetHooks } from "../prad/index.js";
import { activateTargetHelper, setPradOvercomeEnabled } from "../target-helper/index.js";

export function onReady(): void {
    const isEnabled = game.settings!.get(MODULE_ID, "enableCustomRules");

    if (!isEnabled) {
        console.log(`${MODULE_ID} | Custom rules are disabled in settings.`);
        return;
    }

    console.log(`${MODULE_ID} | Custom rules are active.`);

    // ─── Heroic Rerolls (Hero Point rerolls have a minimum d20 of 10) ───
    if (isHeroicRerollsEnabled()) {
        activateHeroicRerolls();
    }

    const targetHelperEnabled = game.settings!.get(MODULE_ID, "enableTargetHelper") as boolean;
    const pradEnabled = isPradEnabled() && targetHelperEnabled;

    // ─── Target Helper (per-target save rows on chat cards) ──────────────
    if (targetHelperEnabled) {
        // Tell Target Helper whether PRAD overcome mode should be active
        // (breaks circular dependency — TH no longer imports from prad/)
        setPradOvercomeEnabled(pradEnabled);

        activateTargetHelper();
    } else {
        console.log(`${MODULE_ID} | Target Helper is disabled in settings.`);
    }

    // ─── PRAD (Players Roll All Dice) ────────────────────────────────────
    if (pradEnabled) {
        console.log(`${MODULE_ID} | PRAD: Players Roll All Dice variant is ENABLED`);

        // Apply the DC base setting (+11 default or +12 strict) before
        // any DC calculations occur.
        applyDCBaseSetting();

        // Inversion 1: NPC attacks → Player armor saves
        registerAttackInterceptHook();

        // Inversion 2 (NPC saves → Player overcome checks) is handled
        // by the Target Helper in pradOvercome mode — no separate hook needed.

        // Sheet augmentation: show DCs on NPC sheets, modifiers on PC sheets
        registerPradSheetHooks();

        ui.notifications!.info(
            game.i18n!.format("sf2e-forge-custom.prad.variantActive", {
                name: game.i18n!.localize("sf2e-forge-custom.settings.playersRollAllDice.name"),
            }),
        );
    }
}

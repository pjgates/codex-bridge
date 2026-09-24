/**
 * Called during the "ready" hook.
 * The game is fully loaded and all data is available at this point.
 */

import {activateCoveredTokenOutlines} from "../canvas/covered-tokens.js";
import { MODULE_ID } from "../constants.js";
import { activateHeroicRerolls, isHeroicRerollsEnabled } from "../rulesets/sf2e/heroic-rerolls/index.js";
import { isPradEnabled, applyDCBaseSetting, registerAttackInterceptHook, registerPradSheetHooks } from "../rulesets/sf2e/prad/index.js";
import { activateTargetHelper, setPradOvercomeEnabled } from "../rulesets/sf2e/target-helper/index.js";
import { checkForVaultUpdates } from "../sync/index.js";
import { activateElevationTooltip, activateFloorElevation, activateFloorProbe, activateGridlessCombat, activateMovementChecks } from "../rulesets/sf2e/gridless/index.js";
import { activateClipTileConfig, activateClipTiles } from "../canvas/clip-tiles/index.js";
import { activateFlying } from "../rulesets/sf2e/flying/index.js";

import { activateTerrainStatuses, ensureTerrainMacros, activateMovementTransitions, activateMovementDecisions, openDecision, resolveMovementChoice, movementControls, activateForcedPreview, requestFall, activateFlightUpkeep, clearTerrainOverride } from "../rulesets/sf2e/movement/index.js";
import { migrateSettings } from "../settings/migration.js";
import { activateExplorationNotices, activateSwimUpkeep } from "../rulesets/sf2e/movement/index.js";
import {activateSurfaceVisibility} from '../canvas/regions/index.js';

export async function onReady(): Promise<void> {
    await clearTerrainOverride();
    try { await migrateSettings(); }
    catch (error) {
        console.error(`${MODULE_ID} | Settings migration incomplete`, error);
        ui.notifications!.error(game.i18n!.localize(`${MODULE_ID}.settings.migrationFailed`));
    }
    // Tile clipping is a canvas feature, not a house rule, so it ignores the master switch.
    activateClipTiles();
    activateClipTileConfig();
    activateSurfaceVisibility();
    activateCoveredTokenOutlines();

    void checkForVaultUpdates();

    const isEnabled = game.settings!.get(MODULE_ID, "enableCustomRules");

    if (!isEnabled) {
        console.log(`${MODULE_ID} | Custom rules are disabled in settings.`);
        return;
    }

    console.log(`${MODULE_ID} | Custom rules are active.`);
    activateGridlessCombat();
    activateForcedPreview();
    // Map-workshop floor heights apply on every scene with floor regions, gridless or not.
    activateFloorElevation();
    activateMovementDecisions(resolveMovementChoice, movementControls);
    activateMovementTransitions(openDecision);
    activateExplorationNotices();
    activateTerrainStatuses();
    void ensureTerrainMacros();
    // Token tooltips read heights against the floor below and the selected token, across levels.
    activateElevationTooltip();
    activateFloorProbe();
    // After the floor rewrite, so check prompts see the path that actually executes.
    activateMovementChecks();
    // The Flying effect keeps the fly movement action on airborne tokens.
    activateFlying(requestFall);
    activateFlightUpkeep(requestFall);
    activateSwimUpkeep();


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
            game.i18n!.format("codex-foundry.prad.variantActive", {
                name: game.i18n!.localize("codex-foundry.settings.playersRollAllDice.name"),
            }),
        );
    }
}

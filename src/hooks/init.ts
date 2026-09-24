/**
 * Called during the "init" hook.
 * Use this to register custom settings, document classes, and other
 * elements that need to be available before the game is ready.
 */

import { MODULE_ID } from "../constants.js";
import { registerPradSettings, registerPradTemplates, registerAttackCardTemplate } from "../rulesets/sf2e/prad/index.js";
import { registerHeroicRerollsSetting } from "../rulesets/sf2e/heroic-rerolls/index.js";
import { initTargetHelper } from "../rulesets/sf2e/target-helper/index.js";
import { initStatblockImporter, registerStatblockImporterSetting } from "../rulesets/sf2e/statblock-importer/index.js";
import { registerAbsoluteElevationKeybind, registerFloorSetting, registerGridlessSetting, registerMovementCheckSetting, registerMovementPreviewKeybind } from "../rulesets/sf2e/gridless/index.js";
import {
    registerSyncSettings,
    registerSyncSettingsButton,
    registerSyncTemplates,
} from "../sync/index.js";
import { activateSettingsPresentation } from "../settings/presentation.js";

import { registerMovementSettings, registerForcedMovement, registerTerrainPolicy } from "../rulesets/sf2e/movement/index.js";
import { registerSettingsMigration } from "../settings/migration.js";

import { registerRegionBehaviors, activateGeometryConfig } from "../canvas/regions/index.js";

export function onInit(): void {
    registerRegionBehaviors();
    game.settings!.register(MODULE_ID,'surfaceFading',{name:'Fade suspended surface artwork by default',hint:'Off keeps artwork opaque. Override individual surfaces in Surface Geometry. Sight and light blocking are unchanged.',scope:'world',config:true,type:Boolean,default:false,requiresReload:true});
    game.settings!.register(MODULE_ID,'coveredTokenOutlines',{name:'Outline visible tokens beneath artwork',hint:'Shows a silhouette and elevation only when the current PC vision sources can see a covered token.',scope:'client',config:true,type:Boolean,default:true,requiresReload:true});
    activateGeometryConfig();
    registerSettingsMigration();
    // Register module settings (order matters for the settings UI)
    registerSettings();

    // Register Heroic Rerolls variant setting
    registerHeroicRerollsSetting();
    registerGridlessSetting();
    registerFloorSetting();
    registerMovementCheckSetting();
    registerMovementSettings();
    registerTerrainPolicy();
    registerForcedMovement();
    registerMovementPreviewKeybind();
    registerAbsoluteElevationKeybind();

    // Register Vault Sync settings
    registerSyncSettings();
    registerSyncTemplates();
    registerSyncSettingsButton();

    // Register PRAD (Players Roll All Dice) settings
    registerPradSettings();

    // Pre-load Handlebars templates for PRAD chat cards
    registerPradTemplates();
    registerAttackCardTemplate();

    // Initialize Target Helper (template registration)
    initTargetHelper();

    // Statblock importer: setting + Actors-directory button
    registerStatblockImporterSetting();
    initStatblockImporter();

    // Hook into settings UI to enforce dependency: PRAD requires Target Helper
    activateSettingsPresentation();
}
// ─── Settings Registration ───────────────────────────────────────────────────

/**
 * Register module settings that appear in Foundry's module configuration.
 * Settings are displayed in order of registration.
 */
function registerSettings(): void {
    // Master switch
    game.settings!.register(MODULE_ID, "enableCustomRules", {
        name: "codex-foundry.settings.enableCustomRules.name",
        hint: "codex-foundry.settings.enableCustomRules.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        requiresReload: true,
    });

    // Target Helper toggle (independent feature)
    game.settings!.register(MODULE_ID, "enableTargetHelper", {
        name: "codex-foundry.settings.enableTargetHelper.name",
        hint: "codex-foundry.settings.enableTargetHelper.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        requiresReload: true,
    });
}

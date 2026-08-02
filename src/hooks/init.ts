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
import {
    registerSyncSettings,
    registerSyncSettingsButton,
    registerSyncTemplates,
    SETTING_ENABLE_SYNC,
} from "../sync/index.js";
import { resolveHtmlRoot } from "../shared/html.js";

export function onInit(): void {
    // Register module settings (order matters for the settings UI)
    registerSettings();

    // Register Heroic Rerolls variant setting
    registerHeroicRerollsSetting();

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
    Hooks.on("renderSettingsConfig", onRenderSettingsConfig);
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

// ─── Settings UI: Dependency Enforcement ─────────────────────────────────────

/**
 * When the settings config dialog renders, find the PRAD checkbox and
 * disable it if Target Helper is off. Also disable Target Helper (and PRAD)
 * if the master switch is off.
 */
function onRenderSettingsConfig(
    _app: object,
    html: HTMLElement,
    _data: object,
): void {
    try {
        const root = html instanceof HTMLElement ? html : resolveHtmlRoot(html);
        if (!root) return;

        const thEnabled = game.settings!.get(MODULE_ID, "enableTargetHelper") as boolean;
        const masterEnabled = game.settings!.get(MODULE_ID, "enableCustomRules") as boolean;

        // Find the PRAD setting row and disable it if Target Helper is off
        const pradInput = root.querySelector<HTMLInputElement>(
            `input[name="${MODULE_ID}.playersRollAllDice"]`,
        );
        if (pradInput) {
            const shouldDisable = !thEnabled || !masterEnabled;
            pradInput.disabled = shouldDisable;
            if (shouldDisable) {
                pradInput.closest(".form-group")?.classList.add("disabled");
                pradInput.title = game.i18n!.localize(
                    "codex-foundry.settings.playersRollAllDice.requiresTargetHelper",
                );
            }
        }

        // Find the Target Helper setting row and disable it if master is off
        const thInput = root.querySelector<HTMLInputElement>(
            `input[name="${MODULE_ID}.enableTargetHelper"]`,
        );
        if (thInput && !masterEnabled) {
            thInput.disabled = true;
            thInput.closest(".form-group")?.classList.add("disabled");
        }

        // Find the Heroic Rerolls setting row and disable it if master is off
        const heroicRerollsInput = root.querySelector<HTMLInputElement>(
            `input[name="${MODULE_ID}.heroicRerolls"]`,
        );
        if (heroicRerollsInput && !masterEnabled) {
            heroicRerollsInput.disabled = true;
            heroicRerollsInput.closest(".form-group")?.classList.add("disabled");
        }

        // Find the Vault Sync setting row and disable it if master is off
        const syncInput = root.querySelector<HTMLInputElement>(
            `input[name="${MODULE_ID}.${SETTING_ENABLE_SYNC}"]`,
        );
        if (syncInput && !masterEnabled) {
            syncInput.disabled = true;
            syncInput.closest(".form-group")?.classList.add("disabled");
        }

        // Disable the strict DC setting when PRAD is off
        const pradEnabled = game.settings!.get(MODULE_ID, "playersRollAllDice") as boolean;
        const strictInput = root.querySelector<HTMLInputElement>(
            `input[name="${MODULE_ID}.pradStrictDCs"]`,
        );
        if (strictInput && (!pradEnabled || !masterEnabled)) {
            strictInput.disabled = true;
            strictInput.closest(".form-group")?.classList.add("disabled");
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Error in renderSettingsConfig hook`, err);
    }
}

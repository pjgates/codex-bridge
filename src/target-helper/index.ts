/**
 * Target Helper — Main Module
 *
 * A simplified port of PF2e Toolbelt's "Target Helper" feature.
 * Shows per-target save rows on spell, area, check, and action chat cards.
 * Also supports PRAD attack cards with per-target armor saves.
 *
 * Architecture:
 *   1. preCreateChatMessage: detect message type → store targets + save data in flags
 *   2. renderChatMessageHTML: read flags → inject per-target rows + custom buttons
 *   3. Player clicks save → roll with createMessage:false → store result in flags
 *   4. Flag update → message re-renders → inline results appear
 */

import { MODULE_ID } from "../constants.js";
import { setSourceFlag, getCurrentTargetUUIDs, getFlagData } from "./flags.js";
import {
    isAreaMessage, prepareAreaMessage,
    isSpellMessage, prepareSpellMessage,
    isCheckMessage, prepareCheckMessage,
    isActionMessage, prepareActionMessage,
} from "./detect.js";
import { registerTargetHelperTemplates, onRenderTargetHelper } from "./render.js";
import type { TargetHelperFlagData } from "./types.js";

// ─── Module-scoped PRAD state (set by ready.ts, not imported from prad/) ─────

/**
 * Whether PRAD overcome mode is active. Set by `setPradOvercomeEnabled()`
 * from ready.ts, breaking the circular dependency between Target Helper
 * and PRAD subsystems.
 */
let _pradOvercomeEnabled = false;

/**
 * Set whether PRAD overcome mode should be used for Target Helper messages.
 * Called from ready.ts before activateTargetHelper().
 */
export function setPradOvercomeEnabled(enabled: boolean): void {
    _pradOvercomeEnabled = enabled;
}

// ─── Initialization (call during init hook) ──────────────────────────────────

/**
 * Register templates for the target helper. Call during init.
 */
export function initTargetHelper(): void {
    registerTargetHelperTemplates();
    console.log(`${MODULE_ID} | Target Helper: Templates registered`);
}

// ─── Hook Registration (call during ready hook) ──────────────────────────────

/**
 * Activate the target helper hooks. Call during ready hook
 * after confirming that the feature should be enabled.
 */
export function activateTargetHelper(): void {
    // Check if PF2e Toolbelt's Target Helper is already active
    // to avoid duplicate processing for standard message types
    const sf2eG = game as Sf2eGame;
    const toolbelt = sf2eG.modules?.get("pf2e-toolbelt");
    const toolbeltActive = toolbelt?.active ?? false;
    let toolbeltTargetHelper = false;
    if (toolbeltActive) {
        try {
            toolbeltTargetHelper = !!sf2eG.settings?.get("pf2e-toolbelt", "target-helper.enabled");
        } catch {
            // Setting doesn't exist — Toolbelt version may not have it, or it uses a different key
            toolbeltTargetHelper = false;
        }
    }

    // Wrap async render handler for Foundry's hook system (expects void return)
    const renderHook = (
        message: ChatMessage.Implementation,
        html: JQuery<HTMLElement> | HTMLElement,
        data: object
    ): void => {
        void onRenderTargetHelper(message, html, data as Record<string, unknown>);
    };

    if (toolbeltTargetHelper) {
        console.log(`${MODULE_ID} | Target Helper: PF2e Toolbelt's Target Helper is active — only handling PRAD cards`);
        // Foundry V14 renders chat messages through renderChatMessageHTML.
        Hooks.on("renderChatMessageHTML", renderHook);
        Hooks.on("preCreateChatMessage", onPreCreatePradOnly);
    } else {
        console.log(`${MODULE_ID} | Target Helper: Registering all hooks`);
        Hooks.on("preCreateChatMessage", onPreCreateChatMessage);
        Hooks.on("renderChatMessageHTML", renderHook);
    }

    console.log(`${MODULE_ID} | Target Helper: Hooks activated`);
}

// ─── preCreateChatMessage Hook ───────────────────────────────────────────────

/**
 * Full hook: handles all message types (spell, area, check, action).
 * Used when PF2e Toolbelt Target Helper is NOT active.
 */
function onPreCreateChatMessage(
    message: ChatMessage.Implementation,
    _data: object,
    _options: object,
    _userId: string,
): void {
    try {
        // Skip check rolls (they already have their own result)
        const sf2eMsg = message as Sf2eChatMessage;
        if (sf2eMsg.isCheckRoll) return;

        // Skip if this message already has our flag data
        if (getFlagData(message)) return;

        let flagData: Partial<TargetHelperFlagData> | null = null;

        // Detect message type and extract save data
        if (isAreaMessage(message)) {
            flagData = prepareAreaMessage(message);
        } else if (isSpellMessage(message)) {
            flagData = prepareSpellMessage(message);
        } else if (isCheckMessage(message)) {
            flagData = prepareCheckMessage(message);
        } else if (isActionMessage(message)) {
            flagData = prepareActionMessage(message);
        }

        if (!flagData) return;

        // Add current targets if none were specified
        if (!flagData.targets?.length) {
            flagData.targets = getCurrentTargetUUIDs();
        }

        // PRAD Inversion 2: If PRAD overcome mode is active and the caster is a PC
        // with a save, set pradOvercome mode so the PC rolls Overcome against each
        // NPC's Save DC instead of each NPC rolling their save against the PC's Spell DC.
        if (flagData.save && _pradOvercomeEnabled) {
            const caster = sf2eMsg.actor;
            if (caster && (caster.type as string) === "character") {
                flagData.pradOvercome = true;
            }
        }

        // Store the flag data on the message before creation
        setSourceFlag(message, flagData);
    } catch (err) {
        console.error(`${MODULE_ID} | Target Helper: Error in preCreateChatMessage hook`, err);
    }
}

/**
 * Minimal hook: only handles PRAD attack cards.
 * Used when PF2e Toolbelt Target Helper IS active (it handles the rest).
 */
function onPreCreatePradOnly(
    message: ChatMessage.Implementation,
    _data: object,
    _options: object,
    _userId: string,
): void {
    try {
        // Only handle PRAD attack cards
        const flags = message.flags as Sf2eMessageFlags;
        const pradFlags = flags?.[MODULE_ID];
        if (!pradFlags || pradFlags.pradType !== "attack-card") return;

        // Skip if already has target helper data
        if (getFlagData(message)) return;

        // Legacy cards without embedded target-helper data must not snapshot
        // ambient targets after creation; only explicitly captured targets are safe.
        const targets: string[] = [];

        const flagData: Partial<TargetHelperFlagData> = {
            type: "prad-attack",
            targets,
            save: {
                statistic: "ac",
                dc: pradFlags.attackDC as number,
                basic: false,
            },
            author: typeof pradFlags.attackerId === "string" ? game.actors?.get(pradFlags.attackerId)?.uuid : undefined,
        };

        setSourceFlag(message, flagData);
    } catch (err) {
        console.error(`${MODULE_ID} | Target Helper: Error in preCreatePradOnly hook`, err);
    }
}

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { registerTargetHelperTemplates } from "./render.js";
export { canUpdateMessage, getCurrentTargetUUIDs, getFlagData, updateTargets } from "./flags.js";
export { createTargetRevision, normalizeTargetHelperFlagData } from "./result-validation.js";
export {
    rollArmorSave,
    rollNpcSaves,
    rollOvercomeAll,
    rollOvercomeForActiveTokens,
    rollOvercomeForTargets,
    rollSaveForActiveTokens,
    rollSavesForTargets,
} from "./save-roll.js";
export type { TargetHelperFlagData, SaveResultData } from "./types.js";

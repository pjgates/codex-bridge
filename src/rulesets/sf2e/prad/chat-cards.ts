/**
 * PRAD (Players Roll All Dice) — Chat Card Rendering
 *
 * Creates and renders custom chat messages for armor save and
 * overcome check results.
 */

import { MODULE_ID } from "../../../constants.js";
import { ARMOR_SAVE_NPC_EFFECT_KEYS, OVERCOME_NPC_EFFECT_KEYS } from "./degree-of-success.js";
import type { DegreeOfSuccessIndex, PradRollResult } from "./types.js";

// ─── Template paths (relative to module root) ────────────────────────────────

const TEMPLATE_ARMOR_SAVE = `modules/${MODULE_ID}/dist/templates/prad/armor-save.hbs`;
const TEMPLATE_OVERCOME = `modules/${MODULE_ID}/dist/templates/prad/overcome.hbs`;

/**
 * Pre-load Handlebars templates during the `init` hook.
 */
export function registerPradTemplates(): void {
    foundry.applications.handlebars.loadTemplates([TEMPLATE_ARMOR_SAVE, TEMPLATE_OVERCOME]);
    console.log(`${MODULE_ID} | PRAD: Chat card templates registered`);
}

// ─── Degree-of-success CSS class mapping ─────────────────────────────────────

const DEGREE_CSS: Record<DegreeOfSuccessIndex, string> = {
    0: "critical-failure",
    1: "failure",
    2: "success",
    3: "critical-success",
};

const DEGREE_LABEL_KEYS: Record<DegreeOfSuccessIndex, string> = {
    0: "sf2e-forge-custom.prad.resultCriticalFailure",
    1: "sf2e-forge-custom.prad.resultFailure",
    2: "sf2e-forge-custom.prad.resultSuccess",
    3: "sf2e-forge-custom.prad.resultCriticalSuccess",
};

/**
 * Determine a CSS class for the d20 die based on its natural value.
 */
function getDieClass(dieResult: number): string {
    if (dieResult === 20) return "nat20";
    if (dieResult === 1) return "nat1";
    return "normal";
}

// ─── Chat Message Creation ───────────────────────────────────────────────────

/**
 * Create a PRAD chat message from a roll result.
 *
 * @param result  The complete PRAD roll result
 * @param roll    The Foundry Roll object (for roll display/storage)
 */
export async function createPradChatMessage(
    result: PradRollResult,
    roll: Roll
): Promise<void> {
    const isArmorSave = result.type === "armor-save";
    const templatePath = isArmorSave ? TEMPLATE_ARMOR_SAVE : TEMPLATE_OVERCOME;

    // Get the NPC-side effect label
    const npcEffectKeys = isArmorSave ? ARMOR_SAVE_NPC_EFFECT_KEYS : OVERCOME_NPC_EFFECT_KEYS;
    const npcEffectLabel = game.i18n!.localize(npcEffectKeys[result.npcDegree]);
    const playerDegreeLabel = game.i18n!.localize(DEGREE_LABEL_KEYS[result.playerDegree]);
    const overcomeContext = isArmorSave ? undefined : game.i18n!.format("sf2e-forge-custom.prad.overcomeLabel", {
        name: result.roller.name,
        npcName: result.npc.name,
        saveType: result.source,
    });

    // Build template data
    const templateData = {
        // Actor names
        rollerName: result.roller.name,
        npcName: result.npc.name,

        // Source context
        weaponName: result.source,
        overcomeContext,

        // Roll numbers
        dc: result.dc,
        modifier: result.modifier,
        dieResult: result.dieResult,
        total: result.total,

        // Degree of success
        playerDegreeLabel,
        npcEffectLabel,
        degreeClass: DEGREE_CSS[result.playerDegree],
        dieClass: getDieClass(result.dieResult),
    };

    // Render the template
    const content = await foundry.applications.handlebars.renderTemplate(templatePath, templateData);

    // Build the chat message data
    const fGlobal = foundry as unknown as Sf2eFoundryGlobal;
    const messageData: Record<string, unknown> = {
        content,
        speaker: {
            actor: result.roller.actorId,
            token: result.roller.tokenId,
            alias: result.roller.name,
        },
        rolls: [roll.toJSON()],
        flags: {
            [MODULE_ID]: {
                pradType: result.type,
                pradResult: result,
            },
        },
        type: fGlobal.CONST?.CHAT_MESSAGE_TYPES?.OTHER ?? 0,
    };

    await ChatMessage.create(messageData);
}

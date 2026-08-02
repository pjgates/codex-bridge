/**
 * Target Helper — Message Type Detection (Imperative Shell)
 *
 * Thin Foundry-coupled layer that reads data from ChatMessage objects
 * and delegates classification to pure functions in shared/detect-logic.ts.
 *
 * Ported from PF2e Toolbelt's Target Helper detection logic.
 */

import {
    classifyCheckParams,
    classifyInlineCheck,
    classifySpell,
    findSaveLinksInContent,
    isAreaContextType,
    PROMPT_CHECK_REGEX,
    REPOST_CHECK_REGEX,
    type InlineCheckDataset,
    type SpellData,
} from "../../../shared/detect-logic.js";
import { getSystemFlags } from "../../../shared/flags.js";
import type {
    TargetHelperFlagData,
} from "./types.js";

// ─── Area Message Detection ──────────────────────────────────────────────────

/**
 * Check if a message is an area/autofire message.
 */
export function isAreaMessage(message: ChatMessage.Implementation): boolean {
    const flags = getSystemFlags(message);
    const contextType = flags?.context?.type ?? "";
    return isAreaContextType(contextType);
}

/**
 * Extract save data from an area message.
 */
export function prepareAreaMessage(
    message: ChatMessage.Implementation,
): Partial<TargetHelperFlagData> | null {
    const sf2eMsg = message as Sf2eChatMessage;
    const item = sf2eMsg.item;
    if (!item) return null;

    const actor = item.actor as Sf2eActor | undefined;
    if (!actor) return null;

    // Find the strike action that uses this item
    const sys = actor.system as Sf2eActorSystemData;
    const itemImpl = item as Item.Implementation;
    const strike = sys?.actions?.find((s) => s.item === itemImpl);
    if (!strike) return null;

    const statistic = strike.statistic ?? strike.altUsages?.[0]?.statistic;
    if (!statistic?.dc?.value) return null;

    return {
        type: "area",
        author: actor.uuid,
        item: (item as Item.Implementation).uuid,
        save: {
            statistic: "reflex",
            dc: statistic.dc.value,
            basic: true,
        },
        options: ["damaging-effect", "area-damage", "area-effect"],
    };
}

// ─── Spell Message Detection ─────────────────────────────────────────────────

/**
 * Check if a message is a spell message.
 */
export function isSpellMessage(message: ChatMessage.Implementation): boolean {
    const sf2eMsg = message as Sf2eChatMessage;
    const item = sf2eMsg.item;
    if (!item) return false;
    return item.isOfType?.("spell") || item.isOfType?.("consumable") || false;
}

/**
 * Extract save data from a spell message.
 * Reads Foundry data, then delegates classification to the pure function.
 */
export function prepareSpellMessage(
    message: ChatMessage.Implementation,
): Partial<TargetHelperFlagData> | null {
    const sf2eMsg = message as Sf2eChatMessage;
    const item = sf2eMsg.item;
    if (!item) return null;

    // Get the spell (might be embedded in a consumable)
    const spell: Sf2eItem | null | undefined = item.isOfType?.("spell")
        ? item
        : item.isOfType?.("consumable")
          ? item.embeddedSpell
          : null;
    if (!spell) return null;

    // Read Foundry data into plain values
    const spellSys = spell.system as Sf2eSpellSystemData | undefined;
    const spellData: SpellData = {
        statistic: spellSys?.defense?.save?.statistic,
        dc: spell.embeddedSpell?.spellcasting?.statistic?.dc?.value
            ?? (spell as Sf2eItem & { spellcasting?: { statistic?: Sf2eStatistic } }).spellcasting?.statistic?.dc?.value,
        basic: !!spellSys?.defense?.save?.basic,
        spellUuid: (spell as Item.Implementation).uuid,
    };

    // Delegate to pure classifier
    const result = classifySpell(spellData);
    if (!result) return null;

    return {
        type: "spell",
        save: result.save,
        item: result.item,
    };
}

// ─── Check Message Detection ─────────────────────────────────────────────────

/**
 * Check if a message is an inline check message.
 */
export function isCheckMessage(message: ChatMessage.Implementation): boolean {
    return getCheckData(message) !== null;
}

/**
 * Extract check data from an inline check message.
 */
export function prepareCheckMessage(
    message: ChatMessage.Implementation,
): Partial<TargetHelperFlagData> | null {
    const data = getCheckData(message);
    if (!data) return null;

    const sf2eMsg = message as Sf2eChatMessage;
    return {
        type: "check",
        save: data.save,
        author: sf2eMsg.actor?.uuid,
        item: data.item,
        options: data.options,
    };
}

function getCheckData(
    message: ChatMessage.Implementation,
): { save: { statistic: string; dc: number; basic: boolean }; item?: string; options: string[] } | null {
    const sf2eMsg = message as Sf2eChatMessage;
    const content = sf2eMsg.content ?? "";

    // Try @Check[...] prompt format
    const promptMatch = content.match(PROMPT_CHECK_REGEX);
    if (promptMatch) {
        return classifyCheckParams(promptMatch[1]);
    }

    // Try reposted inline check link format
    const repostMatch = content.match(REPOST_CHECK_REGEX);
    if (repostMatch) {
        return resolveInlineCheckLink(repostMatch[1]);
    }

    return null;
}

// ─── Action Message Detection ────────────────────────────────────────────────

/**
 * Check if a message is an action message (non-spell ability with inline save).
 */
export function isActionMessage(message: ChatMessage.Implementation): boolean {
    const flags = getSystemFlags(message);
    if (!flags) return false;

    const sf2eMsg = message as Sf2eChatMessage;
    const item = sf2eMsg.item;
    if (!item) return false;

    return item.isOfType?.("action") || item.isOfType?.("feat") || false;
}

/**
 * Extract save data from an action message.
 * Looks for a single inline save link in the message content.
 */
export function prepareActionMessage(
    message: ChatMessage.Implementation,
): Partial<TargetHelperFlagData> | null {
    const sf2eMsg = message as Sf2eChatMessage;
    const content = sf2eMsg.content ?? "";
    const matches = findSaveLinksInContent(content);

    // Only handle if there's exactly one save link
    if (matches.length !== 1) {
        return { type: "action" };
    }

    const linkData = resolveInlineCheckLink(matches[0]);
    if (!linkData) return { type: "action" };

    return {
        type: "action",
        save: linkData.save,
        author: sf2eMsg.actor?.uuid,
        item: linkData.item,
        options: linkData.options,
    };
}

// ─── Foundry-Coupled Helpers ─────────────────────────────────────────────────

/**
 * Parse an inline-check anchor HTML string, resolve Foundry UUIDs,
 * then delegate classification to the pure function.
 */
function resolveInlineCheckLink(
    html: string,
): { save: { statistic: string; dc: number; basic: boolean }; item?: string; options: string[] } | null {
    // Parse HTML to extract dataset
    const div = document.createElement("div");
    div.innerHTML = html;
    const anchor = div.querySelector("a.inline-check") as HTMLAnchorElement | null;
    if (!anchor) return null;

    const ds = anchor.dataset as Record<string, string>;

    // Build the dataset for the pure classifier
    const checkDataset: InlineCheckDataset = {
        pf2Check: ds.pf2Check,
        pf2Dc: ds.pf2Dc,
        pf2Adjustment: ds.pf2Adjustment,
        against: ds.against,
        itemUuid: ds.itemUuid,
        isBasic: ds.isBasic,
        pf2RollOptions: ds.pf2RollOptions,
        anchorText: anchor.textContent ?? undefined,
    };

    // If DC needs resolution via Foundry (against + itemUuid), do it here
    if (!ds.pf2Dc && ds.against && ds.itemUuid) {
        const resolvedItem = fromUuidSync(ds.itemUuid) as Sf2eItem | null;
        const actor = resolvedItem?.actor as Sf2eActor | undefined;
        const stat = actor?.getStatistic?.(ds.against);
        checkDataset.resolvedDc = stat?.dc?.value;
    }

    return classifyInlineCheck(checkDataset);
}

export { getSystemFlags } from "../../../shared/flags.js";

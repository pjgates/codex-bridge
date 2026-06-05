/**
 * Pure Detection Logic (Functional Core)
 *
 * Stateless, pure functions that classify messages and extract save
 * information from plain data objects — no Foundry API calls.
 * All Foundry reads happen in the imperative shell (detect.ts).
 */

import { SAVE_TYPES, type SaveType } from "./types.js";
import type { SaveInfo } from "./types.js";

// ─── Regex Patterns ──────────────────────────────────────────────────────────

/** Matches @Check[type|dc:X|...] inline check macros. */
export const PROMPT_CHECK_REGEX = /^(?:<p>)?@Check\[([^\]]+)\](?:\{([^}]+)\})?(?:<\/p>)?$/;

/** Matches reposted inline check links. */
export const REPOST_CHECK_REGEX =
    /^(?:<span data-visibility="\w+">.+?<\/span> ?)?(<a class="inline-check.+?<\/a>)$/;

/** Matches inline save links in action descriptions. */
export const SAVE_LINK_REGEX =
    /<a class="inline-check.+?".+?data-pf2-check="(?:reflex|will|fortitude)".+?<\/a>/g;

// ─── Area Classification ─────────────────────────────────────────────────────

const AREA_TYPES = [
    "area-save",
    "area-damage",
    "auto-fire",
    "autofire",
    "area-effect",
];

/**
 * Pure check: is this context type an area/autofire context?
 * @param contextType - the `flags.context.type` string from the message
 */
export function isAreaContextType(contextType: string): boolean {
    return contextType === "area-fire" || AREA_TYPES.some((t) => contextType.includes(t));
}

// ─── Spell Classification ────────────────────────────────────────────────────

/** Input shape for classifying a spell message. */
export interface SpellData {
    /** The save statistic from `spell.system.defense.save.statistic` */
    statistic: string | undefined;
    /** The DC from `spell.spellcasting.statistic.dc.value` */
    dc: number | undefined;
    /** Whether the save is basic, from `spell.system.defense.save.basic` */
    basic: boolean;
    /** The spell's UUID */
    spellUuid: string | undefined;
}

/**
 * Pure classifier: extract save info from pre-read spell data.
 * Returns null if the spell doesn't have a valid save.
 */
export function classifySpell(data: SpellData): { save: SaveInfo; item?: string } | null {
    if (typeof data.dc !== "number") return null;
    if (!data.statistic) return null;
    if (!SAVE_TYPES.includes(data.statistic as SaveType)) return null;

    return {
        save: {
            statistic: data.statistic,
            dc: data.dc,
            basic: data.basic,
        },
        item: data.spellUuid,
    };
}

// ─── Inline Check Classification ─────────────────────────────────────────────

/**
 * Parse @Check[param1|param2|...] parameter string.
 * Pure function — operates on raw string input only.
 */
export function parseCheckParams(paramString: string): Record<string, string> | null {
    const params: Record<string, string> = {};
    const parts = paramString.includes("|")
        ? paramString.split("|")
        : paramString.split(/\s+/);

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;

        if (part.includes(":")) {
            const [key, ...rest] = part.split(":");
            params[key.trim()] = rest.join(":").trim();
        } else if (i === 0) {
            params.type = part;
        } else {
            params[part] = "true";
        }
    }
    return Object.keys(params).length > 0 ? params : null;
}

/**
 * Pure classifier: try to extract save data from a @Check[...] parameter string.
 */
export function classifyCheckParams(
    paramString: string,
): { save: SaveInfo; options: string[] } | null {
    const params = parseCheckParams(paramString);
    if (!params) return null;

    const statistic = params.type?.trim();
    const dc = Number(params.dc);
    if (!SAVE_TYPES.includes(statistic as SaveType) || isNaN(dc)) return null;

    const basic = "basic" in params;
    return {
        save: { statistic, dc, basic },
        options: basic ? ["damaging-effect"] : [],
    };
}

// ─── Inline-Check Anchor Data Extraction ─────────────────────────────────────

/** Pre-parsed data from an inline-check anchor element's dataset. */
export interface InlineCheckDataset {
    pf2Check?: string;
    pf2Dc?: string;
    pf2Adjustment?: string;
    against?: string;
    itemUuid?: string;
    isBasic?: string;
    pf2RollOptions?: string;
    anchorText?: string;
    /** Pre-resolved DC (if `against` was used, resolved via Foundry before calling). */
    resolvedDc?: number;
}

/**
 * Pure classifier: extract save info from pre-parsed inline-check data.
 * The caller resolves any UUIDs/statistics; this just classifies.
 */
export function classifyInlineCheck(
    dataset: InlineCheckDataset,
): { save: SaveInfo; item?: string; options: string[] } | null {
    const checkType = dataset.pf2Check;
    if (!checkType || !SAVE_TYPES.includes(checkType as SaveType)) return null;

    let dc: number | undefined;
    if (dataset.pf2Dc) {
        dc = Number(dataset.pf2Dc) + (Number(dataset.pf2Adjustment) || 0);
    } else if (dataset.resolvedDc != null) {
        dc = dataset.resolvedDc + (Number(dataset.pf2Adjustment) || 0);
    }

    if (dc == null || isNaN(dc)) return null;

    const isBasic =
        dataset.isBasic != null ||
        !!dataset.anchorText?.toLowerCase().includes("basic");

    return {
        save: {
            statistic: checkType,
            dc,
            basic: isBasic,
        },
        item: dataset.itemUuid,
        options: dataset.pf2RollOptions?.split(",").filter(Boolean) ?? [],
    };
}

// ─── Action Classification ───────────────────────────────────────────────────

/**
 * Pure classifier: given message HTML content, count inline save links.
 * Returns the matched HTML strings (or empty array).
 */
export function findSaveLinksInContent(content: string): string[] {
    // Reset lastIndex for global regex
    SAVE_LINK_REGEX.lastIndex = 0;
    return content.match(SAVE_LINK_REGEX) ?? [];
}

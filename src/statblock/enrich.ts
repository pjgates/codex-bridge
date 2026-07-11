import { sanitizeFoundryHtml } from "./sanitize.js";
/**
 * PF2e inline enricher post-processor.
 *
 * Transforms plain-text ability descriptions into Foundry VTT HTML
 * with PF2e system enrichers (@Check, @Damage, @Template, @UUID).
 *
 * Processing order:
 *   1. Inline enrichers (checks, damage, templates, conditions)
 *   2. Structural formatting (degree-of-success / trigger-effect blocks)
 *   3. Paragraph wrapping
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_ID = "sf2e";

/** Damage types recognised by PF2e / SF2e. */
const DAMAGE_TYPES = [
    "piercing",
    "slashing",
    "bludgeoning",
    "fire",
    "cold",
    "electricity",
    "acid",
    "sonic",
    "force",
    "mental",
    "poison",
    "bleed",
    "vitality",
    "spirit",
    "void",
] as const;

/** Conditions that take a numeric value (e.g. "frightened 1"). */
const VALUED_CONDITIONS = [
    "frightened",
    "sickened",
    "stunned",
    "slowed",
    "clumsy",
    "enfeebled",
    "drained",
    "stupefied",
    "doomed",
    "wounded",
    "dying",
] as const;

/**
 * Valueless conditions safe to auto-link.
 *
 * Deliberately excludes ambiguous English words like "hidden", "broken",
 * "confused", "controlled", "observed" to avoid false positives.
 */
const VALUELESS_CONDITIONS = [
    "off-guard",
    "blinded",
    "deafened",
    "paralyzed",
    "petrified",
    "immobilized",
    "grabbed",
    "restrained",
    "fascinated",
    "fleeing",
    "unconscious",
    "invisible",
    "quickened",
    "prone",
    "dazzled",
    "fatigued",
    "encumbered",
] as const;

/** Map condition text → Compendium item name (PascalCase). */
const CONDITION_ITEM_MAP: Record<string, string> = {
    "off-guard": "Off-Guard",
    blinded: "Blinded",
    deafened: "Deafened",
    paralyzed: "Paralyzed",
    petrified: "Petrified",
    immobilized: "Immobilized",
    grabbed: "Grabbed",
    restrained: "Restrained",
    fascinated: "Fascinated",
    fleeing: "Fleeing",
    unconscious: "Unconscious",
    invisible: "Invisible",
    quickened: "Quickened",
    prone: "Prone",
    dazzled: "Dazzled",
    fatigued: "Fatigued",
    encumbered: "Encumbered",
    frightened: "Frightened",
    sickened: "Sickened",
    stunned: "Stunned",
    slowed: "Slowed",
    clumsy: "Clumsy",
    enfeebled: "Enfeebled",
    drained: "Drained",
    stupefied: "Stupefied",
    doomed: "Doomed",
    wounded: "Wounded",
    dying: "Dying",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enrich a plain-text ability description with PF2e inline enrichers
 * and structure it into proper Foundry HTML.
 *
 * Safe to call on any string — returns `""` for empty/whitespace input
 * and leaves text that contains no recognisable patterns unchanged
 * (other than paragraph wrapping).
 */
export function enrichDescription(raw: string): string {
    const text = raw.trim();
    if (!text) return "";

    // 1. Inline enrichers (order: checks → damage → templates → conditions)
    let enriched = enrichChecks(text);
    enriched = enrichDamage(enriched);
    enriched = enrichTemplates(enriched);
    enriched = enrichConditions(enriched);

    return sanitizeFoundryHtml(formatHtml(enriched).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>"));
}

// ---------------------------------------------------------------------------
// Inline enrichers
// ---------------------------------------------------------------------------

/**
 * `DC X [basic] Fortitude/Reflex/Will save` → `@Check[type|dc:X] save`
 */
export function enrichChecks(text: string): string {
    return text.replace(
        /DC\s+(\d+)\s+(basic\s+)?(Fortitude|Reflex|Will)\s+(sav(?:e|ing throw))/gi,
        (_match, dc: string, basic: string | undefined, type: string, saveWord: string) => {
            const checkType = type.toLowerCase();
            const basicPart = basic?.trim() ? "|basic" : "";
            return `@Check[${checkType}|dc:${dc}${basicPart}] ${saveWord}`;
        },
    );
}

/**
 * `XdY[±Z] <type> damage` → `@Damage[formula[type]] damage`
 *
 * Formulas with modifiers are wrapped in parens per PF2e convention:
 * `2d6+3 fire damage` → `@Damage[(2d6+3)[fire]] damage`
 */
export function enrichDamage(text: string): string {
    const typePattern = DAMAGE_TYPES.join("|");
    const re = new RegExp(
        `(\\d+d\\d+(?:[+-]\\d+)?)\\s+(${typePattern})\\s+damage`,
        "gi",
    );
    return text.replace(re, (_match, formula: string, type: string) => {
        const wrapped = /[+-]/.test(formula) ? `(${formula})` : formula;
        return `@Damage[${wrapped}[${type.toLowerCase()}]] damage`;
    });
}

/**
 * `X-foot cone/burst/emanation/line` → `@Template[type:shape|distance:X]`
 */
export function enrichTemplates(text: string): string {
    return text.replace(
        /(\d+)-foot\s+(cone|burst|emanation|line|square)/gi,
        (_match, distance: string, type: string) =>
            `@Template[type:${type.toLowerCase()}|distance:${distance}]`,
    );
}

/**
 * Condition names → `@UUID[Compendium.sf2e.conditions.Item.X]{display}`
 *
 * Handles both valued conditions ("frightened 1") and select valueless
 * conditions ("off-guard", "blinded", …).
 */
export function enrichConditions(text: string): string {
    let result = text;

    // Valued conditions: "frightened 1", "sickened 2", etc.
    for (const cond of VALUED_CONDITIONS) {
        const itemName = CONDITION_ITEM_MAP[cond];
        const re = new RegExp(`\\b(${cond})\\s+(\\d+)\\b`, "gi");
        result = result.replace(re, (_match, name: string, value: string) => {
            return `@UUID[Compendium.${SYSTEM_ID}.conditions.Item.${itemName}]{${capitalise(name)} ${value}}`;
        });
    }

    // Valueless conditions: "off-guard", "blinded", etc.
    for (const cond of VALUELESS_CONDITIONS) {
        const itemName = CONDITION_ITEM_MAP[cond];
        // Escape hyphens for regex
        const escaped = cond.replace(/-/g, "\\-");
        const re = new RegExp(`\\b${escaped}\\b`, "gi");
        result = result.replace(re, (match) => {
            return `@UUID[Compendium.${SYSTEM_ID}.conditions.Item.${itemName}]{${match}}`;
        });
    }

    return result;
}

// ---------------------------------------------------------------------------
// Structural formatting
// ---------------------------------------------------------------------------

/**
 * Convert enriched text into Foundry HTML.
 *
 * Detects three patterns:
 * 1. **Degree of success** — splits at Critical Success / Success / Failure /
 *    Critical Failure markers, inserts `<hr />` before the first degree.
 * 2. **Trigger / Effect blocks** — splits at Trigger / Effect / Requirements /
 *    Frequency markers, inserts `<hr />` before Effect.
 * 3. **Plain text** — wraps paragraphs in `<p>` tags.
 */
function formatHtml(text: string): string {
    if (/\*\*(Critical Success|Success|Failure|Critical Failure)\*\*/.test(text)) {
        return formatWithDegrees(text);
    }
    if (/\*\*(Trigger|Effect|Requirements|Frequency)\*\*/.test(text)) {
        return formatWithBlocks(text);
    }
    return wrapParagraphs(text);
}

/**
 * Format text containing degree-of-success markers.
 *
 * ```
 * <p>Preamble text…</p>
 * <hr />
 * <p><strong>Critical Success</strong> …</p>
 * <p><strong>Success</strong> …</p>
 * <p><strong>Failure</strong> …</p>
 * <p><strong>Critical Failure</strong> …</p>
 * ```
 */
function formatWithDegrees(text: string): string {
    const degreeRe = /\*\*(Critical Success|Success|Failure|Critical Failure)\*\*/g;
    const matches = [...text.matchAll(degreeRe)];
    if (matches.length === 0) return wrapParagraphs(text);

    const parts: string[] = [];

    // Preamble (text before first degree marker)
    const preamble = text.slice(0, matches[0].index!).trim();
    if (preamble) {
        parts.push(`<p>${preamble}</p>`);
    }

    parts.push("<hr />");

    // Each degree of success
    for (let i = 0; i < matches.length; i++) {
        const label = matches[i][1];
        const contentStart = matches[i].index! + matches[i][0].length;
        const contentEnd = i + 1 < matches.length ? matches[i + 1].index! : text.length;
        const content = text.slice(contentStart, contentEnd).trim();
        parts.push(`<p><strong>${label}</strong> ${content}</p>`);
    }

    return parts.join("\n");
}

/**
 * Format text containing Trigger / Effect / Requirements / Frequency blocks.
 *
 * ```
 * <p><strong>Trigger</strong> …</p>
 * <hr />
 * <p><strong>Effect</strong> …</p>
 * ```
 */
function formatWithBlocks(text: string): string {
    const blockRe = /\*\*(Trigger|Effect|Requirements|Frequency)\*\*/g;
    const matches = [...text.matchAll(blockRe)];
    if (matches.length === 0) return wrapParagraphs(text);

    const parts: string[] = [];

    // Preamble (text before first block marker — rare but possible)
    const preamble = text.slice(0, matches[0].index!).trim();
    if (preamble) {
        parts.push(`<p>${preamble}</p>`);
    }

    for (let i = 0; i < matches.length; i++) {
        const label = matches[i][1];
        const contentStart = matches[i].index! + matches[i][0].length;
        const contentEnd = i + 1 < matches.length ? matches[i + 1].index! : text.length;
        const content = text.slice(contentStart, contentEnd).trim();

        // Insert <hr /> before the Effect block
        if (label === "Effect") {
            parts.push("<hr />");
        }

        parts.push(`<p><strong>${label}</strong> ${content}</p>`);
    }

    return parts.join("\n");
}

/** Wrap plain text into `<p>` tags, splitting on double newlines. */
function wrapParagraphs(text: string): string {
    return text
        .split(/\n\n+/)
        .map((p) => `<p>${p.trim()}</p>`)
        .join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalise(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

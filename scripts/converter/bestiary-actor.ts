import { generateId } from "./ids.js";
import { enrichDescription } from "./enrich.js";
import { sanitizeFoundryHtml } from "./sanitize.js";
import type {
    AbilityEntry,
    CreatureStatblock,
    LoreSkillData,
    ParsedCreature,
    SpellcastingEntry,
    StrikeData,
} from "./bestiary-types.js";

const MODULE_ID = "sf2e-forge-custom";

// ---------------------------------------------------------------------------
// Action icons → PF2e action type mapping
// ---------------------------------------------------------------------------

const ACTION_ICON_MAP: Record<string, { actionType: string; actions: number | null }> = {
    "⬻": { actionType: "action", actions: 1 },
    "⬺": { actionType: "action", actions: 2 },
    "⬽": { actionType: "action", actions: 3 },
    "⬲": { actionType: "reaction", actions: null },
    "⭓": { actionType: "free", actions: null },
};

/**
 * Parse action type from ability name.
 * Names may include an icon prefix like "⬻ Shield Block" or "⬲ Attack of Opportunity".
 * Returns the clean name plus the derived action type.
 */
function parseActionFromName(raw: string): {
    cleanName: string;
    actionType: string;
    actions: number | null;
} {
    for (const [icon, mapping] of Object.entries(ACTION_ICON_MAP)) {
        if (raw.startsWith(icon)) {
            return {
                cleanName: raw.slice(icon.length).trim(),
                ...mapping,
            };
        }
    }
    return { cleanName: raw, actionType: "passive", actions: null };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a Foundry VTT NPC actor document from a parsed creature.
 *
 * Produces a top-level actor with `system` data (abilities, attributes,
 * saves, skills, perception, traits, details) and an `items` array
 * containing melee strikes, action abilities, spellcasting entries,
 * and lore skills.
 */
export function buildActorDocument(creature: ParsedCreature): Record<string, unknown> {
    const sb = creature.statblock;
    const actorId = generateId(creature.slug);
    const items: Record<string, unknown>[] = [];
    const embeddedIds = new Set<string>();
    let sortCounter = 100000;

    // Strikes → melee items
    for (const strike of sb.strikes) {
        appendEmbeddedItem(items, embeddedIds, buildMeleeItem(strike, creature.slug, actorId, sortCounter), creature.slug);
        sortCounter += 100000;
    }

    // All abilities (top, mid, bot) → action items
    const allAbilities = [
        ...sb.abilities_top,
        ...sb.abilities_mid,
        ...sb.abilities_bot,
    ];
    for (const ability of allAbilities) {
        appendEmbeddedItem(items, embeddedIds, buildActionItem(ability, creature.slug, actorId, sortCounter), creature.slug);
        sortCounter += 100000;
    }

    // Spellcasting entries
    if (sb.spellcasting) {
        for (const entry of sb.spellcasting) {
            appendEmbeddedItem(items, embeddedIds, buildSpellcastingItem(entry, creature.slug, actorId, sortCounter), creature.slug);
            sortCounter += 100000;
        }
    }

    // Lore skills
    if (sb.lore) {
        for (const lore of sb.lore) {
            appendEmbeddedItem(items, embeddedIds, buildLoreItem(lore, creature.slug, actorId, sortCounter), creature.slug);
            sortCounter += 100000;
        }
    }

    return {
        _id: actorId,
        _key: `!actors!${actorId}`,
        name: sb.name,
        type: "npc",
        img: "systems/sf2e/icons/default-icons/npc.svg",
        items,
        system: buildSystemData(sb),
        flags: {
            [MODULE_ID]: {
                source: "vault",
                slug: creature.slug,
            },
        },
    };
}

function appendEmbeddedItem(items: Record<string, unknown>[], ids: Set<string>, item: Record<string, unknown>, creatureSlug: string): void {
    if (typeof item._id !== "string") throw new Error(`${creatureSlug}: embedded item is missing its deterministic _id`);
    if (ids.has(item._id)) throw new Error(`${creatureSlug}: duplicate embedded item ID ${item._id}; names must be unique within each embedded item type`);
    ids.add(item._id);
    items.push(item);
}

// ---------------------------------------------------------------------------
// System data (top-level actor fields)
// ---------------------------------------------------------------------------

function buildSystemData(sb: CreatureStatblock): Record<string, unknown> {
    return {
        abilities: {
            str: { mod: sb.abilities.str },
            dex: { mod: sb.abilities.dex },
            con: { mod: sb.abilities.con },
            int: { mod: sb.abilities.int },
            wis: { mod: sb.abilities.wis },
            cha: { mod: sb.abilities.cha },
        },
        attributes: {
            ac: { value: sb.ac, details: sb.acNote ?? "" },
            allSaves: { value: sb.saves.note ?? "" },
            hp: {
                value: sb.hp,
                max: sb.hp,
                temp: 0,
                details: formatHpDetails(sb),
            },
            speed: {
                value: sb.speed.land,
                otherSpeeds: buildOtherSpeeds(sb.speed),
                details: sb.speed.note ?? "",
            },
        },
        details: {
            blurb: "",
            languages: {
                value: sb.languages,
                details: "",
            },
            level: { value: sb.level },
            privateNotes: "",
            publicNotes: sanitizeFoundryHtml(sb.items ?? ""),
            publication: {
                license: "OGL",
                remaster: false,
                title: sb.source ?? "",
            },
        },
        initiative: {
            statistic: "perception",
        },
        perception: {
            details: "",
            mod: sb.perception.mod,
            senses: sb.perception.senses.map((s) => {
                const sense: Record<string, unknown> = { type: s.type };
                if (s.acuity) sense.acuity = s.acuity;
                if (s.range != null) sense.range = s.range;
                return sense;
            }),
        },
        resources: buildResources(sb),
        saves: {
            fortitude: {
                value: sb.saves.fort,
                saveDetail: "",
            },
            reflex: {
                value: sb.saves.ref,
                saveDetail: "",
            },
            will: {
                value: sb.saves.will,
                saveDetail: "",
            },
        },
        skills: buildSkills(sb.skills),
        traits: {
            rarity: sb.rarity,
            size: { value: sb.size },
            value: sb.traits,
        },
    };
}

function buildResources(sb: CreatureStatblock): Record<string, unknown> {
    const focusPoints = sb.spellcasting?.reduce((maximum, entry) => Math.max(maximum, entry.fp ?? 0), 0) ?? 0;
    return focusPoints > 0 ? { focus: { value: focusPoints, max: focusPoints } } : {};
}

function buildSkills(skills: Record<string, number>): Record<string, { base: number }> {
    const result: Record<string, { base: number }> = {};
    for (const [slug, base] of Object.entries(skills)) {
        result[slug] = { base };
    }
    return result;
}

function buildOtherSpeeds(speed: CreatureStatblock["speed"]): { type: string; value: number }[] {
    const others: { type: string; value: number }[] = [];
    if (speed.fly != null) others.push({ type: "fly", value: speed.fly });
    if (speed.swim != null) others.push({ type: "swim", value: speed.swim });
    if (speed.climb != null) others.push({ type: "climb", value: speed.climb });
    if (speed.burrow != null) others.push({ type: "burrow", value: speed.burrow });
    return others;
}

function formatHpDetails(sb: CreatureStatblock): string {
    const parts: string[] = [];

    if (sb.hpNote) {
        parts.push(sb.hpNote);
    }
    if (sb.immunities) {
        parts.push(`Immunities ${sb.immunities}`);
    }
    if (sb.resistances) {
        parts.push(`Resistances ${sb.resistances}`);
    }
    if (sb.weaknesses) {
        parts.push(`Weaknesses ${sb.weaknesses}`);
    }

    return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Item builders
// ---------------------------------------------------------------------------

function buildMeleeItem(
    strike: StrikeData,
    creatureSlug: string,
    actorId: string,
    sort: number,
): Record<string, unknown> {
    // Build damage rolls with deterministic keys
    const damageRolls: Record<string, { damage: string; damageType: string; category?: string }> = {};
    for (let i = 0; i < strike.damage.length; i++) {
        const d = strike.damage[i];
        const key = generateId(`${creatureSlug}-${strike.name}-dmg-${i}`);
        const roll: { damage: string; damageType: string; category?: string } = {
            damage: d.formula,
            damageType: d.type,
        };
        if (d.category) roll.category = d.category;
        damageRolls[key] = roll;
    }

    const slug = strike.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const itemId = generateId(`${creatureSlug}-strike-${strike.name}`);
    const bonusValue = strike.action === "area-fire" || strike.action === "auto-fire" ? strike.dc - 10 : strike.bonus;

    const item: Record<string, unknown> = {
        _id: itemId,
        _key: `!actors.items!${actorId}.${itemId}`,
        img: "systems/sf2e/icons/default-icons/melee.svg",
        name: strike.name,
        sort,
        type: "melee",
        system: {
            action: strike.action ?? "strike",
            area: strike.area ? { type: strike.area.type, value: strike.area.value } : null,
            attackEffects: { value: strike.effects ?? [] },
            bonus: { value: bonusValue },
            damageRolls,
            description: { value: "" },
            publication: { license: "OGL", remaster: false, title: "" },
            range: strike.range
                ? { increment: strike.range.increment ?? null, max: strike.range.max ?? null }
                : null,
            rules: [],
            slug,
            traits: { value: strike.traits, otherTags: strike.otherTags ?? [] },
        },
    };

    return item;
}

function buildActionItem(
    ability: AbilityEntry,
    creatureSlug: string,
    actorId: string,
    sort: number,
): Record<string, unknown> {
    // Parse action icons from the name
    const { cleanName, actionType, actions } = parseActionFromName(ability.name);

    const htmlDesc = enrichDescription(ability.desc);

    const itemId = generateId(`${creatureSlug}-ability-${cleanName}`);

    return {
        _id: itemId,
        _key: `!actors.items!${actorId}.${itemId}`,
        img: "systems/sf2e/icons/default-icons/action.svg",
        name: cleanName,
        sort,
        type: "action",
        system: {
            actionType: { value: actionType },
            actions: { value: actions },
            category: ability.category ?? "offensive",
            description: { value: htmlDesc },
            publication: { license: "OGL", remaster: false, title: "" },
            rules: [],
            slug: null,
            traits: { value: ability.traits ?? [] },
        },
    };
}

function buildSpellcastingItem(
    entry: SpellcastingEntry,
    creatureSlug: string,
    actorId: string,
    sort: number,
): Record<string, unknown> {
    // Try to infer tradition and prepared type from the name
    const nameLower = entry.name.toLowerCase();
    const tradition = inferTradition(nameLower);
    const preparedType = inferPreparedType(nameLower);

    const htmlDesc = entry.desc ? enrichDescription(entry.desc) : "";

    const itemId = generateId(`${creatureSlug}-spellcasting-${entry.name}`);

    return {
        _id: itemId,
        _key: `!actors.items!${actorId}.${itemId}`,
        img: "systems/sf2e/icons/default-icons/spellcastingEntry.svg",
        name: entry.name,
        sort,
        type: "spellcastingEntry",
        system: {
            autoHeightenLevel: { value: null },
            description: { value: htmlDesc },
            prepared: { value: preparedType },
            proficiency: { value: 1 },
            publication: { license: "OGL", remaster: false, title: "" },
            rules: [],
            slug: null,
            spelldc: {
                dc: entry.dc ?? 0,
                value: entry.bonus ?? 0,
            },
            tradition: { value: tradition },
            traits: {},
        },
    };
}

function inferTradition(name: string): string {
    if (name.includes("arcane")) return "arcane";
    if (name.includes("divine")) return "divine";
    if (name.includes("occult")) return "occult";
    if (name.includes("primal")) return "primal";
    return "arcane";
}

function inferPreparedType(name: string): string {
    if (name.includes("innate")) return "innate";
    if (name.includes("spontaneous")) return "spontaneous";
    if (name.includes("focus")) return "focus";
    if (name.includes("prepared")) return "prepared";
    return "innate";
}

function buildLoreItem(
    lore: LoreSkillData,
    creatureSlug: string,
    actorId: string,
    sort: number,
): Record<string, unknown> {
    const itemId = generateId(`${creatureSlug}-lore-${lore.name}`);

    return {
        _id: itemId,
        _key: `!actors.items!${actorId}.${itemId}`,
        img: "systems/sf2e/icons/default-icons/lore.svg",
        name: lore.name,
        sort,
        type: "lore",
        system: {
            description: { value: "" },
            mod: { value: lore.mod },
            proficient: { value: 0 },
            publication: { license: "OGL", remaster: false, title: "" },
            rules: [],
            slug: null,
            traits: {},
        },
    };
}

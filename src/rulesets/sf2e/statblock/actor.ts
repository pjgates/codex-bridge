import { enrichDescription } from "./enrich.js";
import { sanitizeFoundryHtml } from "./sanitize.js";
import type {
    AbilityEntry,
    CreatureStatblock,
    LoreSkillData,
    ParsedCreature,
    SpellcastingEntry,
    StrikeData,
} from "./types.js";

const MODULE_ID = "codex-foundry";

/** Options controlling how the actor document is materialised. */
export interface BuildActorOptions {
    /**
     * Deterministic id factory (pack compilation). When omitted, no `_id`/`_key`
     * fields are embedded and Foundry assigns ids at creation time.
     */
    makeId?: (key: string) => string;
    /**
     * Parse immunities/resistances/weaknesses strings into structured
     * `system.attributes` arrays (mechanically applied by the system) instead
     * of the legacy hp.details summary line.
     */
    structuredIWR?: boolean;
    /** Pre-sanitized HTML for details.publicNotes (defaults to the statblock's items text). */
    publicNotes?: string;
    /** Value for the module's `source` flag (defaults to "vault"). */
    flagsSource?: string;
}

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
export function parseActionFromName(raw: string): {
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
export function buildActorDocument(creature: ParsedCreature, options: BuildActorOptions = {}): Record<string, unknown> {
    const sb = creature.statblock;
    const makeId = options.makeId;
    const actorId = makeId?.(creature.slug);
    const items: Record<string, unknown>[] = [];
    const embeddedIds = new Set<string>();
    let sortCounter = 100000;

    const embed = (item: Record<string, unknown>, idKey: string): void => {
        if (makeId != null && actorId != null) {
            const itemId = makeId(idKey);
            if (embeddedIds.has(itemId)) throw new Error(`${creature.slug}: duplicate embedded item ID ${itemId}; names must be unique within each embedded item type`);
            embeddedIds.add(itemId);
            item._id = itemId;
            item._key = `!actors.items!${actorId}.${itemId}`;
        }
        items.push(item);
        sortCounter += 100000;
    };

    // Strikes → melee items. Damage-roll keys are deterministic when an id
    // factory is provided (pack compilation), random otherwise (runtime import).
    for (const strike of sb.strikes) {
        const rollKeyFor = (index: number): string =>
            makeId?.(`${creature.slug}-${strike.name}-dmg-${index}`) ?? randomAlphanumericId();
        embed(buildMeleeItem(strike, sortCounter, rollKeyFor), `${creature.slug}-strike-${strike.name}`);
    }

    // All abilities (top, mid, bot) → action items
    for (const ability of [...sb.abilities_top, ...sb.abilities_mid, ...sb.abilities_bot]) {
        embed(buildActionItem(ability, sortCounter), `${creature.slug}-ability-${parseActionFromName(ability.name).cleanName}`);
    }

    // Spellcasting entries
    for (const entry of sb.spellcasting ?? []) {
        embed(buildSpellcastingItem(entry, sortCounter), `${creature.slug}-spellcasting-${entry.name}`);
    }

    // Lore skills
    for (const lore of sb.lore ?? []) {
        embed(buildLoreItem(lore, sortCounter), `${creature.slug}-lore-${lore.name}`);
    }

    const actor: Record<string, unknown> = {
        name: sb.name,
        type: "npc",
        img: "systems/sf2e/icons/default-icons/npc.svg",
        items,
        system: buildSystemData(sb, options),
        flags: {
            [MODULE_ID]: {
                source: options.flagsSource ?? "vault",
                slug: creature.slug,
            },
        },
    };
    if (actorId != null) {
        actor._id = actorId;
        actor._key = `!actors!${actorId}`;
    }
    return actor;
}

/** 16-char alphanumeric id in Foundry's document-id alphabet. */
function randomAlphanumericId(): string {
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let id = "";
    for (let i = 0; i < 16; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
    return id;
}


// ---------------------------------------------------------------------------
// System data (top-level actor fields)
// ---------------------------------------------------------------------------

function buildSystemData(sb: CreatureStatblock, options: BuildActorOptions): Record<string, unknown> {
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
                details: options.structuredIWR ? sb.hpNote ?? "" : formatHpDetails(sb),
            },
            speed: {
                value: sb.speed.land,
                otherSpeeds: buildOtherSpeeds(sb.speed),
                details: sb.speed.note ?? "",
            },
            ...(options.structuredIWR ? buildStructuredIWR(sb) : {}),
        },
        details: {
            blurb: "",
            languages: {
                value: sb.languages,
                details: "",
            },
            level: { value: sb.level },
            privateNotes: "",
            publicNotes: options.publicNotes ?? sanitizeFoundryHtml(sb.items ?? ""),
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
            details: sb.perception.details ?? "",
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

/**
 * Parse an authored IWR string like "physical 5 (except silver), fire 10"
 * into structured entries. Types are slugified ("cold iron" → "cold-iron").
 */
export function parseIWRString(raw: string): { type: string; value?: number; exceptions?: string[] }[] {
    const entries: { type: string; value?: number; exceptions?: string[] }[] = [];
    for (const segment of raw.split(",")) {
        const match = segment.trim().match(/^([a-z][a-z\s-]*?)(?:\s+(\d+))?(?:\s*\(\s*except\s+([^)]+)\))?$/i);
        if (!match) continue;
        const entry: { type: string; value?: number; exceptions?: string[] } = {
            type: match[1].trim().toLowerCase().replace(/\s+/g, "-"),
        };
        if (match[2]) entry.value = Number(match[2]);
        if (match[3]) entry.exceptions = match[3].split(/,|\bor\b/).map((e) => e.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
        entries.push(entry);
    }
    return entries;
}

function buildStructuredIWR(sb: CreatureStatblock): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (sb.immunities) result.immunities = parseIWRString(sb.immunities).map(({ type }) => ({ type }));
    if (sb.resistances) result.resistances = parseIWRString(sb.resistances);
    if (sb.weaknesses) result.weaknesses = parseIWRString(sb.weaknesses);
    return result;
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
    sort: number,
    rollKeyFor: (index: number) => string,
): Record<string, unknown> {
    const damageRolls: Record<string, { damage: string; damageType: string; category?: string }> = {};
    for (let i = 0; i < strike.damage.length; i++) {
        const d = strike.damage[i];
        const roll: { damage: string; damageType: string; category?: string } = {
            damage: d.formula,
            damageType: d.type,
        };
        if (d.category) roll.category = d.category;
        damageRolls[rollKeyFor(i)] = roll;
    }

    const slug = strike.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const bonusValue = strike.action === "area-fire" || strike.action === "auto-fire" ? strike.dc - 10 : strike.bonus;

    return {
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
}

function buildActionItem(ability: AbilityEntry, sort: number): Record<string, unknown> {
    // Parse action icons from the name
    const { cleanName, actionType, actions } = parseActionFromName(ability.name);

    const htmlDesc = enrichDescription(ability.desc);

    return {
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

function buildSpellcastingItem(entry: SpellcastingEntry, sort: number): Record<string, unknown> {
    // Try to infer tradition and prepared type from the name
    const nameLower = entry.name.toLowerCase();
    const tradition = inferTradition(nameLower);
    const preparedType = inferPreparedType(nameLower);

    const htmlDesc = entry.desc ? enrichDescription(entry.desc) : "";

    return {
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

function buildLoreItem(lore: LoreSkillData, sort: number): Record<string, unknown> {
    return {
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

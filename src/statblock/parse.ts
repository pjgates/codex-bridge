import type {
    AbilityEntry,
    AreaAttackData,
    AbilityScores,
    CreatureStatblock,
    DamageRollData,
    LoreSkillData,
    PerceptionData,
    SavesData,
    SenseData,
    SpeedData,
    SpellcastingEntry,
    StrikeData,
} from "./types.js";
import { SF2E_ACTION_TRAITS, SF2E_CREATURE_TRAITS, SF2E_NPC_ATTACK_TRAITS } from "./traits.js";

/** Reviewed campaign-specific creature traits that are intentionally outside SF2e's vocabulary. */
const PROJECT_CREATURE_TRAITS: Record<string, true> = { aurelian: true, converted: true };

/**
 * Normalisation options.
 *
 * `lenient` is for the runtime paste-importer: instead of rejecting vocabulary
 * the vault review process hasn't whitelisted (custom senses, homebrew traits,
 * extra frontmatter fields), it keeps unknown trait slugs, routes unknown
 * senses into `perception.details`, and ignores unknown top-level fields.
 * Structural/mechanical errors (missing saves, malformed damage) still throw.
 */
export interface ParseOptions {
    lenient?: boolean;
}


// ---------------------------------------------------------------------------
// Top-level normalisation
// ---------------------------------------------------------------------------

const STATBLOCK_FIELDS: Record<string, true> = {
    abilities_bot: true, abilities_mid: true, abilities_top: true, ac: true, acNote: true,
    attacks: true, attributes: true, hp: true, hpNote: true, immunities: true, items: true,
    languages: true, layout: true, level: true, modifier: true, name: true, published: true,
    rarity: true, resistances: true, saves: true, senses: true, size: true, skills: true,
    source: true, speed: true, spellcasting: true, statblock: true, traits: true, weaknesses: true,
};

function hasOwn(record: object, key: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Validate and normalise raw frontmatter data into a CreatureStatblock.
 *
 * Callers own frontmatter extraction: the Node converter uses gray-matter,
 * the runtime importer uses js-yaml on the `--- … ---` block.
 */
export function normaliseStatblock(data: Record<string, unknown>, filename: string, options: ParseOptions = {}): CreatureStatblock {
    const lenient = options.lenient === true;
    if (!lenient) {
        for (const key of Object.keys(data)) if (!hasOwn(STATBLOCK_FIELDS, key)) fail(filename, key, "unknown statblock field");
    }
    const { skills, lore } = normaliseSkillsArray(data.skills, filename, "skills");

    return {
        statblock: true,
        layout: optionalString(data.layout, filename, "layout") ?? "Pathfinder 2e Creature Layout",
        name: requiredString(data.name, filename, "name"),
        level: parseLevel(data.level, filename, "level"),
        rarity: normaliseEnum(data.rarity, ["common", "uncommon", "rare", "unique"], "common", filename, "rarity"),
        size: normaliseSize(data.size, filename, "size"),
        traits: normaliseCreatureTraits(data.traits, filename, "traits", lenient),
        published: normalisePublished(data.published, filename),
        source: optionalString(data.source, filename, "source"),

        abilities: normaliseAttributes(data.attributes, filename, "attributes"),
        perception: normalisePerception(data.modifier, data.senses, filename, lenient),
        languages: normaliseLanguages(data.languages, filename, "languages"),
        skills,

        ac: nonNegativeInteger(data.ac, filename, "ac"),
        acNote: optionalString(data.acNote, filename, "acNote"),
        saves: normaliseSaves(data.saves, filename, "saves"),
        hp: nonNegativeInteger(data.hp, filename, "hp"),
        hpNote: optionalString(data.hpNote, filename, "hpNote"),
        immunities: normaliseString(data.immunities, filename, "immunities"),
        resistances: normaliseString(data.resistances, filename, "resistances"),
        weaknesses: normaliseString(data.weaknesses, filename, "weaknesses"),

        speed: normaliseSpeed(data.speed, filename, "speed"),
        strikes: normaliseAttacks(data.attacks, filename, "attacks", lenient),

        abilities_top: normaliseAbilityList(data.abilities_top, filename, "abilities_top", lenient),
        abilities_mid: normaliseAbilityList(data.abilities_mid, filename, "abilities_mid", lenient),
        abilities_bot: normaliseAbilityList(data.abilities_bot, filename, "abilities_bot", lenient),

        spellcasting: data.spellcasting == null ? undefined : normaliseSpellcasting(data.spellcasting, filename, "spellcasting"),
        lore: lore.length > 0 ? lore : undefined,
        items: optionalString(data.items, filename, "items"),
    };
}

// ---------------------------------------------------------------------------
// Level: "Creature -1" → -1
// ---------------------------------------------------------------------------

function parseLevel(raw: unknown, filename: string, path: string): number {
    if (typeof raw === "number") return finiteNumber(raw, filename, path);
    if (typeof raw !== "string") fail(filename, path, "expected a number or a string like \"Creature 5\"");
    const match = raw.trim().match(/^(?:creature\s+)?(-?\d+)$/i);
    if (!match) fail(filename, path, "expected a number or a string like \"Creature 5\"");
    return finiteNumber(match[1], filename, path);
}

// ---------------------------------------------------------------------------
// Size: "small" / "Small" / "sm" → "sm"
// ---------------------------------------------------------------------------

const SIZE_MAP: Record<string, CreatureStatblock["size"]> = {
    tiny: "tiny",
    small: "sm",
    sm: "sm",
    medium: "med",
    med: "med",
    large: "lg",
    lg: "lg",
    huge: "huge",
    gargantuan: "grg",
    grg: "grg",
};

function normaliseSize(raw: unknown, filename: string, path: string): CreatureStatblock["size"] {
    if (raw == null) return "med";
    if (typeof raw !== "string") fail(filename, path, "expected a size string");
    const key = raw.toLowerCase();
    if (!hasOwn(SIZE_MAP, key)) fail(filename, path, `expected one of ${Object.keys(SIZE_MAP).join(", ")}`);
    const normalised = SIZE_MAP[key];
    return normalised;
}

// ---------------------------------------------------------------------------
// Attributes: [{str: 2}, {dex: 3}, ...] → AbilityScores
// ---------------------------------------------------------------------------

function normaliseAttributes(raw: unknown, filename: string, path: string): AbilityScores {
    const result: AbilityScores = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
    if (raw == null) fail(filename, path, "missing required ability modifiers");

    const seen = new Set<keyof AbilityScores>();
    const assign = (key: string, value: unknown, entryPath: string): void => {
        const normalised = key.toLowerCase() as keyof AbilityScores;
        if (!hasOwn(result, normalised)) fail(filename, entryPath, `unknown ability category ${JSON.stringify(key)}`);
        if (seen.has(normalised)) fail(filename, entryPath, `duplicate ability category ${JSON.stringify(key)}`);
        result[normalised] = finiteNumber(value, filename, entryPath);
        seen.add(normalised);
    };

    if (Array.isArray(raw)) {
        raw.forEach((entry, index) => {
            const obj = record(entry, filename, `${path}[${index}]`);
            const entries = Object.entries(obj);
            if (entries.length !== 1) fail(filename, `${path}[${index}]`, "expected exactly one ability category");
            assign(entries[0][0], entries[0][1], `${path}[${index}].${entries[0][0]}`);
        });
    } else {
        for (const [key, value] of Object.entries(record(raw, filename, path))) assign(key, value, `${path}.${key}`);
    }

    for (const ability of ["str", "dex", "con", "int", "wis", "cha"] as const) {
        if (!seen.has(ability)) fail(filename, `${path}.${ability}`, "missing required ability modifier");
    }
    return result;
}

// ---------------------------------------------------------------------------
// Perception: modifier + senses string → PerceptionData
// ---------------------------------------------------------------------------

const SENSE_TYPES = new Set([
    "bloodsense", "darkvision", "echolocation", "electromagnetic-sense", "greater-darkvision",
    "infrared-vision", "lifesense", "low-light-vision", "magicsense", "motion-sense", "scent",
    "see-invisibility", "spiritsense", "thoughtsense", "tremorsense", "truesight", "wavesense",
]);

const MANDATORY_SENSE_ACUITIES = new Map<string, NonNullable<SenseData["acuity"]>>([
    ["darkvision", "precise"],
    ["echolocation", "precise"],
    ["greater-darkvision", "precise"],
    ["infrared-vision", "precise"],
    ["low-light-vision", "precise"],
    ["see-invisibility", "precise"],
    ["truesight", "precise"],
]);
const UNLIMITED_RANGE_SENSES = new Set([
    "darkvision", "greater-darkvision", "low-light-vision", "see-invisibility",
]);

function validateSenseType(type: string, filename: string, path: string): string {
    if (!SENSE_TYPES.has(type)) fail(filename, path, `unknown sense type ${JSON.stringify(type)}`);
    return type;
}

function validateSenseMechanics(sense: SenseData, filename: string, path: string): SenseData {
    const mandatoryAcuity = MANDATORY_SENSE_ACUITIES.get(sense.type);
    if (sense.acuity != null && mandatoryAcuity != null && sense.acuity !== mandatoryAcuity) {
        fail(filename, `${path}.acuity`, `${sense.type} must have ${mandatoryAcuity} acuity`);
    }
    if (UNLIMITED_RANGE_SENSES.has(sense.type)) {
        if (sense.range != null) fail(filename, `${path}.range`, `${sense.type} has unlimited range; omit the authored range`);
        return { type: sense.type };
    }

    const acuity = sense.acuity ?? mandatoryAcuity;
    if (acuity == null) fail(filename, `${path}.acuity`, `${sense.type} requires an authored acuity`);
    const range = sense.range ?? (sense.type === "truesight" ? 60 : undefined);
    if (range == null) fail(filename, `${path}.range`, `${sense.type} requires an authored range`);
    return { type: sense.type, acuity, range };
}

function normalisePerception(modifier: unknown, sensesRaw: unknown, filename: string, lenient = false): PerceptionData {
    const mod = finiteNumber(modifier, filename, "modifier");
    if (!lenient) return { mod, senses: parseSensesString(sensesRaw, filename, "senses") };

    // Lenient: parse each authored segment independently; anything the strict
    // parser rejects (custom senses like "sandsense") lands in `details`.
    if (typeof sensesRaw !== "string") {
        return { mod, senses: parseSensesString(sensesRaw, filename, "senses") };
    }
    const senses: SenseData[] = [];
    const details: string[] = [];
    for (const segment of sensesRaw.split(/,\s*/)) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        try {
            senses.push(parseSingleSense(trimmed, filename, "senses"));
        } catch {
            details.push(trimmed);
        }
    }
    return details.length > 0 ? { mod, senses, details: details.join(", ") } : { mod, senses };
}

/** Parse a senses string like "low-light vision, scent (imprecise) 30 feet". */
export function parseSensesString(raw: unknown, filename = "<input>", path = "senses"): SenseData[] {
    if (raw == null) return [];

    if (Array.isArray(raw)) {
        return raw.map((item, index) => {
            const itemPath = `${path}[${index}]`;
            if (typeof item === "string") return parseSingleSense(item, filename, itemPath);
            const obj = record(item, filename, itemPath);
            for (const key of Object.keys(obj)) {
                if (key !== "type" && key !== "acuity" && key !== "range") fail(filename, `${itemPath}.${key}`, "unknown sense field");
            }
            if (typeof obj.type !== "string" || !obj.type.trim()) fail(filename, `${itemPath}.type`, "expected a non-empty string");
            const type = validateSenseType(slugify(obj.type), filename, `${itemPath}.type`);
            const sense: SenseData = { type };
            if (obj.acuity != null) sense.acuity = senseAcuity(obj.acuity, filename, `${itemPath}.acuity`);
            if (obj.range != null) sense.range = positiveInteger(obj.range, filename, `${itemPath}.range`);
            return validateSenseMechanics(sense, filename, itemPath);
        });
    }

    if (typeof raw !== "string") fail(filename, path, "expected a string or an array of senses");
    const str = raw.trim();
    if (!str) return [];
    return str.split(/,\s*/).map((sense, index) => parseSingleSense(sense, filename, `${path}[${index}]`));
}

function parseSingleSense(raw: string, filename: string, path: string): SenseData {
    const str = raw.trim();
    const match = str.match(/^(.+?)\s*(?:\(([^)]+)\))?\s*(?:(\d+)\s*(?:feet|ft\.?))?$/i);
    if (!match) fail(filename, path, "expected a sense like \"scent (imprecise) 30 feet\"");
    if (/[()]/.test(str) && !match[2]) fail(filename, path, "expected a sense like \"scent (imprecise) 30 feet\"");
    const type = validateSenseType(slugify(match[1].trim()), filename, `${path}.type`);
    const sense: SenseData = { type };
    if (match[2]) sense.acuity = senseAcuity(match[2], filename, `${path}.acuity`);
    if (match[3]) sense.range = positiveInteger(match[3], filename, `${path}.range`);
    return validateSenseMechanics(sense, filename, path);
}

function senseAcuity(raw: unknown, filename: string, path: string): SenseData["acuity"] {
    if (typeof raw !== "string") fail(filename, path, "expected precise, imprecise, or vague");
    const value = raw.toLowerCase();
    if (value !== "precise" && value !== "imprecise" && value !== "vague") fail(filename, path, "expected precise, imprecise, or vague");
    return value;
}

// ---------------------------------------------------------------------------
// Languages: string or array → string[]
// ---------------------------------------------------------------------------

function normaliseLanguages(raw: unknown, filename: string, path: string): string[] {
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw.map((language, index) => requiredString(language, filename, `${path}[${index}]`));
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        return trimmed.split(/[,;]\s*/).filter(Boolean);
    }
    fail(filename, path, "expected a string or an array of strings");
}

// ---------------------------------------------------------------------------
// Skills: [{Acrobatics: 4}, ...] → Record<string, number> + LoreSkillData[]
// ---------------------------------------------------------------------------

const STANDARD_SKILLS: Record<string, true> = {
    acrobatics: true, arcana: true, athletics: true, computers: true, crafting: true, deception: true,
    diplomacy: true, intimidation: true, medicine: true, nature: true, occultism: true,
    performance: true, piloting: true, religion: true, society: true, stealth: true, survival: true, thievery: true,
};

function normaliseSkillsArray(
    raw: unknown,
    filename: string,
    path: string,
): { skills: Record<string, number>; lore: LoreSkillData[] } {
    const skills: Record<string, number> = {};
    const lore: LoreSkillData[] = [];
    if (raw == null) return { skills, lore };

    const assign = (key: string, value: unknown, entryPath: string): void => {
        const name = key.trim();
        if (!name) fail(filename, entryPath, "expected a non-empty skill name");
        const mod = finiteNumber(value, filename, entryPath);
        const loreMatch = name.match(/^(.+?)\s+Lore$/i) || name.match(/^Lore:\s*(.+)$/i);
        if (loreMatch) lore.push({ name: `${loreMatch[1].trim()} Lore`, mod });
        else {
            const slug = name.toLowerCase().replace(/\s+/g, "-");
            if (!hasOwn(STANDARD_SKILLS, slug)) fail(filename, entryPath, `unknown standard skill ${JSON.stringify(name)}`);
            if (skills[slug] != null) fail(filename, entryPath, `duplicate standard skill ${JSON.stringify(name)}`);
            skills[slug] = mod;
        }
    };

    if (Array.isArray(raw)) {
        raw.forEach((entry, index) => {
            const obj = record(entry, filename, `${path}[${index}]`);
            const entries = Object.entries(obj);
            if (entries.length !== 1) fail(filename, `${path}[${index}]`, "expected exactly one skill");
            assign(entries[0][0], entries[0][1], `${path}[${index}].${entries[0][0]}`);
        });
    } else {
        for (const [key, value] of Object.entries(record(raw, filename, path))) assign(key, value, `${path}.${key}`);
    }
    return { skills, lore };
}

// ---------------------------------------------------------------------------
// Saves: [{fort: 5}, {ref: 8}, {will: 2}] → SavesData
// ---------------------------------------------------------------------------

function normaliseSaves(raw: unknown, filename: string, path: string): SavesData {
    const result: SavesData = { fort: 0, ref: 0, will: 0 };
    if (raw == null) fail(filename, path, "missing required saves");
    const seen = new Set<"fort" | "ref" | "will">();
    const assign = (key: string, value: unknown, entryPath: string): void => {
        const normalised = key.toLowerCase();
        if (normalised === "note") {
            result.note = requiredString(value, filename, entryPath);
            return;
        }
        const save = normalised === "fortitude" ? "fort" : normalised === "reflex" ? "ref" : normalised;
        if (save !== "fort" && save !== "ref" && save !== "will") fail(filename, entryPath, `unknown save ${JSON.stringify(key)}`);
        if (seen.has(save)) fail(filename, entryPath, `duplicate save ${JSON.stringify(key)}`);
        result[save] = finiteNumber(value, filename, entryPath);
        seen.add(save);
    };

    if (Array.isArray(raw)) {
        raw.forEach((entry, index) => {
            const obj = record(entry, filename, `${path}[${index}]`);
            const entries = Object.entries(obj);
            if (entries.length !== 1) fail(filename, `${path}[${index}]`, "expected exactly one save or note");
            assign(entries[0][0], entries[0][1], `${path}[${index}].${entries[0][0]}`);
        });
    } else {
        for (const [key, value] of Object.entries(record(raw, filename, path))) assign(key, value, `${path}.${key}`);
    }
    for (const save of ["fort", "ref", "will"] as const) if (!seen.has(save)) fail(filename, `${path}.${save}`, "missing required save");
    return result;
}

// ---------------------------------------------------------------------------
// Speed: "25 feet, fly 60 feet" → SpeedData
// ---------------------------------------------------------------------------

/**
 * Parse a speed string like "25 feet, fly 60 feet, swim 30 feet"
 * into structured SpeedData.
 */
export function parseSpeedString(raw: unknown, filename = "<input>", path = "speed"): SpeedData {
    if (raw == null || raw === "") fail(filename, path, "missing required speed");
    if (typeof raw === "number") return { land: nonNegativeInteger(raw, filename, path) };

    if (typeof raw === "object" && !Array.isArray(raw)) {
        const obj = record(raw, filename, path);
        const allowed: Record<string, true> = { land: true, fly: true, swim: true, climb: true, burrow: true, note: true };
        for (const key of Object.keys(obj)) if (!hasOwn(allowed, key)) fail(filename, `${path}.${key}`, "unknown speed field");
        const speed: SpeedData = { land: obj.land == null ? 0 : nonNegativeInteger(obj.land, filename, `${path}.land`) };
        for (const type of ["fly", "swim", "climb", "burrow"] as const) {
            if (obj[type] != null) speed[type] = nonNegativeInteger(obj[type], filename, `${path}.${type}`);
        }
        if (obj.note != null) speed.note = requiredString(obj.note, filename, `${path}.note`);
        return speed;
    }

    if (typeof raw !== "string") fail(filename, path, "expected a speed string, number, or object");
    const str = raw.trim();
    if (!str) fail(filename, path, "missing required speed");
    const speed: SpeedData = { land: 0 };
    const seen = new Set<string>();
    for (const [index, part] of str.split(/,\s*/).entries()) {
        const partPath = `${path}[${index}]`;
        const trimmed = part.trim().toLowerCase();
        const typed = trimmed.match(/^(fly|swim|climb|burrow)\s+(\d+)\s*(?:feet|ft\.?)?$/);
        const land = trimmed.match(/^(\d+)\s*(?:feet|ft\.?)?$/);
        const type = typed?.[1] ?? (land ? "land" : undefined);
        const value = typed?.[2] ?? land?.[1];
        if (!type || value == null) fail(filename, partPath, "expected a speed like \"25 feet\" or \"fly 60 feet\"");
        if (seen.has(type)) fail(filename, partPath, `duplicate ${type} speed`);
        const numericValue = nonNegativeInteger(value, filename, partPath);
        if (type === "land") speed.land = numericValue;
        else if (type === "fly") speed.fly = numericValue;
        else if (type === "swim") speed.swim = numericValue;
        else if (type === "climb") speed.climb = numericValue;
        else speed.burrow = numericValue;
        seen.add(type);
    }
    return speed;
}

function normaliseSpeed(raw: unknown, filename: string, path: string): SpeedData {
    return parseSpeedString(raw, filename, path);
}

// ---------------------------------------------------------------------------
// Attacks: layout format → StrikeData[]
// ---------------------------------------------------------------------------

/**
 * Parse layout-format attacks into StrikeData[].
 *
 * Layout format:
 * ```yaml
 * - name: "__Melee__ ⬻ Mandibles"
 *   bonus: 6
 *   desc: "(finesse, unarmed)"
 *   damage: "1d4+2 piercing"
 * ```
 */
function normaliseAttacks(raw: unknown, filename: string, path: string, lenient = false): StrikeData[] {
    if (raw == null) return [];
    if (!Array.isArray(raw)) fail(filename, path, "expected an array of strikes");

    return raw.map((entry, index) => {
        const entryPath = `${path}[${index}]`;
        const obj = record(entry, filename, entryPath);
        if (!lenient) {
            for (const key of Object.keys(obj)) {
                if (key !== "name" && key !== "bonus" && key !== "dc" && key !== "desc" && key !== "damage") fail(filename, `${entryPath}.${key}`, "unknown strike field");
            }
        }
        const rawName = requiredString(obj.name, filename, `${entryPath}.name`);
        const prefix = rawName.match(/^__(\w+)__/);
        if (prefix && prefix[1].toLowerCase() !== "melee" && prefix[1].toLowerCase() !== "ranged") fail(filename, `${entryPath}.name`, "strike prefix must be __Melee__ or __Ranged__");
        const { type, name } = parseAttackName(rawName);
        if (!name) fail(filename, `${entryPath}.name`, "expected a non-empty strike name");
        const desc = obj.desc == null ? "" : requiredString(obj.desc, filename, `${entryPath}.desc`, true);
        const rawDamage = requiredString(obj.damage, filename, `${entryPath}.damage`);
        const { traits, otherTags, action, area, range } = parseAttackDesc(desc, filename, `${entryPath}.desc`, lenient);
        const { damage, effects } = parseDamageString(rawDamage, filename, `${entryPath}.damage`);
        if (type === "ranged" && !range) fail(filename, `${entryPath}.desc`, "ranged strikes require range metadata");
        if (type === "melee" && range) fail(filename, `${entryPath}.desc`, "melee strikes must not include range metadata");
        const shared = { name, type, traits, damage };
        let strike: StrikeData;
        if (action) {
            if (hasOwn(obj, "bonus")) fail(filename, `${entryPath}.bonus`, `${action} attacks must use dc instead of bonus`);
            if (!area) fail(filename, `${entryPath}.desc`, `${action} requires area metadata`);
            strike = { ...shared, action, area, dc: positiveInteger(obj.dc, filename, `${entryPath}.dc`) };
        } else {
            if (hasOwn(obj, "dc")) fail(filename, `${entryPath}.dc`, "ordinary strikes must use bonus instead of dc");
            strike = { ...shared, bonus: finiteNumber(obj.bonus, filename, `${entryPath}.bonus`) };
        }
        if (otherTags) strike.otherTags = otherTags;
        if (effects.length > 0) strike.effects = effects;
        if (range) strike.range = range;
        return strike;
    });
}

/**
 * Parse attack name: "__Melee__ ⬻ Mandibles" → { type: "melee", name: "Mandibles" }
 */
export function parseAttackName(raw: string): { type: "melee" | "ranged"; name: string } {
    let type: "melee" | "ranged" = "melee";
    let name = raw;
    const typeMatch = name.match(/^__(\w+)__\s*/);
    if (typeMatch) {
        type = typeMatch[1].toLowerCase() === "ranged" ? "ranged" : "melee";
        name = name.slice(typeMatch[0].length);
    }
    name = name.replace(/^[⬻⬺⬽⬲⭓]\s*/, "").trim();
    return { type, name };
}

/** Parse attack description traits and SF2e extras. */

export function parseAttackDesc(raw: string, filename = "<attack description>", path = "trait", lenient = false): {
    traits: string[];
    otherTags?: string[];
    action?: AreaAttackData["action"];
    area?: { type: string; value: number };
    range?: { increment?: number; max?: number };
} {
    const inner = raw.trim().replace(/^\(/, "").replace(/\)$/, "").trim();
    if (!inner) return { traits: [] };
    const traits: string[] = [];
    const otherTags: string[] = [];
    let action: AreaAttackData["action"] | undefined;
    let area: { type: string; value: number } | undefined;
    let range: { increment?: number; max?: number } | undefined;
    for (const [index, part] of inner.split(/,\s*/).entries()) {
        const lower = part.trim().toLowerCase();
        if (lower === "area-fire" || lower === "auto-fire") {
            if (action) fail(filename, `${path}[${index}]`, "duplicate attack action");
            action = lower;
            continue;
        }
        const areaMatch = lower.match(/^(burst|cone|line|emanation)\s+(\d+)\s*(?:ft\.?|feet)?$/);
        if (areaMatch) {
            if (area) fail(filename, `${path}[${index}]`, "duplicate attack area");
            const value = Number(areaMatch[2]);
            if (value < 5 || value > 50 || value % 5 !== 0) fail(filename, `${path}[${index}]`, "area distance must be a multiple of 5 from 5 to 50 feet");
            area = { type: areaMatch[1], value };
            continue;
        }
        const rangeMatch = lower.match(/^range\s+(?:increment\s+)?(\d+)\s*(?:ft\.?|feet)?$/);
        if (rangeMatch) {
            const type = lower.includes("increment") ? "increment" : "max";
            const value = Number(rangeMatch[1]);
            if (value < 5 || value > 500 || value % 5 !== 0) fail(filename, `${path}[${index}]`, "range must be a multiple of 5 from 5 to 500 feet");
            if (range?.[type] != null) fail(filename, `${path}[${index}]`, `duplicate range ${type}`);
            range ??= {};
            range[type] = value;
            continue;
        }
        const trait = lower.replace(/\s+ft\.?$/, "").replace(/\+/g, "").replace(/\s+/g, "-").replace(/^boost-d/, "boost-1d");
        if (/^mag-\d+$/.test(trait)) otherTags.push(trait);
        else if (lenient || hasOwn(SF2E_NPC_ATTACK_TRAITS, trait)) traits.push(trait);
        else fail(filename, `${path}[${index}]`, `unknown NPC attack trait ${JSON.stringify(part.trim())}`);
    }
    if (action && !area) fail(filename, path, `${action} requires area metadata`);
    if (!action && area) fail(filename, path, "ordinary strikes must not include area metadata");
    return otherTags.length > 0 ? { traits, otherTags, action, area, range } : { traits, action, area, range };
}

/** Damage types reviewed against the PF2e/SF2e strike damage vocabulary. */
const STRIKE_DAMAGE_TYPES: Record<string, true> = {
    acid: true, bleed: true, bludgeoning: true, cold: true, electricity: true, fire: true,
    force: true, mental: true, piercing: true, poison: true, slashing: true, sonic: true,
    spirit: true, untyped: true, vitality: true, void: true,
};

/** Parse a damage string like "1d4+2 piercing plus 1d6 persistent fire plus Grab". */
export function parseDamageString(raw: string, filename = "<input>", path = "damage"): {
    damage: DamageRollData[];
    effects: string[];
} {
    const str = raw.trim();
    if (!str) return { damage: [], effects: [] };
    const damage: DamageRollData[] = [];
    const effects: string[] = [];

    for (const [index, part] of str.split(/\s+plus\s+/i).entries()) {
        const trimmed = part.trim();
        const match = trimmed.match(/^((?:\d+d\d+(?:[+-]\d+)?)|\d+)\s+(.+)$/);
        if (match) {
            const rawType = match[2].trim().toLowerCase();
            const persistent = rawType.match(/^persistent\s+(.+)$/);
            const type = persistent?.[1] ?? rawType;
            if (!hasOwn(STRIKE_DAMAGE_TYPES, type)) fail(filename, `${path}[${index}].type`, `unknown strike damage type ${JSON.stringify(type)}`);
            const roll: DamageRollData = { formula: validateDamageFormula(match[1], filename, `${path}[${index}].formula`), type };
            if (persistent) roll.category = "persistent";
            damage.push(roll);
        } else if (/^(?:\d+d\d+(?:[+-]\d+)?|\d+)$/.test(trimmed)) {
            damage.push({ formula: validateDamageFormula(trimmed, filename, `${path}[${index}].formula`), type: "untyped" });
        } else if (/^[+-]?(?:\d+d\d+|\d+)/i.test(trimmed)) {
            fail(filename, `${path}[${index}]`, "expected damage like \"1d6 fire\"");
        } else {
            const effect = slugify(trimmed);
            if (!effect) fail(filename, `${path}[${index}]`, "expected a named attack effect");
            effects.push(effect);
        }
    }
    return { damage, effects };
}

// ---------------------------------------------------------------------------
// Abilities: [{name, desc, ...}] → AbilityEntry[]
// ---------------------------------------------------------------------------


function normaliseAbilityList(raw: unknown, filename: string, path: string, lenient = false): AbilityEntry[] {
    if (raw == null) return [];
    if (!Array.isArray(raw)) fail(filename, path, "expected an array of abilities");
    return raw.map((ability, index) => {
        const entryPath = `${path}[${index}]`;
        const obj = record(ability, filename, entryPath);
        if (!lenient) {
            for (const key of Object.keys(obj)) {
                if (key !== "name" && key !== "desc" && key !== "description" && key !== "traits" && key !== "category") fail(filename, `${entryPath}.${key}`, "unknown ability field");
            }
        }
        const entry: AbilityEntry = {
            name: obj.name == null ? "Unnamed" : requiredString(obj.name, filename, `${entryPath}.name`),
            desc: obj.desc == null && obj.description == null ? "" : requiredString(obj.desc ?? obj.description, filename, `${entryPath}.desc`, true),
        };
        if (obj.traits != null) entry.traits = toStringArray(obj.traits, filename, `${entryPath}.traits`).map((trait, traitIndex) => {
            const slug = trait.trim().toLowerCase().replace(/\s+/g, "-");
            if (!lenient && !hasOwn(SF2E_ACTION_TRAITS, slug)) fail(filename, `${entryPath}.traits[${traitIndex}]`, `unknown action trait ${JSON.stringify(trait)}`);
            return slug;
        });
        if (obj.category != null) {
            const category = requiredString(obj.category, filename, `${entryPath}.category`);
            if (category !== "offensive" && category !== "defensive" && category !== "interaction") fail(filename, `${entryPath}.category`, "expected offensive, defensive, or interaction");
            entry.category = category;
        }
        return entry;
    });
}

// ---------------------------------------------------------------------------
// Spellcasting: layout format → SpellcastingEntry[]
// ---------------------------------------------------------------------------

function normaliseSpellcasting(raw: unknown, filename: string, path: string): SpellcastingEntry[] {
    if (!Array.isArray(raw)) fail(filename, path, "expected an array of spellcasting entries");
    return raw.map((entry, index) => {
        const entryPath = `${path}[${index}]`;
        const obj = record(entry, filename, entryPath);
        for (const key of Object.keys(obj)) {
            if (key !== "name" && key !== "desc" && key !== "dc" && key !== "bonus" && key !== "fp") fail(filename, `${entryPath}.${key}`, "unknown spellcasting field");
        }
        const result: SpellcastingEntry = {
            name: obj.name == null ? "Spells" : requiredString(obj.name, filename, `${entryPath}.name`),
            desc: obj.desc == null ? "" : requiredString(obj.desc, filename, `${entryPath}.desc`, true),
        };
        if (obj.dc != null) result.dc = finiteNumber(obj.dc, filename, `${entryPath}.dc`);
        if (obj.bonus != null) result.bonus = finiteNumber(obj.bonus, filename, `${entryPath}.bonus`);
        if (obj.fp != null) result.fp = nonNegativeInteger(obj.fp, filename, `${entryPath}.fp`);
        return result;
    });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function normaliseString(raw: unknown, filename: string, path: string): string {
    if (raw == null) return "";
    if (Array.isArray(raw)) return raw.map((value, index) => requiredString(value, filename, `${path}[${index}]`)).join(", ");
    return requiredString(raw, filename, path, true).trim();
}

function normaliseCreatureTraits(raw: unknown, filename: string, path: string, lenient = false): string[] {
    return toStringArray(raw, filename, path).map((trait, index) => {
        const slug = slugify(trait.trim());
        if (!lenient && !hasOwn(SF2E_CREATURE_TRAITS, slug) && !hasOwn(PROJECT_CREATURE_TRAITS, slug)) fail(filename, `${path}[${index}]`, `unknown creature trait ${JSON.stringify(trait)}`);
        return slug;
    });
}

function toStringArray(value: unknown, filename: string, path: string): string[] {
    if (value == null) return [];
    if (Array.isArray(value)) return value.map((entry, index) => requiredString(entry, filename, `${path}[${index}]`));
    if (typeof value === "string") return value.trim() ? [value] : [];
    fail(filename, path, "expected a string or an array of strings");
}

function normaliseEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T, filename: string, path: string): T {
    if (value == null) return fallback;
    if (typeof value !== "string") fail(filename, path, `expected one of ${allowed.join(", ")}`);
    const normalised = value.toLowerCase();
    if (!allowed.includes(normalised as T)) fail(filename, path, `expected one of ${allowed.join(", ")}`);
    return normalised as T;
}

function normalisePublished(raw: unknown, filename: string): boolean {
    if (raw == null) return true;
    if (typeof raw !== "boolean") fail(filename, "published", "expected a boolean");
    return raw;
}

function finiteNumber(raw: unknown, filename: string, path: string, fallback?: number): number {
    if (raw == null && fallback != null) return fallback;
    if ((typeof raw !== "number" && typeof raw !== "string") || (typeof raw === "string" && !raw.trim())) fail(filename, path, "expected a finite number");
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value)) fail(filename, path, "expected a finite number");
    return value;
}

function validateDamageFormula(formula: string, filename: string, path: string): string {
    const dice = formula.match(/^(\d+)d(\d+)(?:[+-]\d+)?$/);
    if (dice && (Number(dice[1]) < 1 || Number(dice[2]) < 1)) fail(filename, path, "dice count and sides must be positive integers");
    return formula;
}

function positiveInteger(raw: unknown, filename: string, path: string): number {
    if ((typeof raw !== "number" && typeof raw !== "string") || (typeof raw === "string" && !raw.trim())) fail(filename, path, "expected a positive integer");
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) fail(filename, path, "expected a positive integer");
    return value;
}

function nonNegativeInteger(raw: unknown, filename: string, path: string): number {
    const value = finiteNumber(raw, filename, path);
    if (!Number.isInteger(value) || value < 0) fail(filename, path, "expected a non-negative integer");
    return value;
}

function optionalString(raw: unknown, filename: string, path: string): string | undefined {
    return raw == null ? undefined : requiredString(raw, filename, path, true);
}

function requiredString(raw: unknown, filename: string, path: string, allowEmpty = false): string {
    if (typeof raw !== "string" || (!allowEmpty && !raw.trim())) fail(filename, path, allowEmpty ? "expected a string" : "expected a non-empty string");
    return raw;
}

function record(raw: unknown, filename: string, path: string): Record<string, unknown> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(filename, path, "expected an object");
    return raw as Record<string, unknown>;
}

function fail(filename: string, path: string, message: string): never {
    throw new Error(`${filename}: ${path}: ${message}`);
}

/** Convert a display name to a slug: "Low-Light Vision" → "low-light-vision". */
function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-|-$/g, "");
}

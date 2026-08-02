// ---------------------------------------------------------------------------
// Creature statblock types — internal normalised representation
//
// The YAML frontmatter uses the Pathfinder 2e Creature Layout format
// (see Fantasy Statblocks plugin). The *parser* translates that format into
// these internal types, which the *actor builder* then maps to Foundry JSON.
// ---------------------------------------------------------------------------

/** Normalised creature statblock ready for conversion. */
export interface CreatureStatblock {
    /** Must be true for Fantasy Statblocks to parse this note. */
    statblock: true;
    /** Fantasy Statblocks layout name. */
    layout: string;
    /** Creature name. */
    name: string;
    /** Creature level (can be negative). Parsed from "Creature -1". */
    level: number;
    /** Rarity. */
    rarity: "common" | "uncommon" | "rare" | "unique";
    /** Size category (abbreviated). */
    size: "tiny" | "sm" | "med" | "lg" | "huge" | "grg";
    /** Trait slugs (e.g. ["beast", "dragon"]). */
    traits: string[];
    /** If false, converter skips unless --include-unpublished. */
    published: boolean;
    /** Optional source name. */
    source?: string;

    /** Ability modifiers (not scores). */
    abilities: AbilityScores;

    /** Perception modifier and senses. */
    perception: PerceptionData;

    /** Known languages. */
    languages: string[];

    /** Trained/notable skills, keyed by slug → modifier. */
    skills: Record<string, number>;

    /** Armor class. */
    ac: number;
    /** Optional AC note (e.g. "all-around vision"). */
    acNote?: string;

    /** Saving throw modifiers. */
    saves: SavesData;

    /** Hit points. */
    hp: number;
    /** Optional HP note (e.g. "fast healing 5"). */
    hpNote?: string;

    /** Immunities description (e.g. "fire, poison"). */
    immunities: string;
    /** Resistances description (e.g. "cold 5, electricity 5"). */
    resistances: string;
    /** Weaknesses description (e.g. "cold iron 5"). */
    weaknesses: string;

    /** Movement speeds. */
    speed: SpeedData;

    /** Attack strikes (normalised from layout's `attacks`). */
    strikes: StrikeData[];

    /** Abilities shown above the stats block. */
    abilities_top: AbilityEntry[];
    /** Abilities shown in the middle (after defenses, before attacks). */
    abilities_mid: AbilityEntry[];
    /** Abilities shown at the bottom (after attacks). */
    abilities_bot: AbilityEntry[];

    /** Spellcasting entries (optional). */
    spellcasting?: SpellcastingEntry[];

    /** Custom lore skills (optional, extracted from skills array). */
    lore?: LoreSkillData[];

    /** Item description (e.g. "+1 longsword, leather armor"). */
    items?: string;
}

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------

export interface AbilityScores {
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
}

export interface PerceptionData {
    mod: number;
    senses: SenseData[];
    /** Authored sense text the strict vocabulary doesn't cover (e.g. "sandsense (imprecise) 120 feet"). */
    details?: string;
}

export interface SenseData {
    type: string;
    acuity?: "precise" | "imprecise" | "vague";
    range?: number;
}

export interface SavesData {
    fort: number;
    ref: number;
    will: number;
    /** General saves note (e.g. "+2 status to all saves vs. magic"). */
    note?: string;
}

export interface SpeedData {
    land: number;
    fly?: number;
    swim?: number;
    climb?: number;
    burrow?: number;
    /** Speed note (e.g. "freedom of movement"). */
    note?: string;
}

interface StrikeBase {
    name: string;
    type: "melee" | "ranged";
    traits: string[];
    damage: DamageRollData[];
    /** Non-mechanical authored attack metadata retained for display. */
    otherTags?: string[];
    /** Attack effects (e.g. "Grab", "Knockdown"). */
    effects?: string[];
    /** Range for ranged attacks. */
    range?: { increment?: number; max?: number };
}

export interface OrdinaryStrikeData extends StrikeBase {
    action?: "strike";
    bonus: number;
    dc?: never;
    area?: never;
}

export interface AreaAttackData extends StrikeBase {
    action: "area-fire" | "auto-fire";
    dc: number;
    bonus?: never;
    area: { type: string; value: number };
}

export type StrikeData = OrdinaryStrikeData | AreaAttackData;

export interface DamageRollData {
    formula: string;
    type: string;
    /** Persistent damage is serialized separately from its underlying type. */
    category?: "persistent";
}

/**
 * Ability entry as displayed in the statblock.
 *
 * In the layout YAML, abilities use `{name, desc}`. The name may contain
 * action icons (⬻ ⬺ ⬽ ⬲ ⭓) which the converter parses to determine
 * the action type. Extra converter-only fields (traits, category) are
 * stored alongside and ignored by the layout renderer.
 */
export interface AbilityEntry {
    /** Display name, may include action icon prefix. */
    name: string;
    /** Description text (markdown). */
    desc: string;
    /** Traits (converter-only, layout ignores). */
    traits?: string[];
    /** Category (converter-only, layout ignores). */
    category?: "offensive" | "defensive" | "interaction";
}

/**
 * Spellcasting entry using the layout's description-based format.
 *
 * Instead of structured spell lists, the layout uses a `desc` string like:
 * "**4th** heal (x4); **Cantrips (4th)** detect magic"
 */
export interface SpellcastingEntry {
    name: string;
    dc?: number;
    bonus?: number;
    fp?: number;
    /** Spell list as a description string. */
    desc: string;
}

export interface LoreSkillData {
    name: string;
    mod: number;
}

// ---------------------------------------------------------------------------
// Parsed creature (after frontmatter extraction)
// ---------------------------------------------------------------------------

/** A parsed creature ready for conversion. */
export interface ParsedCreature {
    /** Filename-derived slug (e.g. "scrap-rat"). */
    slug: string;
    /** Validated and normalised statblock data. */
    statblock: CreatureStatblock;
}

/**
 * PRAD (Players Roll All Dice) — Type Definitions
 *
 * Interfaces describing the SF2e system data structures PRAD interacts with.
 * These are intentionally partial — only the fields PRAD needs to read.
 *
 * Common types (DegreeOfSuccessIndex, DegreeOfSuccessString, SaveType, etc.)
 * live in `../shared/types.ts` and are re-exported here for convenience.
 */

// Re-export shared types so existing PRAD consumers don't need to change deeply
export type {
    DegreeOfSuccessIndex,
    DegreeOfSuccessString,
    SaveType,
    Sf2eChatMessageFlags,
} from "../../../shared/types.js";

export {
    DEGREE_STRINGS,
    SAVE_TYPES,
} from "../../../shared/types.js";

// ─── NPC System Data (partial) ───────────────────────────────────────────────

export interface NpcSaveEntry {
    /** Total save modifier (e.g. +14) */
    value: number;
}

export interface NpcSaves {
    fortitude: NpcSaveEntry;
    reflex: NpcSaveEntry;
    will: NpcSaveEntry;
}

export interface NpcAC {
    /** Armor Class value */
    value: number;
}

export interface NpcAttributes {
    ac: NpcAC;
}

export interface NpcSystemData {
    saves: NpcSaves;
    attributes: NpcAttributes;
}

// ─── PC System Data (partial) ────────────────────────────────────────────────

export interface PcAC {
    value: number;
}

export interface PcAttributes {
    ac: PcAC;
}

export interface PcSystemData {
    attributes: PcAttributes;
}

// ─── Strike / Melee Item Data (partial) ──────────────────────────────────────

export interface StrikeBonusData {
    /** The total attack modifier for this strike (e.g. +18) */
    value: number;
}

export interface StrikeSystemData {
    bonus: StrikeBonusData;
}

// ─── PRAD Roll Result ────────────────────────────────────────────────────────

import type { DegreeOfSuccessIndex } from "../../../shared/types.js";

/** The kind of PRAD roll being made. */
export type PradRollType = "armor-save" | "overcome";

/** Complete result payload for a PRAD roll, used to render chat cards. */
export interface PradRollResult {
    /** Which inversion this roll represents */
    type: PradRollType;

    /** The player character who rolled */
    roller: {
        name: string;
        actorId: string;
        tokenId?: string;
    };

    /** The NPC involved */
    npc: {
        name: string;
        actorId: string;
        tokenId?: string;
    };

    /** Name of the weapon/strike (for armor saves) or save type (for overcome) */
    source: string;

    /** The DC the player rolled against */
    dc: number;

    /** The modifier the player applied to their roll */
    modifier: number;

    /** The natural d20 result */
    dieResult: number;

    /** Total roll result (dieResult + modifier) */
    total: number;

    /** The player's degree of success on their roll */
    playerDegree: DegreeOfSuccessIndex;

    /** The effective NPC outcome (inverted for armor saves, direct for overcome) */
    npcDegree: DegreeOfSuccessIndex;
}

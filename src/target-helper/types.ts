/**
 * Target Helper — Type Definitions
 *
 * Stores per-target save data in chat message flags so target rows
 * and save results can be rendered inline on spell/area/check cards.
 *
 * Common types (DegreeOfSuccessString, SaveType, etc.) live in
 * `../shared/types.ts` and are re-exported here for convenience.
 */

// Re-export shared types so Target Helper consumers can import from here
export type { DegreeOfSuccessString, SaveType } from "../shared/types.js";
export { SAVE_TYPES } from "../shared/types.js";
export type { SaveInfo, SaveResultData, PersistedSaveResultData, SaveDisplayInfo } from "../shared/types.js";
export { SAVE_DETAILS } from "../shared/types.js";

// Re-export shared degree inversion (string-based)
export { invertDegreeString as invertDegree } from "../shared/degree.js";

// ─── Import shared types for use within this file ────────────────────────────

import type { SaveInfo, PersistedSaveResultData } from "../shared/types.js";

// ─── Flag Data (stored on ChatMessage flags) ─────────────────────────────────

/** The type of message the target helper is handling. */
export type TargetMessageType = "spell" | "area" | "check" | "action" | "prad-attack";

/**
 * Root flag structure stored at `flags[MODULE_ID].targetHelper`.
 */
export interface TargetHelperFlagData {
    /** What kind of message this is. */
    type: TargetMessageType;

    /** Token document UUIDs of targeted tokens. */
    targets: string[];

    /** Monotonically increasing generation retained for diagnostics and leaf keys. */
    generation: number;

    /** Globally unique identity minted for every target-list revision. */
    revision: string;

    /** Save info — the save DC, statistic, and whether it's basic. */
    save?: SaveInfo;

    /**
     * Normalized in-memory per-target save results, keyed by token ID.
     * Raw persisted leaves use an encoded exact provenance key.
     */
    saves?: Record<string, PersistedSaveResultData>;

    /** Actor UUID of the message author (caster). */
    author?: string;

    /** Item UUID (spell/weapon that triggered this). */
    item?: string;

    /** Extra roll options (e.g. "damaging-effect"). */
    options?: string[];

    /** Trusted resolved AC for the exact target of an intercepted native attack. */
    contextualTargetAc?: {
        targetUuid: string;
        value: number;
    };

    /** True only for a card produced by cancelling a native attack roll. */
    interceptedAttack?: boolean;

    /**
     * PRAD Overcome Mode (Inversion 2).
     * When true, the flow is inverted: the PC caster rolls an "Overcome Check"
     * against each NPC target's Save DC, instead of each NPC rolling a save
     * against the caster's Spell DC.
     */
    pradOvercome?: boolean;
}


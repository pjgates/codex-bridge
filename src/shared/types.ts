/**
 * Shared Type Definitions
 *
 * Common types used by both the PRAD and Target Helper subsystems.
 * Canonical definitions live here — subsystem-specific types stay
 * in their own `types.ts` files.
 */

// ─── Degree of Success ───────────────────────────────────────────────────────

/** Numeric index for degree of success: 0 = crit fail … 3 = crit success */
export type DegreeOfSuccessIndex = 0 | 1 | 2 | 3;

/** Human-readable degree of success string (matches SF2e convention). */
export type DegreeOfSuccessString =
    | "criticalFailure"
    | "failure"
    | "success"
    | "criticalSuccess";

/** Mapping from numeric index to string label. */
export const DEGREE_STRINGS: Record<DegreeOfSuccessIndex, DegreeOfSuccessString> = {
    0: "criticalFailure",
    1: "failure",
    2: "success",
    3: "criticalSuccess",
};

/** Reverse mapping from string label to numeric index. */
export const DEGREE_INDICES: Record<DegreeOfSuccessString, DegreeOfSuccessIndex> = {
    criticalFailure: 0,
    failure: 1,
    success: 2,
    criticalSuccess: 3,
};

// ─── Save Types ──────────────────────────────────────────────────────────────

export type SaveType = "fortitude" | "reflex" | "will";

export const SAVE_TYPES: SaveType[] = ["fortitude", "reflex", "will"];

// ─── Save Info (used by Target Helper and Shared) ────────────────────────────

/** Info about the save required (extracted from the spell/ability). */
export interface SaveInfo {
    /** The save statistic: "fortitude", "reflex", "will", or "ac" for PRAD. */
    statistic: string;
    /** The DC to roll against. */
    dc: number;
    /** Whether this is a basic save (half damage on success, etc.). */
    basic: boolean;
}

/** Result of a single target's save roll (or PRAD overcome roll). */
export interface SaveResultData {
    /** Total roll value. */
    value: number;
    /** The d20 die result (1–20). */
    die: number;
    /**
     * Degree of success string.
     * For normal saves: the target's save degree.
     * For PRAD overcome: the **inverted** degree (NPC's effective save result).
     */
    success: DegreeOfSuccessString;
    /** Modifiers that contributed to the roll. */
    modifiers: { label: string; modifier: number }[];
    /** Whether the roll was whispered and must be redacted before persistence. */
    private: boolean;
    /** The statistic used for the roll. */
    statistic: string;
    /** Exact Token document UUID rolled for this result. Required before persistence. */
    targetUuid?: string;
    /** Target-list generation captured when the roll began. Required before persistence. */
    generation?: number;
    /** Globally unique target-list revision captured when the roll began. Required before persistence. */
    revision?: string;

    // ─── PRAD Overcome extras ────────────────────────────────────────
    /** If from a PRAD overcome roll: the NPC's Save DC rolled against. */
    overcomeDc?: number;
    /** If from a PRAD overcome roll: the PC's raw degree of success (before inversion). */
    overcomeSuccess?: DegreeOfSuccessString;
}

/** Validated public save result with provenance required for inline flag persistence. */
export interface PersistedPublicSaveResultData extends SaveResultData {
    private: false;
    targetUuid: string;
    generation: number;
    revision: string;
}

/** Redacted completion marker for a private inline save. */
export interface PersistedPrivateSaveResultData {
    private: true;
    statistic: string;
    targetUuid: string;
    generation: number;
    revision: string;
}

/** Validated save result or redacted private completion marker stored in shared chat flags. */
export type PersistedSaveResultData = PersistedPublicSaveResultData | PersistedPrivateSaveResultData;

/** Display info for a save type (icon + i18n label key). */
export interface SaveDisplayInfo {
    icon: string;
    label: string;
}

export const SAVE_DETAILS: Record<string, SaveDisplayInfo> = {
    fortitude: { icon: "fa-solid fa-chess-rook", label: "PF2E.SavesFortitude" },
    reflex: { icon: "fa-solid fa-person-running", label: "PF2E.SavesReflex" },
    will: { icon: "fa-solid fa-brain", label: "PF2E.SavesWill" },
    ac: { icon: "fa-solid fa-shield-halved", label: "sf2e-forge-custom.prad.armorSave" },
};

// ─── Chat Message Flags (used by Shared and PRAD) ────────────────────────────

/**
 * Shape of the flags we read from SF2e system chat messages
 * to identify attack rolls, save rolls, etc.
 */
export interface Sf2eChatMessageFlags {
    /** The type of check: "attack-roll", "saving-throw", "spell-attack-roll", etc. */
    type?: string;
    /** The originating item's SF2e chat flag payload. */
    origin?: {
        actor?: string;
        uuid?: string;
        type?: string;
        rollOptions?: string[];
    };
    /** The target actor's UUID(s) */
    target?: {
        actor?: string;
        token?: string;
    };
    /** Context about the roll */
    context?: {
        type?: string;
        dc?: { value: number };
        domains?: string[];
        options?: string[];
        target?: {
            actor?: string | { id?: string };
            token?: string;
        };
        origin?: {
            actor?: string;
            token?: string;
        };
    };
    /** Modifiers applied to the roll */
    modifiers?: Array<{
        label: string;
        modifier: number;
        type: string;
        enabled: boolean;
    }>;
}

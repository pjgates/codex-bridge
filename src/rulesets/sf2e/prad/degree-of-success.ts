/**
 * PRAD (Players Roll All Dice) — Degree of Success
 *
 * Re-exports shared degree logic and defines PRAD-specific
 * localization key mappings for NPC-side outcomes.
 */

import type { DegreeOfSuccessIndex } from "../../../shared/types.js";

// Re-export shared functions so existing PRAD consumers keep working
export {
    calculateDegree,
    invertDegreeIndex as invertDegree,
    mapOvercomeDegree,
    degreeToString,
} from "../../../shared/degree.js";

// ─── PRAD-Specific Labels ────────────────────────────────────────────────────

/**
 * Localization keys for the NPC-side outcome of an armor save.
 * Maps the NPC's effective degree (after inversion) to the
 * appropriate localization key.
 */
export const ARMOR_SAVE_NPC_EFFECT_KEYS: Record<DegreeOfSuccessIndex, string> = {
    0: "sf2e-forge-custom.prad.targetEffect.criticalMiss",
    1: "sf2e-forge-custom.prad.targetEffect.miss",
    2: "sf2e-forge-custom.prad.targetEffect.hit",
    3: "sf2e-forge-custom.prad.targetEffect.criticalHit",
};

/**
 * Localization keys for the NPC-side outcome of an overcome check.
 * Maps the NPC's effective degree (after mapping) to the
 * appropriate localization key.
 */
export const OVERCOME_NPC_EFFECT_KEYS: Record<DegreeOfSuccessIndex, string> = {
    0: "sf2e-forge-custom.prad.targetEffect.critFailSave",
    1: "sf2e-forge-custom.prad.targetEffect.failSave",
    2: "sf2e-forge-custom.prad.targetEffect.successSave",
    3: "sf2e-forge-custom.prad.targetEffect.critSuccessSave",
};

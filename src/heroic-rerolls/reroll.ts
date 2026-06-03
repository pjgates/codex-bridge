/** Heroic Rerolls — Hero Point reroll floor. */

import { MODULE_ID } from "../constants.js";

const HEROIC_REROLL_MINIMUM = 10;

interface HeroicRerollResult {
    active?: boolean;
    result: number;
}

interface HeroicRerollDie {
    readonly number?: number;
    readonly faces?: number;
    readonly results: HeroicRerollResult[];
}

interface HeroicRerollRoll {
    readonly dice: readonly HeroicRerollDie[];
    _total: number;
}

/**
 * Apply the Heroic Rerolls floor to an evaluated Hero Point reroll.
 * Returns whether the roll changed.
 */
export function applyHeroicRerollFloor(
    roll: HeroicRerollRoll,
    resource: Sf2eRerollResource | null,
): boolean {
    if (resource?.slug !== "hero-points") return false;

    const die = roll.dice.find((candidate) => candidate.number === 1 && candidate.faces === 20);
    const result = die?.results.find((candidate) => candidate.active && candidate.result < HEROIC_REROLL_MINIMUM);
    if (!result) return false;

    roll._total += HEROIC_REROLL_MINIMUM - result.result;
    result.result = HEROIC_REROLL_MINIMUM;
    return true;
}

/** Handle an evaluated PF2e reroll without mutating the discarded roll. */
export function onHeroicReroll(
    _oldRoll: Roll,
    newRoll: Roll,
    resource: Sf2eRerollResource | null,
): void {
    applyHeroicRerollFloor(newRoll as unknown as HeroicRerollRoll, resource);
}

/** Activate Heroic Rerolls after Foundry has initialized its hook system. */
export function activateHeroicRerolls(): void {
    Hooks.on("pf2e.reroll", onHeroicReroll);
    console.log(`${MODULE_ID} | Heroic Rerolls variant is ENABLED`);
}

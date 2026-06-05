/** Heroic Rerolls — Hero Point reroll floor. */

import { MODULE_ID } from "../constants.js";

const HEROIC_REROLL_MODIFIER = "min10";

interface HeroicRerollDie {
    readonly number?: number;
    readonly faces?: number;
    readonly modifiers: string[];
}

interface HeroicRerollRoll {
    readonly dice: readonly HeroicRerollDie[];
}

/** Add the Heroic Rerolls minimum to an unevaluated single-d20 Hero Point reroll. */
export function addHeroicRerollMinimum(
    roll: HeroicRerollRoll,
    resource: Sf2eRerollResource | null,
): boolean {
    if (resource?.slug !== "hero-points") return false;

    let d20: HeroicRerollDie | undefined;
    for (const die of roll.dice) {
        if (die.faces !== 20) continue;
        if (die.number !== 1 || d20) return false;
        d20 = die;
    }

    if (!d20) return false;
    const existingMinimum = d20.modifiers.reduce((minimum, modifier) => {
        const match = /^min(\d+)$/.exec(modifier);
        return match ? Math.max(minimum, Number(match[1])) : minimum;
    }, 0);
    if (existingMinimum >= 10) return false;

    d20.modifiers.push(HEROIC_REROLL_MODIFIER);
    return true;
}

/** Add the Heroic Rerolls minimum before PF2e evaluates the replacement roll. */
export function onHeroicPreReroll(
    _oldRoll: Roll,
    unevaluatedNewRoll: Roll,
    resource: Sf2eRerollResource | null,
): void {
    addHeroicRerollMinimum(unevaluatedNewRoll, resource);
}

/** Activate Heroic Rerolls after Foundry has initialized its hook system. */
export function activateHeroicRerolls(): void {
    Hooks.on("pf2e.preReroll", onHeroicPreReroll);
    console.log(`${MODULE_ID} | Heroic Rerolls variant is ENABLED`);
}

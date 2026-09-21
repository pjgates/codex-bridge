import { activateFlyingEffect, ensureFlyingMacro } from "./effect.js";
import { activateFlyingReminder } from "./reminder.js";
import { activateFalling } from "./fall.js";

export { toggleFlying, isFlying, FLYING_SLUG } from "./effect.js";

/** Flying effect with movement-action sync, falling, and a turn-start reminder. PF2e and SF2e only. */
export function activateFlying(): void {
    if (!["pf2e", "sf2e"].includes(game.system!.id)) return;
    activateFlyingEffect();
    activateFlyingReminder();
    activateFalling();
    void ensureFlyingMacro();
}

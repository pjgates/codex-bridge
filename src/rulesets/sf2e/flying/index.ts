import { activateFlyingEffect, ensureFlyingMacro } from "./effect.js";
import { activateFlyingReminder } from "./reminder.js";

export { toggleFlying, isFlying, FLYING_SLUG } from "./effect.js";

/** Flying effect with movement-action sync and a turn-start reminder. PF2e and SF2e only. */
export function activateFlying(): void {
    if (!["pf2e", "sf2e"].includes(game.system!.id)) return;
    activateFlyingEffect();
    activateFlyingReminder();
    void ensureFlyingMacro();
}

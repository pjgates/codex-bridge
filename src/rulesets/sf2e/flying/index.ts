import { activateFlyingEffect, ensureFlyingMacro } from "./effect.js";

export { toggleFlying, isFlying, FLYING_SLUG } from "./effect.js";

/** Flying effect with movement-action sync. PF2e and SF2e only. */
export function activateFlying(): void {
    if (!["pf2e", "sf2e"].includes(game.system!.id)) return;
    activateFlyingEffect();
    void ensureFlyingMacro();
}

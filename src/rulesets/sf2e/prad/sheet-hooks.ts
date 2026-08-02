/**
 * PRAD (Players Roll All Dice) — Unified Sheet Hook Dispatcher
 *
 * Registers sheet render hooks that dispatch to NPC or PC sheet augmentation
 * based on actor type. Foundry V14 uses ApplicationV2 sheet hooks while older
 * local development builds may still emit the legacy ActorSheet hook.
 */

import { MODULE_ID } from "../../../constants.js";
import { onRenderNpcSheet } from "./npc-sheet.js";
import { onRenderPcSheet } from "./pc-sheet.js";

/**
 * Register unified sheet augmentation hooks for both Foundry V14
 * ApplicationV2 sheets and the legacy ActorSheet hook.
 */
export function registerPradSheetHooks(): void {
    Hooks.on("renderApplicationV2", onRenderActorSheet);
    Hooks.on("renderActorSheet", onRenderActorSheet);
    console.log(`${MODULE_ID} | PRAD: Unified sheet augmentation hooks registered`);
}

/**
 * Unified hook handler — dispatches by actor type.
 */
function onRenderActorSheet(
    sheet: object,
    html: JQuery<HTMLElement> | HTMLElement,
    data: object,
): void {
    try {
        const s = sheet as Sf2eActorSheet;
        const actor = s.actor ?? s.document ?? s.object;
        if (!actor) return;

        const actorType = actor.type as string;
        if (actorType === "npc") {
            onRenderNpcSheet(s, html, data);
        } else if (actorType === "character") {
            onRenderPcSheet(s, html, data);
        }
    } catch (err) {
        console.error(`${MODULE_ID} | PRAD: Error in renderActorSheet hook`, err);
    }
}

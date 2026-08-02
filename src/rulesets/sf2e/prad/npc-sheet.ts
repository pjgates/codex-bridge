/**
 * PRAD (Players Roll All Dice) — NPC Sheet Modifications
 *
 * Injects Attack DCs and Save DCs into the NPC sheet when
 * the PRAD variant rule is active. This gives the GM quick
 * reference for the DCs players will roll against.
 */

import { getAttackDC, getSaveDC, getSaveModifier } from "./dc.js";
import { postAttackCard } from "./intercept-attack.js";
import { SAVE_TYPES } from "./types.js";
import type { SaveType } from "./types.js";
import { resolveHtmlRoot } from "../../../shared/html.js";

/**
 * Handle rendering of an NPC actor sheet.
 * Called by the unified sheet-hooks dispatcher when actor.type === "npc".
 * Injects DC badges next to saves and attacks.
 */
export function onRenderNpcSheet(
    sheet: Sf2eActorSheet,
    html: JQuery<HTMLElement> | HTMLElement,
    _data: object,
): void {
    const actor: Actor.Implementation | undefined = sheet.actor ?? sheet.document ?? sheet.object;
    if (!actor) return;

    // Only show to GM
    if (!game.user?.isGM) return;

    const root = resolveHtmlRoot(html);
    if (!root) return;

    injectSaveDCs(root, actor);
    injectAttackDCs(root, actor);
}

// ─── Save DC Labels ─────────────────────────────────────────────────────────

/**
 * Inject Save DC labels below each save modifier on the NPC sheet.
 * Leaves the original modifier input untouched (avoids Foundry data-binding
 * conflicts) and adds a small "DC XX" badge beneath it.
 */
function injectSaveDCs(root: HTMLElement, actor: Actor.Implementation): void {
    for (const saveType of SAVE_TYPES) {
        const saveMod = getSaveModifier(actor, saveType as SaveType);
        const saveDCValue = getSaveDC(saveMod);

        const selectors = [
            `[data-statistic="${saveType}"]`,
            `[data-slug="${saveType}"]`,
        ];

        for (const selector of selectors) {
            const elements = root.querySelectorAll<HTMLElement>(selector);
            for (const el of elements) {
                const container = el.closest("li") ?? el.parentElement;
                if (!container) continue;

                if (container.classList.contains("prad-modified")) continue;
                container.classList.add("prad-modified");

                // Create a small DC badge and append it to the container
                const dcBadge = document.createElement("div");
                dcBadge.className = "prad-save-dc-label";
                dcBadge.textContent = `DC ${saveDCValue}`;
                container.appendChild(dcBadge);
            }
        }
    }
}

// ─── Attack DC Replacement ───────────────────────────────────────────────────

/** Resolve a prepared strike variant without depending on localized presentation labels. */
export function getPreparedStrikeVariantDC(
    actor: Actor.Implementation,
    strike: Item.Implementation,
    variantIndex: number,
): number | undefined {
    if (!Number.isInteger(variantIndex) || variantIndex < 0) return;

    const actions = (actor.system as Sf2eActorSystemData)?.actions ?? [];
    const action = actions.find((candidate) => candidate.type === "strike" && (
        candidate.item === strike || candidate.item?.id === strike.id
    ));
    const totalModifier = action?.totalModifier;
    const penalty = action?.variants?.[variantIndex]?.penalty;
    return typeof totalModifier === "number" && Number.isFinite(totalModifier)
        && typeof penalty === "number" && Number.isFinite(penalty)
        ? getAttackDC(totalModifier + penalty)
        : undefined;
}

/**
 * Replace attack modifiers on the NPC sheet with Attack DCs, and hijack
 * click handlers so clicking a DC triggers a player armor save roll.
 */
function injectAttackDCs(root: HTMLElement, actor: Actor.Implementation): void {
    // Find strike items on the actor
    const allItems = actor.items.contents as Item.Implementation[];
    const strikes = allItems.filter(
        (i) => (i.type as string) === "melee" || (i.type as string) === "ranged" || (i.type as string) === "strike"
    );

    for (const strike of strikes) {

        // Try to find the strike's entry in the sheet by item ID
        const selectors = [
            `[data-item-id="${strike.id}"]`,
            `[data-entry-id="${strike.id}"]`,
        ];

        for (const selector of selectors) {
            const elements = root.querySelectorAll<HTMLElement>(selector);
            for (const el of elements) {
                if (el.classList.contains("prad-modified")) continue;
                el.classList.add("prad-modified");

                // SF2e identifies the mechanical prepared strike variant with
                // data-variant-index; rendered button text is localized presentation only.
                const strikeButtons = el.querySelectorAll<HTMLElement>('button[data-action="strike-attack"], button.attack-button');
                for (const btn of strikeButtons) {
                    const variantIndex = btn.dataset.variantIndex === undefined ? Number.NaN : Number(btn.dataset.variantIndex);
                    const dc = getPreparedStrikeVariantDC(actor, strike, variantIndex);
                    if (dc === undefined) continue;

                    btn.textContent = `DC ${dc}`;
                    btn.classList.add("prad-dc-button");

                    const capturedAttacker = actor;
                    const capturedWeaponItem = strike;
                    btn.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        ev.stopImmediatePropagation();

                        onStrikeDCClick(capturedAttacker, dc, capturedWeaponItem);
                    }, { capture: true });
                }

                // Also look for modifier displays
                const modifierEls = el.querySelectorAll<HTMLElement>('.modifier, .attack-modifier, [data-modifier]');
                for (const modEl of modifierEls) {
                    const baseDC = getPreparedStrikeVariantDC(actor, strike, 0);
                    if (baseDC === undefined) continue;
                    modEl.textContent = `DC ${baseDC}`;
                    modEl.classList.add("prad-dc-value");
                }
            }
        }
    }
}

// ─── Strike DC Click Handler ─────────────────────────────────────────────────

/**
 * Handle a click on an NPC's Attack DC button.
 * Posts an attack card to chat with an "Armor Save" button for players to click.
 */
function onStrikeDCClick(
    attacker: Actor.Implementation,
    attackDC: number,
    weaponItem: Item.Implementation,
): void {
    const targetTokenUUIDs: string[] = [];
    const targets = (game as Sf2eGame).user?.targets;
    if (targets && typeof (targets as Iterable<unknown>)[Symbol.iterator] === "function") {
        for (const token of targets) {
            if (token.actor) targetTokenUUIDs.push(token.document?.uuid ?? token.uuid);
        }
    }

    const attackerTokenUUID = (attacker as Sf2eActor & { readonly token?: Sf2eTokenDocument | null }).token?.uuid;
    void postAttackCard({ attacker, attackDC, attackerTokenUUID, weaponItem, targetTokenUUIDs }).catch((err: unknown) => {
        console.error("sf2e-forge-custom | PRAD: Error posting NPC-sheet attack card", err);
        ui.notifications!.error(game.i18n!.localize("sf2e-forge-custom.prad.attackCardFailed"));
    });
}

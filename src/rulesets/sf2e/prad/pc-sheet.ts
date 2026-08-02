/**
 * PRAD (Players Roll All Dice) — PC Sheet Modifications
 *
 * Injects Armor Save modifiers into the PC character sheet when
 * the PRAD variant rule is active. This shows players their
 * armor save modifier derived from their AC.
 */

import { getArmorSaveModifier, getPcAC, getOvercomeModifier, getPcSpellDC } from "./dc.js";
import { resolveHtmlRoot } from "../../../shared/html.js";

/**
 * Handle rendering of a PC character sheet.
 * Called by the unified sheet-hooks dispatcher when actor.type === "character".
 * Injects armor save and overcome modifiers.
 */
export function onRenderPcSheet(
    sheet: Sf2eActorSheet,
    html: JQuery<HTMLElement> | HTMLElement,
    _data: object,
): void {
    const actor: Actor.Implementation | undefined = sheet.actor ?? sheet.document ?? sheet.object;
    if (!actor) return;

    const root = resolveHtmlRoot(html);
    if (!root) return;

    injectArmorSave(root, actor);
    injectOvercomeModifier(root, actor);
}

// ─── Armor Save Replacement ──────────────────────────────────────────────────

/**
 * Replace the AC display on the PC sheet with the Armor Save modifier.
 * Changes both the value and the label.
 */
function injectArmorSave(root: HTMLElement, actor: Actor): void {
    // Check if already modified
    if (root.querySelector(".prad-modified")) return;

    const ac = getPcAC(actor);
    const armorSaveMod = getArmorSaveModifier(ac);
    const modStr = armorSaveMod >= 0 ? `+${armorSaveMod}` : `${armorSaveMod}`;

    // Target the specific .ac element inside .armor-class (SF2e structure)
    // Structure: .ac > .data-value > h2 (value) and .ac > .sidebar_label (label)
    const acElement = root.querySelector<HTMLElement>('.armor-class .ac');
    
    if (acElement) {
        // Replace the value (h2 inside .data-value)
        const valueEl = acElement.querySelector<HTMLElement>('.data-value h2');
        if (valueEl) {
            valueEl.textContent = modStr;
            valueEl.classList.add("prad-modified");
        }
        
        // Replace the label
        const labelEl = acElement.querySelector<HTMLElement>('.sidebar_label');
        if (labelEl) {
            labelEl.textContent = game.i18n!.localize("sf2e-forge-custom.prad.armorLabel");
            labelEl.classList.add("prad-modified");
        }
        
        // Mark the container as modified
        acElement.classList.add("prad-modified", "prad-armor-save");
        return;
    }

    // Fallback for other sheet structures
    const fallbackSelectors = [
        '[data-statistic="ac"]',
        '[data-slug="ac"]',
    ];

    for (const selector of fallbackSelectors) {
        const el = root.querySelector<HTMLElement>(selector);
        if (el && !el.classList.contains("prad-modified")) {
            const valueEl = el.querySelector<HTMLElement>('.value, .statistic-value, h2, h3');
            if (valueEl) {
                valueEl.textContent = modStr;
            }
            el.classList.add("prad-modified");
            return;
        }
    }
}

// ─── DOM Helpers ─────────────────────────────────────────────────────────────

/**
 * Create a small badge element displaying a label and modifier value.
 * Used to inject PRAD-specific modifiers into the PC character sheet.
 */
function createModifierBadge(label: string, value: string): HTMLSpanElement {
    const badge = document.createElement("span");
    badge.className = "prad-modifier-badge";

    const labelElement = document.createElement("span");
    labelElement.className = "prad-badge-label";
    labelElement.textContent = label;
    badge.appendChild(labelElement);

    const valueElement = document.createElement("span");
    valueElement.className = "prad-badge-value";
    valueElement.textContent = value;
    badge.appendChild(valueElement);
    return badge;
}

// ─── Overcome Modifier Injection ─────────────────────────────────────────────

/**
 * Find spell DC or class DC displays and add the overcome modifier.
 */
function injectOvercomeModifier(root: HTMLElement, actor: Actor): void {
    const spellDC = getPcSpellDC(actor);
    if (spellDC <= 10) return; // No meaningful spellcasting

    const overcomeMod = getOvercomeModifier(spellDC);
    const modStr = overcomeMod >= 0 ? `+${overcomeMod}` : `${overcomeMod}`;

    // Try multiple selectors for spell DC / class DC
    const selectors = [
        '[data-statistic="spell-dc"]',
        '[data-statistic="class-dc"]',
        '[data-slug="spell-dc"]',
        '[data-slug="class-dc"]',
        '.spell-dc',
        '.class-dc',
        '.spellcasting-dc',
    ];

    for (const selector of selectors) {
        const elements = root.querySelectorAll<HTMLElement>(selector);
        for (const el of elements) {
            // Don't add twice
            if (el.querySelector(".prad-overcome-badge")) continue;

            const badge = createModifierBadge(
                game.i18n!.localize("sf2e-forge-custom.prad.overcomeCheck"),
                modStr
            );
            badge.classList.add("prad-overcome-badge");

            const valueEl = el.querySelector(".value, .dc-value, .statistic-value");
            if (valueEl) {
                valueEl.parentElement?.insertBefore(badge, valueEl.nextSibling);
            } else {
                el.appendChild(badge);
            }
        }
    }
}

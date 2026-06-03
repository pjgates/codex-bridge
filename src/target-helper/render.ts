/**
 * Target Helper — Chat Message Rendering
 *
 * Handles the `renderChatMessage` hook to inject per-target rows
 * and replace save buttons with custom ones.
 *
 * Ported from PF2e Toolbelt's Target Helper rendering logic.
 */

import { MODULE_ID } from "../constants.js";
import { getNpcSaveModifier, getSaveDC } from "../shared/dc.js";
import { resolveHtmlRoot } from "../shared/html.js";
import {
    buildTargetRowViewModel,
    type RowRenderContext,
    type TargetTokenData,
} from "../shared/render-logic.js";
import { getCurrentTargetUUIDs, getFlagData, updateTargets } from "./flags.js";
import {
    rollNpcSaves,
    rollOvercomeAll, rollOvercomeForActiveTokens,
    rollOvercomeForTargets,
    rollSaveForActiveTokens,
    rollSavesForTargets,
} from "./save-roll.js";
import {
    SAVE_DETAILS,
    type DegreeOfSuccessString,
    type SaveResultData,
    type TargetHelperFlagData,
} from "./types.js";

// ─── Template Paths ──────────────────────────────────────────────────────────

const TEMPLATE_TARGET_ROW = `modules/${MODULE_ID}/dist/templates/target-helper/target-row.hbs`;

/**
 * Pre-load target helper templates. Call during init.
 */
export function registerTargetHelperTemplates(): void {
    foundry.applications.handlebars.loadTemplates([TEMPLATE_TARGET_ROW]);
}

// ─── Main Render Hook ────────────────────────────────────────────────────────

/**
 * Hook handler for `renderChatMessage`.
 * Reads flag data and injects target rows into the chat card.
 */
export async function onRenderTargetHelper(
    message: ChatMessage.Implementation,
    html: JQuery | HTMLElement,
    _data: Record<string, unknown>
): Promise<void> {
    const flagData = getFlagData(message);
    if (!flagData) return;

    const root = resolveHtmlRoot(html);
    if (!root) return;

    const msgContent = root.querySelector<HTMLElement>(".message-content");
    if (!msgContent) return;

    // Check if we've already rendered target rows (avoid duplicates)
    if (msgContent.querySelector(".th-target-rows")) return;

    try {
        if (flagData.type === "spell") {
            await renderSpellCard(message, msgContent, flagData);
        } else if (flagData.type === "area") {
            await renderAreaCard(message, msgContent, flagData);
        } else if (flagData.type === "check") {
            await renderCheckCard(message, msgContent, flagData);
        } else if (flagData.type === "action") {
            await renderActionCard(message, msgContent, flagData);
        } else if (flagData.type === "prad-attack") {
            await renderPradAttackCard(message, msgContent, flagData);
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Target Helper: Error rendering target rows`, err);
    }
}

// ─── Per-Type Renderers ──────────────────────────────────────────────────────

async function renderSpellCard(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    if (!flagData.save) return;

    await addTargetRows(message, msgContent, flagData);
    await replaceButton(
        message, msgContent, flagData,
        'button[data-action="spell-save"]'
    );
}

async function renderAreaCard(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    if (!flagData.save) return;

    await addTargetRows(message, msgContent, flagData);
    await replaceButton(
        message, msgContent, flagData,
        'button[data-action="roll-area-save"]'
    );
}

async function renderCheckCard(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    if (!flagData.save) return;

    await addTargetRows(message, msgContent, flagData);
    // For inline checks, the save link IS the button — we add custom buttons
    await addCheckButtons(message, msgContent, flagData);
}

async function renderActionCard(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    if (!flagData.save) return;

    await addTargetRows(message, msgContent, flagData);
    // Add set targets and roll saves buttons to the action card
    await addActionButtons(message, msgContent, flagData);
}

async function renderPradAttackCard(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    if (!flagData.save) return;

    await addTargetRows(message, msgContent, flagData);
    await replaceButton(
        message, msgContent, flagData,
        'button[data-action="prad-armor-save"]'
    );
}

// ─── Target Row Rendering ────────────────────────────────────────────────────

/**
 * Reserve the target rows container before rendering any asynchronous row
 * templates. Foundry can emit both renderChatMessageHTML and renderChatMessage
 * for the same card before either hook completes.
 */
export function reserveTargetRowsWrapper(parent: HTMLElement): HTMLDivElement | null {
    if (parent.querySelector(".th-target-rows")) return null;

    const rowsWrapper = document.createElement("div");
    rowsWrapper.className = "th-target-rows";
    parent.appendChild(rowsWrapper);
    return rowsWrapper;
}

/**
 * Render per-target rows and append them to the message content.
 */
async function addTargetRows(
    message: ChatMessage.Implementation,
    parent: HTMLElement,
    flagData: TargetHelperFlagData,
): Promise<void> {
    if (!flagData.targets?.length) return;

    const isGM = !!game.user?.isGM;
    const saves = flagData.saves ?? {};
    const saveInfo = flagData.save;
    const isPradOvercome = !!flagData.pradOvercome;

    // In PRAD Overcome mode, resolve whether the current user is the caster
    let isCasterOwner = false;
    if (isPradOvercome && flagData.author) {
        const casterActor = fromUuidSync(flagData.author) as Sf2eActor | null;
        isCasterOwner = isGM || !!(casterActor as { isOwner?: boolean } | null)?.isOwner;
    } else if (isPradOvercome) {
        isCasterOwner = isGM || !!(message as Sf2eChatMessage).isAuthor;
    }

    const saveDisplay = saveInfo
        ? SAVE_DETAILS[saveInfo.statistic] ?? SAVE_DETAILS.reflex
        : undefined;

    // Resolve tokens and build plain data for the pure view-model builder
    const resolvedTokens: Array<{ token: Sf2eTokenDocument; actor: Sf2eActor; data: TargetTokenData }> = [];
    const npcSaveDCs: Record<string, number> = {};

    for (const uuid of flagData.targets) {
        const token = fromUuidSync(uuid) as Sf2eTokenDocument | null;
        if (!token) continue;
        const actor = token.actor;
        if (!actor) continue;

        const data: TargetTokenData = {
            id: token.id,
            name: token.name ?? "Unknown",
            isHidden: !!(token.hidden || actor.hasCondition?.("unnoticed", "undetected")),
            isOwner: token.isOwner ?? false,
            hasPlayerOwner: actor.hasPlayerOwner ?? false,
        };

        // Pre-compute NPC save DC for overcome mode
        if (isPradOvercome && saveInfo) {
            npcSaveDCs[token.id] = getSaveDC(getNpcSaveModifier(actor, saveInfo.statistic));
        }

        resolvedTokens.push({ token, actor, data });
    }

    // Build the shared render context (all plain data)
    const ctx: RowRenderContext = {
        isGM,
        isPradOvercome,
        isCasterOwner,
        saveInfo,
        existingSaves: saves,
        saveDisplay,
        npcSaveDCs,
    };

    // Reserve synchronously so overlapping Foundry render hooks cannot both
    // render target rows for the same chat card.
    const rowsWrapper = reserveTargetRowsWrapper(parent);
    if (!rowsWrapper) return;

    for (const { token, data } of resolvedTokens) {
        // Pure function builds the row view model
        const viewModel = buildTargetRowViewModel(data, ctx, getSuccessLabel);
        if (!viewModel) continue;

        // Augment with tooltip (Foundry-coupled HTML — not in the pure layer)
        const targetSave = saves[data.id];
        let tooltip: string | undefined;
        if (viewModel.save && saveInfo) {
            if (isPradOvercome) {
                const dc = npcSaveDCs[data.id] ?? saveInfo.dc;
                tooltip = targetSave
                    ? buildOvercomeTooltipHtml(saveInfo.statistic, dc, targetSave, ctx.isGM || ctx.isCasterOwner)
                    : buildOvercomePreRollTooltip(saveInfo.statistic, dc);
            } else {
                tooltip = targetSave
                    ? buildTooltipHtml(saveInfo.statistic, saveInfo.dc, targetSave, ctx.isGM || data.isOwner)
                    : buildPreRollTooltip(saveInfo.statistic, saveInfo.dc);
            }
        }

        const rowHtml = await foundry.applications.handlebars.renderTemplate(TEMPLATE_TARGET_ROW, { ...viewModel } as Record<string, unknown>);
        const rowDiv = document.createElement("div");
        rowDiv.className = "target-row";
        if (isPradOvercome) rowDiv.classList.add("th-overcome");
        rowDiv.innerHTML = rowHtml;

        // Set tooltips via JS (HTML in data-tooltip attributes breaks the DOM)
        const tooltipEl = rowDiv.querySelector<HTMLElement>('[data-tooltip-content="true"]');
        if (tooltipEl && tooltip) {
            tooltipEl.dataset.tooltip = tooltip;
            delete tooltipEl.dataset.tooltipContent;
        }

        // Add event listeners (overcome mode uses different roll handler)
        attachRowListeners(rowDiv, token, message, flagData, isPradOvercome);

        rowsWrapper.appendChild(rowDiv);
    }

}

/**
 * Attach interactivity to a target row element.
 */
function attachRowListeners(
    row: HTMLElement,
    token: Sf2eTokenDocument,
    message: ChatMessage.Implementation,
    flagData: TargetHelperFlagData,
    isPradOvercome = false
): void {
    // Hover → highlight token on canvas
    row.addEventListener("mouseenter", () => {
        const canvasToken = token.object;
        if (canvasToken) canvasToken._onHoverIn?.(new Event("mouseenter"), { hoverOutOthers: true });
    });
    row.addEventListener("mouseleave", () => {
        const canvasToken = token.object;
        if (canvasToken) canvasToken._onHoverOut?.(new Event("mouseleave"));
    });

    // Click name → pan to token
    const nameEl = row.querySelector<HTMLElement>(".th-name");
    if (nameEl) {
        nameEl.style.cursor = "pointer";
        nameEl.addEventListener("click", () => {
            const canvasToken = token.object;
            if (canvasToken) {
                (canvas as unknown as Sf2eCanvas).animatePan?.({ x: canvasToken.x, y: canvasToken.y, duration: 500 });
            }
        });
    }

    // Click roll button → roll save or overcome
    const rollBtn = row.querySelector<HTMLElement>('[data-action="th-roll-save"]');
    if (rollBtn) {
        rollBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            if (isPradOvercome) {
                rollOvercomeForTargets(event as MouseEvent, message, [token]);
            } else {
                rollSavesForTargets(event as MouseEvent, message, [token]);
            }
        });
    }

    // Click ping button → ping the token
    const pingBtn = row.querySelector<HTMLElement>('[data-action="th-ping"]');
    if (pingBtn) {
        pingBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            const canvasToken = token.object;
            const sf2eCanvas = canvas as unknown as Sf2eCanvas;
            if (canvasToken && sf2eCanvas.ping) {
                sf2eCanvas.ping({ x: canvasToken.center?.x ?? canvasToken.x, y: canvasToken.center?.y ?? canvasToken.y });
            }
        });
    }
}

// ─── Button Replacement ──────────────────────────────────────────────────────

/**
 * Replace a system save button with our custom button wrapper
 * that includes Set Targets and Roll NPC Saves (or Roll All Overcome) buttons.
 */
async function replaceButton(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    flagData: TargetHelperFlagData,
    selector: string
): Promise<void> {
    const saveBtn = msgContent.querySelector<HTMLButtonElement>(selector);
    if (!saveBtn) return;

    const isPradOvercome = !!flagData.pradOvercome;

    // Create a button wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "th-buttons";

    // Clone the save button as our "fake" button
    const fakeBtn = saveBtn.cloneNode(true) as HTMLButtonElement;
    fakeBtn.removeAttribute("data-action");
    fakeBtn.classList.add("th-save-btn");

    if (isPradOvercome) {
        // Change text to "Roll Overcome" in PRAD mode
        fakeBtn.textContent = game.i18n!.localize("sf2e-forge-custom.prad.rollOvercome");
        fakeBtn.classList.add("th-overcome-btn");
    }

    // Hide the original button
    saveBtn.classList.add("hidden");
    saveBtn.after(wrapper);

    // Add button click handler
    fakeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isPradOvercome) {
            rollOvercomeForActiveTokens(event, message);
        } else {
            rollSaveForActiveTokens(event, message);
        }
    });

    wrapper.appendChild(fakeBtn);

    // Only message owners (GM or author) get the extra buttons
    const isOwner = game.user?.isGM || (message as Sf2eChatMessage).isAuthor;
    if (!isOwner) return;

    // Set Targets button
    const setTargetsBtn = document.createElement("button");
    setTargetsBtn.className = "th-set-targets";
    setTargetsBtn.title = game.i18n!.localize("sf2e-forge-custom.targetHelper.setTargets");
    setTargetsBtn.innerHTML = '<i class="fa-solid fa-bullseye-arrow"></i>';
    setTargetsBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const targets = getCurrentTargetUUIDs();
        await updateTargets(message, targets);
    });
    wrapper.prepend(setTargetsBtn);

    if (isPradOvercome) {
        // Roll All Overcome button (for all unrolled targets)
        if (hasUnrolledTargets(flagData)) {
            const rollAllBtn = document.createElement("button");
            rollAllBtn.className = "th-roll-npc-saves";
            rollAllBtn.title = game.i18n!.localize("sf2e-forge-custom.targetHelper.rollOvercomeAll");
            rollAllBtn.innerHTML = '<i class="fa-duotone fa-solid fa-dice-d20"></i>';
            rollAllBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                rollOvercomeAll(event, message);
            });
            wrapper.appendChild(rollAllBtn);
        }
    } else {
        // Roll NPC Saves button (only if there are NPCs to roll for)
        if (hasUnrolledNpcs(flagData)) {
            const rollNpcBtn = document.createElement("button");
            rollNpcBtn.className = "th-roll-npc-saves";
            rollNpcBtn.title = game.i18n!.localize("sf2e-forge-custom.targetHelper.rollNpcSaves");
            rollNpcBtn.innerHTML = '<i class="fa-duotone fa-solid fa-dice-d20"></i>';
            rollNpcBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                rollNpcSaves(event, message);
            });
            wrapper.appendChild(rollNpcBtn);
        }
    }

}

/**
 * Add buttons to an action card (set targets, roll saves / overcome).
 */
async function addActionButtons(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    const isOwner = game.user?.isGM || (message as Sf2eChatMessage).isAuthor;
    if (!isOwner) return;

    const isPradOvercome = !!flagData.pradOvercome;
    const chatCard = msgContent.querySelector(".chat-card");
    const insertPoint = chatCard ?? msgContent;

    const wrapper = document.createElement("div");
    wrapper.className = "th-buttons th-action-buttons";

    const setTargetsBtn = document.createElement("button");
    setTargetsBtn.className = "th-set-targets";
    setTargetsBtn.title = game.i18n!.localize("sf2e-forge-custom.targetHelper.setTargets");
    setTargetsBtn.innerHTML = '<i class="fa-solid fa-bullseye-arrow"></i>';
    setTargetsBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const targets = getCurrentTargetUUIDs();
        await updateTargets(message, targets);
    });
    wrapper.appendChild(setTargetsBtn);

    if (isPradOvercome) {
        if (hasUnrolledTargets(flagData)) {
            const rollAllBtn = document.createElement("button");
            rollAllBtn.className = "th-roll-npc-saves";
            rollAllBtn.title = game.i18n!.localize("sf2e-forge-custom.targetHelper.rollOvercomeAll");
            rollAllBtn.innerHTML = '<i class="fa-duotone fa-solid fa-dice-d20"></i>';
            rollAllBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                rollOvercomeAll(event, message);
            });
            wrapper.appendChild(rollAllBtn);
        }
    } else if (hasUnrolledNpcs(flagData)) {
        const rollNpcBtn = document.createElement("button");
        rollNpcBtn.className = "th-roll-npc-saves";
        rollNpcBtn.title = game.i18n!.localize("sf2e-forge-custom.targetHelper.rollNpcSaves");
        rollNpcBtn.innerHTML = '<i class="fa-duotone fa-solid fa-dice-d20"></i>';
        rollNpcBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            rollNpcSaves(event, message);
        });
        wrapper.appendChild(rollNpcBtn);
    }

    insertPoint.appendChild(wrapper);
}

/**
 * Add check-specific buttons (for inline check messages).
 */
async function addCheckButtons(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    const isOwner = game.user?.isGM || (message as Sf2eChatMessage).isAuthor;
    const isPradOvercome = !!flagData.pradOvercome;

    const wrapper = document.createElement("div");
    wrapper.className = "th-buttons th-check-buttons";

    if (isOwner) {
        const setTargetsBtn = document.createElement("button");
        setTargetsBtn.className = "th-set-targets";
        setTargetsBtn.title = game.i18n!.localize("sf2e-forge-custom.targetHelper.setTargets");
        setTargetsBtn.innerHTML = '<i class="fa-solid fa-bullseye-arrow"></i>';
        setTargetsBtn.addEventListener("click", async (event) => {
            event.stopPropagation();
            const targets = getCurrentTargetUUIDs();
            await updateTargets(message, targets);
        });
        wrapper.appendChild(setTargetsBtn);
    }

    if (flagData.save) {
        if (isPradOvercome) {
            // Overcome button (caster rolls against all targets)
            const overcomeBtn = document.createElement("button");
            overcomeBtn.className = "th-save-btn th-overcome-btn";
            overcomeBtn.innerHTML = `<i class="fa-solid fa-burst"></i> ${
                game.i18n!.localize("sf2e-forge-custom.prad.rollOvercome")
            }`;
            overcomeBtn.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                rollOvercomeForActiveTokens(event, message);
            });
            wrapper.appendChild(overcomeBtn);
        } else {
            // Save button for player's own tokens
            const saveBtn = document.createElement("button");
            saveBtn.className = "th-save-btn";
            const saveDisplay = SAVE_DETAILS[flagData.save.statistic] ?? SAVE_DETAILS.reflex;
            saveBtn.innerHTML = `<i class="${saveDisplay.icon}"></i> ${game.i18n!.localize("sf2e-forge-custom.targetHelper.rollSave")}`;
            saveBtn.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                rollSaveForActiveTokens(event, message);
            });
            wrapper.appendChild(saveBtn);
        }
    }

    if (isPradOvercome) {
        if (isOwner && hasUnrolledTargets(flagData)) {
            const rollAllBtn = document.createElement("button");
            rollAllBtn.className = "th-roll-npc-saves";
            rollAllBtn.title = game.i18n!.localize("sf2e-forge-custom.targetHelper.rollOvercomeAll");
            rollAllBtn.innerHTML = '<i class="fa-duotone fa-solid fa-dice-d20"></i>';
            rollAllBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                rollOvercomeAll(event, message);
            });
            wrapper.appendChild(rollAllBtn);
        }
    } else if (isOwner && hasUnrolledNpcs(flagData)) {
        const rollNpcBtn = document.createElement("button");
        rollNpcBtn.className = "th-roll-npc-saves";
        rollNpcBtn.title = game.i18n!.localize("sf2e-forge-custom.targetHelper.rollNpcSaves");
        rollNpcBtn.innerHTML = '<i class="fa-duotone fa-solid fa-dice-d20"></i>';
        rollNpcBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            rollNpcSaves(event, message);
        });
        wrapper.appendChild(rollNpcBtn);
    }

    msgContent.appendChild(wrapper);
}

// ─── Utility Functions ───────────────────────────────────────────────────────

function hasUnrolledNpcs(flagData: TargetHelperFlagData): boolean {
    if (!game.user?.isGM || !flagData.save) return false;

    const existingSaves = flagData.saves ?? {};
    for (const uuid of flagData.targets) {
        const token = fromUuidSync(uuid) as Sf2eTokenDocument | null;
        if (!token?.actor) continue;
        if (token.actor.hasPlayerOwner) continue;
        if (existingSaves[token.id]) continue;
        if (!token.actor.getStatistic?.(flagData.save.statistic)) continue;
        return true;
    }
    return false;
}

/**
 * Check if there are any targets that haven't been rolled yet (for PRAD Overcome).
 */
function hasUnrolledTargets(flagData: TargetHelperFlagData): boolean {
    if (!flagData.save) return false;

    const existingSaves = flagData.saves ?? {};
    for (const uuid of flagData.targets) {
        const token = fromUuidSync(uuid) as Sf2eTokenDocument | null;
        if (!token?.actor) continue;
        if (existingSaves[token.id]) continue;
        return true;
    }
    return false;
}

function getSuccessLabel(success: DegreeOfSuccessString): string {
    const i18nKeys: Record<DegreeOfSuccessString, string> = {
        criticalSuccess: "sf2e-forge-custom.degree.criticalSuccess",
        success: "sf2e-forge-custom.degree.success",
        failure: "sf2e-forge-custom.degree.failure",
        criticalFailure: "sf2e-forge-custom.degree.criticalFailure",
    };
    return game.i18n!.localize(i18nKeys[success]) ?? success;
}

function buildTooltipHtml(
    statistic: string,
    dc: number,
    save: SaveResultData,
    canSeeDetails: boolean
): string {
    const saveLabel = statistic.charAt(0).toUpperCase() + statistic.slice(1);
    let html = `<div class="th-tooltip">`;
    html += `<div>${saveLabel} Save DC ${dc}</div>`;

    if (canSeeDetails) {
        const offset = save.value - dc;
        const offsetStr = offset >= 0 ? `+${offset}` : `${offset}`;
        html += `<div class="th-tooltip-result">`;
        html += `Result: (<i class="fa-solid fa-dice-d20"></i> ${save.die}) `;
        html += `${getSuccessLabel(save.success)} by ${offsetStr}`;
        html += `</div>`;

        if (save.modifiers?.length) {
            for (const mod of save.modifiers) {
                const sign = mod.modifier >= 0 ? "+" : "";
                html += `<div>${mod.label} ${sign}${mod.modifier}</div>`;
            }
        }
    }

    html += `</div>`;
    return html;
}

function buildPreRollTooltip(statistic: string, dc: number): string {
    const saveLabel = statistic.charAt(0).toUpperCase() + statistic.slice(1);
    return `<div class="th-tooltip"><div>${saveLabel} Save DC ${dc}</div></div>`;
}

// ─── PRAD Overcome Tooltips ──────────────────────────────────────────────────

function buildOvercomeTooltipHtml(
    statistic: string,
    npcSaveDC: number,
    save: SaveResultData,
    canSeeDetails: boolean
): string {
    const saveLabel = statistic.charAt(0).toUpperCase() + statistic.slice(1);
    let html = `<div class="th-tooltip">`;
    html += `<div>Overcome vs ${saveLabel} DC ${npcSaveDC}</div>`;

    if (canSeeDetails) {
        // Show the PC's roll details
        const pcDegree = save.overcomeSuccess ?? save.success;
        const pcDegreeLabel = getSuccessLabel(pcDegree);
        html += `<div class="th-tooltip-result">`;
        html += `Roll: (<i class="fa-solid fa-dice-d20"></i> ${save.die}) = ${save.value}`;
        html += `</div>`;
        html += `<div>PC: ${pcDegreeLabel}</div>`;

        // Show the effective NPC save result
        const npcDegreeLabel = getSuccessLabel(save.success);
        html += `<div>Target Save: ${npcDegreeLabel}</div>`;

        if (save.modifiers?.length) {
            html += `<hr style="margin: 2px 0">`;
            for (const mod of save.modifiers) {
                const sign = mod.modifier >= 0 ? "+" : "";
                html += `<div>${mod.label} ${sign}${mod.modifier}</div>`;
            }
        }
    }

    html += `</div>`;
    return html;
}

function buildOvercomePreRollTooltip(statistic: string, npcSaveDC: number): string {
    const saveLabel = statistic.charAt(0).toUpperCase() + statistic.slice(1);
    return `<div class="th-tooltip"><div>Overcome vs ${saveLabel} DC ${npcSaveDC}</div></div>`;
}

/**
 * Target Helper — Chat Message Rendering
 *
 * Handles the V14 `renderChatMessageHTML` hook to inject per-target rows
 * and replace save buttons with custom ones.
 *
 * Ported from PF2e Toolbelt's Target Helper rendering logic.
 */

import { MODULE_ID } from "../constants.js";
import { isCurrentUserDesignatedTargetRoller } from "../shared/authorized-roller.js";
import { getNpcSaveModifier, getSaveDC } from "../shared/dc.js";
import { resolveHtmlRoot } from "../shared/html.js";
import {
    buildTargetRowViewModel,
    type RowRenderContext,
    type TargetTokenData,
} from "../shared/render-logic.js";
import { canUpdateMessage, getCurrentTargetUUIDs, getFlagData, updateTargets } from "./flags.js";
import {
    canRollOvercomeAsCurrentUser,
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
 * Hook handler for `renderChatMessageHTML`.
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

    // Reserve synchronously so overlapping Foundry render hooks cannot both
    // render controls for the same chat card, including zero-target cards.
    const rowsWrapper = reserveTargetRowsWrapper(msgContent);
    if (!rowsWrapper) return;

    try {
        if (flagData.type === "spell") {
            await renderSpellCard(message, msgContent, rowsWrapper, flagData);
        } else if (flagData.type === "area") {
            await renderAreaCard(message, msgContent, rowsWrapper, flagData);
        } else if (flagData.type === "check") {
            await renderCheckCard(message, msgContent, rowsWrapper, flagData);
        } else if (flagData.type === "action") {
            await renderActionCard(message, msgContent, rowsWrapper, flagData);
        } else if (flagData.type === "prad-attack") {
            await renderPradAttackCard(message, msgContent, rowsWrapper, flagData);
        } else {
            rowsWrapper.remove();
        }
    } catch (err) {
        cleanupFailedRender(msgContent, rowsWrapper);
        console.error(`${MODULE_ID} | Target Helper: Error rendering target rows`, err);
    }
}

function cleanupFailedRender(msgContent: HTMLElement, rowsWrapper: HTMLElement): void {
    rowsWrapper.remove();
    for (const wrapper of msgContent.querySelectorAll(".th-buttons")) wrapper.remove();
    for (const button of msgContent.querySelectorAll(".th-original-hidden")) {
        button.classList.remove("hidden", "th-original-hidden");
    }
}

// ─── Per-Type Renderers ──────────────────────────────────────────────────────

async function renderSpellCard(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    rowsWrapper: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    if (!flagData.save) return;

    await addTargetRows(message, rowsWrapper, flagData);
    await replaceButton(
        message, msgContent, flagData,
        'button[data-action="spell-save"]'
    );
}

async function renderAreaCard(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    rowsWrapper: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    if (!flagData.save) return;

    await addTargetRows(message, rowsWrapper, flagData);
    await replaceButton(
        message, msgContent, flagData,
        'button[data-action="roll-area-save"]'
    );
}

async function renderCheckCard(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    rowsWrapper: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    if (!flagData.save) return;

    await addTargetRows(message, rowsWrapper, flagData);
    // For inline checks, the save link IS the button — we add custom buttons
    await addCheckButtons(message, msgContent, flagData);
}

async function renderActionCard(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    rowsWrapper: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    if (!flagData.save) return;

    await addTargetRows(message, rowsWrapper, flagData);
    // Add set targets and roll saves buttons to the action card
    await addActionButtons(message, msgContent, flagData);
}

async function renderPradAttackCard(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    rowsWrapper: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    if (!flagData.save) return;

    await addTargetRows(message, rowsWrapper, flagData);
    await replaceButton(
        message, msgContent, flagData,
        'button[data-action="prad-armor-save"]'
    );
}

// ─── Target Row Rendering ────────────────────────────────────────────────────

/**
 * templates. Foundry can emit repeated renderChatMessageHTML hooks for the
 * same card before an earlier hook completes.
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
    rowsWrapper: HTMLElement,
    flagData: TargetHelperFlagData,
): Promise<void> {
    if (!flagData.targets?.length) return;

    const isGM = !!game.user?.isGM;
    const canPersist = canUpdateMessage(message);
    const saves = flagData.saves ?? {};
    const saveInfo = flagData.save;
    const isPradOvercome = !!flagData.pradOvercome;

    const isCasterOwner = isPradOvercome
        ? canRollOvercomeAsCurrentUser(message, flagData.author)
        : isGM;

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


    for (const { token, data } of resolvedTokens) {
        // Pure function builds the row view model
        const viewModel = buildTargetRowViewModel(data, ctx, getSuccessLabel);
        if (!viewModel) continue;

        const targetSave = saves[data.id];
        const visibleTargetSave = targetSave && !targetSave.private ? targetSave : undefined;
        if (viewModel.save) {
            const isDesignatedRoller = isPradOvercome
                ? canRollOvercomeAsCurrentUser(message, flagData.author)
                : isCurrentUserDesignatedTargetRoller(message, token);
            viewModel.save.canRoll = viewModel.save.canRoll && canPersist && isDesignatedRoller;
        }

        // Augment with tooltip (Foundry-coupled HTML — not in the pure layer)
        let tooltip: string | undefined;
        if (viewModel.save && saveInfo && !targetSave?.private) {
            if (isPradOvercome) {
                const dc = npcSaveDCs[data.id] ?? saveInfo.dc;
                tooltip = visibleTargetSave
                    ? buildOvercomeTooltipHtml(saveInfo.statistic, dc, visibleTargetSave, ctx.isGM || ctx.isCasterOwner)
                    : buildOvercomePreRollTooltip(saveInfo.statistic, dc);
            } else {
                tooltip = visibleTargetSave
                    ? buildTooltipHtml(saveInfo.statistic, saveInfo.dc, visibleTargetSave, ctx.isGM || data.isOwner)
                    : buildPreRollTooltip(saveInfo.statistic, saveInfo.dc);
            }
        }

        const rowHtml = await foundry.applications.handlebars.renderTemplate(TEMPLATE_TARGET_ROW, { ...viewModel } as Record<string, unknown>);
        const rowDiv = document.createElement("div");
        rowDiv.className = "th-target-row";
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
function canControlTargetHelperMessage(message: ChatMessage.Implementation, flagData: TargetHelperFlagData): boolean {
    if (game.user?.isGM) return true;
    if (!flagData.pradOvercome) return !!(message as Sf2eChatMessage).isAuthor;
    return canRollOvercomeAsCurrentUser(message, flagData.author);
}

function handleTargetHelperAction(label: string, operation: Promise<unknown>): void {
    void operation.catch((error: unknown) => {
        console.error(`${MODULE_ID} | Target Helper: ${label} failed`, error);
        ui.notifications!.error(game.i18n!.localize("sf2e-forge-custom.targetHelper.cannotPersist"));
    });
}

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
                handleTargetHelperAction("Overcome roll", rollOvercomeForTargets(event as MouseEvent, message, [token]));
            } else {
                handleTargetHelperAction("Save roll", rollSavesForTargets(event as MouseEvent, message, [token]));
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
    if (!canUpdateMessage(message)) return;

    const isPradOvercome = !!flagData.pradOvercome;
    if (isPradOvercome && !canControlTargetHelperMessage(message, flagData)) return;

    // Create a button wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "th-buttons";

    const fakeBtn = saveBtn.cloneNode(true) as HTMLButtonElement;
    fakeBtn.removeAttribute("data-action");
    fakeBtn.classList.add("th-save-btn");

    if (isPradOvercome) {
        // Change text to "Roll Overcome" in PRAD mode
        fakeBtn.textContent = game.i18n!.localize("sf2e-forge-custom.prad.rollOvercome");
        fakeBtn.classList.add("th-overcome-btn");
    }

    saveBtn.classList.add("hidden", "th-original-hidden");
    saveBtn.after(wrapper);

    // Add button click handler
    fakeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isPradOvercome) {
            handleTargetHelperAction("Active-token overcome roll", rollOvercomeForActiveTokens(event, message));
        } else {
            handleTargetHelperAction("Active-token save roll", rollSaveForActiveTokens(event, message));
        }
    });

    wrapper.appendChild(fakeBtn);

    // Only message owners (GM or author) get the extra buttons
    const isOwner = canControlTargetHelperMessage(message, flagData);
    if (!isOwner) return;

    // Set Targets button
    const setTargetsBtn = document.createElement("button");
    setTargetsBtn.className = "th-set-targets";
    setTargetsBtn.title = game.i18n!.localize("sf2e-forge-custom.targetHelper.setTargets");
    setTargetsBtn.innerHTML = '<i class="fa-solid fa-bullseye-arrow"></i>';
    setTargetsBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const targets = getCurrentTargetUUIDs();
        handleTargetHelperAction("Target update", updateTargets(message, targets));
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
                handleTargetHelperAction("Roll-all overcome", rollOvercomeAll(event, message));
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
                handleTargetHelperAction("NPC saves", rollNpcSaves(event, message));
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
    if (!canUpdateMessage(message)) return;
    const isPradOvercome = !!flagData.pradOvercome;
    const isOwner = canControlTargetHelperMessage(message, flagData);
    if (!isOwner) return;

    const chatCard = msgContent.querySelector(".chat-card");
    const insertPoint = chatCard ?? msgContent;

    const wrapper = document.createElement("div");
    wrapper.className = "th-buttons th-action-buttons";

    const setTargetsBtn = document.createElement("button");
    setTargetsBtn.className = "th-set-targets";
    setTargetsBtn.title = game.i18n!.localize("sf2e-forge-custom.targetHelper.setTargets");
    setTargetsBtn.innerHTML = '<i class="fa-solid fa-bullseye-arrow"></i>';
    setTargetsBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const targets = getCurrentTargetUUIDs();
        handleTargetHelperAction("Target update", updateTargets(message, targets));
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
                handleTargetHelperAction("Roll-all overcome", rollOvercomeAll(event, message));
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
            handleTargetHelperAction("NPC saves", rollNpcSaves(event, message));
        });
        wrapper.appendChild(rollNpcBtn);
    }

    insertPoint.appendChild(wrapper);
}

function appendIconAndText(button: HTMLButtonElement, iconClass: string, text: string): void {
    const icon = document.createElement("i");
    icon.className = iconClass;
    button.append(icon, document.createTextNode(` ${text}`));
}

/**
 * Add check-specific buttons (for inline check messages).
 */
async function addCheckButtons(
    message: ChatMessage.Implementation,
    msgContent: HTMLElement,
    flagData: TargetHelperFlagData
): Promise<void> {
    if (!canUpdateMessage(message)) return;
    const isPradOvercome = !!flagData.pradOvercome;
    const isOwner = canControlTargetHelperMessage(message, flagData);

    const wrapper = document.createElement("div");
    wrapper.className = "th-buttons th-check-buttons";

    if (isOwner) {
        const setTargetsBtn = document.createElement("button");
        setTargetsBtn.className = "th-set-targets";
        setTargetsBtn.title = game.i18n!.localize("sf2e-forge-custom.targetHelper.setTargets");
        setTargetsBtn.innerHTML = '<i class="fa-solid fa-bullseye-arrow"></i>';
        setTargetsBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            const targets = getCurrentTargetUUIDs();
            handleTargetHelperAction("Target update", updateTargets(message, targets));
        });
        wrapper.appendChild(setTargetsBtn);
    }

    if (flagData.save) {
        if (isPradOvercome && isOwner) {
            // Overcome button (caster rolls against all targets)
            const overcomeBtn = document.createElement("button");
            overcomeBtn.className = "th-save-btn th-overcome-btn";
            appendIconAndText(overcomeBtn, "fa-solid fa-burst", game.i18n!.localize("sf2e-forge-custom.prad.rollOvercome"));
            overcomeBtn.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                handleTargetHelperAction("Active-token overcome roll", rollOvercomeForActiveTokens(event, message));
            });
            wrapper.appendChild(overcomeBtn);
        } else if (!isPradOvercome) {
            // Save button for player's own tokens
            const saveBtn = document.createElement("button");
            saveBtn.className = "th-save-btn";
            const saveDisplay = SAVE_DETAILS[flagData.save.statistic] ?? SAVE_DETAILS.reflex;
            appendIconAndText(saveBtn, saveDisplay.icon, game.i18n!.localize("sf2e-forge-custom.targetHelper.rollSave"));
            saveBtn.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                handleTargetHelperAction("Active-token save roll", rollSaveForActiveTokens(event, message));
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
                handleTargetHelperAction("Roll-all overcome", rollOvercomeAll(event, message));
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
            handleTargetHelperAction("NPC saves", rollNpcSaves(event, message));
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

export function escapeTooltipText(value: unknown): string {
    return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[character]!);
}

export function buildTooltipHtml(
    statistic: string,
    dc: number,
    save: SaveResultData,
    canSeeDetails: boolean
): string {
    const saveLabel = escapeTooltipText(statistic.charAt(0).toUpperCase() + statistic.slice(1));
    let html = `<div class="th-tooltip">`;
    html += `<div>${saveLabel} Save DC ${escapeTooltipText(dc)}</div>`;

    if (canSeeDetails) {
        const offset = save.value - dc;
        const offsetStr = offset >= 0 ? `+${offset}` : `${offset}`;
        html += `<div class="th-tooltip-result">`;
        html += `Result: (<i class="fa-solid fa-dice-d20"></i> ${escapeTooltipText(save.die)}) `;
        html += `${escapeTooltipText(getSuccessLabel(save.success))} by ${escapeTooltipText(offsetStr)}`;
        html += `</div>`;

        for (const mod of save.modifiers) {
            const sign = mod.modifier >= 0 ? "+" : "";
            html += `<div>${escapeTooltipText(mod.label)} ${sign}${escapeTooltipText(mod.modifier)}</div>`;
        }
    }

    html += `</div>`;
    return html;
}

function buildPreRollTooltip(statistic: string, dc: number): string {
    const saveLabel = escapeTooltipText(statistic.charAt(0).toUpperCase() + statistic.slice(1));
    return `<div class="th-tooltip"><div>${saveLabel} Save DC ${escapeTooltipText(dc)}</div></div>`;
}

// ─── PRAD Overcome Tooltips ──────────────────────────────────────────────────

function buildOvercomeTooltipHtml(
    statistic: string,
    npcSaveDC: number,
    save: SaveResultData,
    canSeeDetails: boolean
): string {
    const saveLabel = escapeTooltipText(statistic.charAt(0).toUpperCase() + statistic.slice(1));
    let html = `<div class="th-tooltip">`;
    html += `<div>Overcome vs ${saveLabel} DC ${escapeTooltipText(npcSaveDC)}</div>`;

    if (canSeeDetails) {
        const pcDegree = save.overcomeSuccess ?? save.success;
        html += `<div class="th-tooltip-result">`;
        html += `Roll: (<i class="fa-solid fa-dice-d20"></i> ${escapeTooltipText(save.die)}) = ${escapeTooltipText(save.value)}`;
        html += `</div>`;
        html += `<div>PC: ${escapeTooltipText(getSuccessLabel(pcDegree))}</div>`;
        html += `<div>Target Save: ${escapeTooltipText(getSuccessLabel(save.success))}</div>`;

        if (save.modifiers.length) {
            html += `<hr style="margin: 2px 0">`;
            for (const mod of save.modifiers) {
                const sign = mod.modifier >= 0 ? "+" : "";
                html += `<div>${escapeTooltipText(mod.label)} ${sign}${escapeTooltipText(mod.modifier)}</div>`;
            }
        }
    }

    html += `</div>`;
    return html;
}

function buildOvercomePreRollTooltip(statistic: string, npcSaveDC: number): string {
    const saveLabel = escapeTooltipText(statistic.charAt(0).toUpperCase() + statistic.slice(1));
    return `<div class="th-tooltip"><div>Overcome vs ${saveLabel} DC ${escapeTooltipText(npcSaveDC)}</div></div>`;
}

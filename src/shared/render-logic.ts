/**
 * Pure Rendering Decision Logic (Functional Core)
 *
 * Stateless, pure functions that compute view models for target rows.
 * No Foundry API calls, no DOM access — just data in, data out.
 */

import type { DegreeOfSuccessString, PersistedSaveResultData, SaveInfo, SaveDisplayInfo } from "./types.js";

// ─── View Model Types ────────────────────────────────────────────────────────

/** Pre-resolved data about a single target token (read from Foundry). */
export interface TargetTokenData {
    id: string;
    name: string;
    isHidden: boolean;
    isOwner: boolean;
    hasPlayerOwner: boolean;
}

/** Context shared across all rows in a message. */
export interface RowRenderContext {
    isGM: boolean;
    isPradOvercome: boolean;
    isCasterOwner: boolean;
    saveInfo: SaveInfo | undefined;
    existingSaves: Record<string, PersistedSaveResultData>;
    saveDisplay: SaveDisplayInfo | undefined;
    /** Pre-computed per-target NPC save DC for overcome mode, keyed by token ID. */
    npcSaveDCs?: Record<string, number>;
}

/** The data needed to render a target row template. */
export interface TargetRowViewModel {
    name: string;
    isHidden: boolean;
    isOwner: boolean;
    hasPlayerOwner: boolean;
    showSuccess: boolean;
    pradOvercome?: boolean;
    save?: {
        statistic: string;
        icon: string;
        dc: number;
        hasResult: boolean;
        isHiddenResult: boolean;
        value?: number;
        die?: number;
        success?: DegreeOfSuccessString;
        successLabel: string;
        canRoll: boolean;
    };
}

// ─── Pure Builders ───────────────────────────────────────────────────────────

/**
 * Build a view model for a single target row.
 * Pure function — only depends on its inputs.
 *
 * @param token   Pre-resolved token data
 * @param ctx     Shared render context for the message
 * @param getSuccessLabel  Callback to convert degree to localized label
 * @returns null if the target should be hidden from this user
 */
export function buildTargetRowViewModel(
    token: TargetTokenData,
    ctx: RowRenderContext,
    getSuccessLabel: (degree: DegreeOfSuccessString) => string,
): TargetRowViewModel | null {
    // Hidden targets invisible to non-GM
    if (!ctx.isGM && token.isHidden) return null;

    const targetSave = ctx.existingSaves[token.id];
    const saveInfo = ctx.saveInfo;
    const visibleTargetSave = targetSave && !targetSave.private ? targetSave : undefined;

    if (ctx.isPradOvercome && saveInfo) {
        const npcSaveDC = ctx.npcSaveDCs?.[token.id] ?? saveInfo.dc;
        return {
            name: token.name,
            isHidden: token.isHidden,
            isOwner: token.isOwner,
            hasPlayerOwner: token.hasPlayerOwner,
            showSuccess: ctx.isGM || ctx.isCasterOwner,
            pradOvercome: true,
            save: {
                statistic: saveInfo.statistic,
                icon: ctx.saveDisplay?.icon ?? "fa-solid fa-dice-d20",
                dc: npcSaveDC,
                hasResult: !!visibleTargetSave,
                isHiddenResult: !!targetSave?.private,
                ...(visibleTargetSave ? {
                    value: visibleTargetSave.value,
                    die: visibleTargetSave.die,
                    success: visibleTargetSave.success,
                    successLabel: getSuccessLabel(visibleTargetSave.success),
                } : { successLabel: "" }),
                canRoll: ctx.isCasterOwner && !targetSave,
            },
        };
    }

    return {
        name: token.name,
        isHidden: token.isHidden,
        isOwner: token.isOwner,
        hasPlayerOwner: token.hasPlayerOwner,
        showSuccess: ctx.isGM || token.isOwner,
        save: saveInfo ? {
            statistic: saveInfo.statistic,
            icon: ctx.saveDisplay?.icon ?? "fa-solid fa-dice-d20",
            dc: saveInfo.dc,
            hasResult: !!visibleTargetSave,
            isHiddenResult: !!targetSave?.private,
            ...(visibleTargetSave ? {
                value: visibleTargetSave.value,
                die: visibleTargetSave.die,
                success: visibleTargetSave.success,
                successLabel: getSuccessLabel(visibleTargetSave.success),
            } : { successLabel: "" }),
            canRoll: token.isOwner && !targetSave,
        } : undefined,
    };
}

// ─── Button Visibility Decisions ─────────────────────────────────────────────

/** Determine which action buttons should be shown for a card. */
export interface ButtonVisibility {
    showSetTargets: boolean;
    showRollNpcSaves: boolean;
    showRollOvercomeAll: boolean;
    showPlayerSaveBtn: boolean;
    showPlayerOvercomeBtn: boolean;
}

export function computeButtonVisibility(
    isGM: boolean,
    isOwner: boolean,
    isPradOvercome: boolean,
    hasSave: boolean,
    hasUnrolledNpcs: boolean,
    hasUnrolledTargets: boolean,
): ButtonVisibility {
    return {
        showSetTargets: isOwner,
        showRollNpcSaves: isOwner && !isPradOvercome && hasUnrolledNpcs,
        showRollOvercomeAll: isOwner && isPradOvercome && hasUnrolledTargets,
        showPlayerSaveBtn: hasSave && !isPradOvercome,
        showPlayerOvercomeBtn: hasSave && isPradOvercome,
    };
}

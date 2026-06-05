import { getSceneTokenId, isSceneTokenUuid } from "../shared/token-uuid.js";
import type { DegreeOfSuccessString, PersistedSaveResultData, SaveResultData, TargetHelperFlagData, TargetMessageType } from "./types.js";

const MAX_MODIFIERS = 100;
const MAX_MODIFIER_LABEL_LENGTH = 200;
const MAX_UUID_LENGTH = 512;
const MAX_TARGETS = 100;
const MAX_OPTIONS = 100;
const MAX_OPTION_LENGTH = 200;
const MAX_STATISTIC_LENGTH = 64;
const MAX_TOKEN_ID_LENGTH = 128;
const TARGET_REVISION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_MESSAGE_TYPES: Record<TargetMessageType, true> = {
    spell: true,
    area: true,
    check: true,
    action: true,
    "prad-attack": true,
};
const DEGREE_OF_SUCCESS: Record<DegreeOfSuccessString, true> = {
    criticalFailure: true,
    failure: true,
    success: true,
    criticalSuccess: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isTargetGeneration(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTargetRevision(value: unknown): value is string {
    return typeof value === "string" && TARGET_REVISION_PATTERN.test(value);
}

/** Mint a globally unique target-set identity using the browser cryptographic RNG. */
export function createTargetRevision(): string {
    const revision = globalThis.crypto?.randomUUID?.();
    if (!revision || !isTargetRevision(revision)) throw new Error("A cryptographically strong UUID source is required for target-helper revisions");
    return revision;
}

function isDegreeOfSuccess(value: unknown): value is DegreeOfSuccessString {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(DEGREE_OF_SUCCESS, value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isDocumentUuid(value: unknown, documentName: "Actor" | "Item"): value is string {
    if (!isBoundedString(value, MAX_UUID_LENGTH)) return false;
    const parts = value.split(".");
    const index = parts.lastIndexOf(documentName);
    return index >= 0 && index === parts.length - 2 && parts[index + 1].length > 0;
}

/** Extract the embedded token ID from an exact canvas TokenDocument UUID. */
export function getTargetTokenId(value: unknown): string | null {
    return getSceneTokenId(value);
}

/** Encode exact save provenance as a collision-free Foundry update-path-safe leaf key. */
export function encodeTargetUuidSaveKey(targetUuid: string, generation: number, revision: string): string {
    let encoded = `r${revision.replaceAll("-", "")}g${generation.toString(16)}u`;
    for (let index = 0; index < targetUuid.length; index += 1) {
        encoded += targetUuid.charCodeAt(index).toString(16).padStart(4, "0");
    }
    return encoded;
}

function hasCollidingTargetTokenIds(targets: readonly string[]): boolean {
    const targetUuidsByTokenId = new Map<string, string>();
    for (const uuid of targets) {
        const tokenId = getTargetTokenId(uuid);
        if (tokenId === null) return true;
        const existingUuid = targetUuidsByTokenId.get(tokenId);
        if (existingUuid !== undefined && existingUuid !== uuid) return true;
        targetUuidsByTokenId.set(tokenId, uuid);
    }
    return false;
}

function isSafeTokenId(value: string): boolean {
    return value.length > 0
        && value.length <= MAX_TOKEN_ID_LENGTH
        && /^[A-Za-z0-9_-]+$/.test(value)
        && value !== "__proto__"
        && value !== "constructor"
        && value !== "prototype";
}

/** Normalize one save result read from persisted chat flags or produced by a roll callback. */
export function normalizeSaveResult(value: unknown, expectedStatistic: string): PersistedSaveResultData | null {
    if (!isRecord(value)) return null;

    const result = value;
    if (typeof result.private !== "boolean") return null;
    if (result.statistic !== expectedStatistic) return null;
    if (!isSceneTokenUuid(result.targetUuid)) return null;
    if (!isTargetGeneration(result.generation) || !isTargetRevision(result.revision)) return null;

    if (result.private) {
        return {
            private: true,
            statistic: expectedStatistic,
            targetUuid: result.targetUuid,
            generation: result.generation,
            revision: result.revision,
        };
    }

    if (!isFiniteNumber(result.value)) return null;
    if (typeof result.die !== "number" || !Number.isInteger(result.die) || result.die < 1 || result.die > 20) return null;
    if (!isDegreeOfSuccess(result.success)) return null;
    if (!Array.isArray(result.modifiers) || result.modifiers.length > MAX_MODIFIERS) return null;

    const modifiers: SaveResultData["modifiers"] = [];
    for (const value of result.modifiers) {
        if (!isRecord(value)) return null;
        const modifier = value;
        if (typeof modifier.label !== "string" || modifier.label.length > MAX_MODIFIER_LABEL_LENGTH) return null;
        if (!isFiniteNumber(modifier.modifier)) return null;
        modifiers.push({ label: modifier.label, modifier: modifier.modifier });
    }

    const normalized: PersistedSaveResultData = {
        value: result.value,
        die: result.die,
        success: result.success,
        modifiers,
        private: false,
        statistic: expectedStatistic,
        targetUuid: result.targetUuid,
        generation: result.generation,
        revision: result.revision,
    };

    if (result.overcomeDc !== undefined) {
        if (!isFiniteNumber(result.overcomeDc)) return null;
        normalized.overcomeDc = result.overcomeDc;
    }
    if (result.overcomeSuccess !== undefined) {
        if (!isDegreeOfSuccess(result.overcomeSuccess)) return null;
        normalized.overcomeSuccess = result.overcomeSuccess;
    }

    return normalized;
}


/** Normalize the complete stored target-helper payload before any caller consumes it. */
export function normalizeTargetHelperFlagData(value: unknown): TargetHelperFlagData | undefined {
    if (!isRecord(value)) return undefined;
    const data = value;
    if (typeof data.type !== "string" || !Object.prototype.hasOwnProperty.call(TARGET_MESSAGE_TYPES, data.type)) return undefined;
    if (!Array.isArray(data.targets) || data.targets.length > MAX_TARGETS || !data.targets.every(isSceneTokenUuid)) return undefined;
    if (hasCollidingTargetTokenIds(data.targets)) return undefined;
    if (data.generation !== undefined && !isTargetGeneration(data.generation)) return undefined;
    if (!isTargetRevision(data.revision)) return undefined;

    const normalized: TargetHelperFlagData = {
        type: data.type as TargetMessageType,
        targets: [...new Set(data.targets as string[])],
        generation: data.generation ?? 0,
        revision: data.revision,
    };

    if (data.save !== undefined) {
        if (!isRecord(data.save)) return undefined;
        const save = data.save;
        if (!isBoundedString(save.statistic, MAX_STATISTIC_LENGTH) || !isFiniteNumber(save.dc) || typeof save.basic !== "boolean") return undefined;
        normalized.save = { statistic: save.statistic, dc: save.dc, basic: save.basic };
    }
    if (data.author !== undefined) {
        if (!isDocumentUuid(data.author, "Actor")) return undefined;
        normalized.author = data.author;
    }
    if (data.item !== undefined) {
        if (!isDocumentUuid(data.item, "Item")) return undefined;
        normalized.item = data.item;
    }
    if (data.options !== undefined) {
        if (!Array.isArray(data.options) || data.options.length > MAX_OPTIONS || !data.options.every((option) => isBoundedString(option, MAX_OPTION_LENGTH))) return undefined;
        normalized.options = [...data.options];
    }
    if (data.contextualTargetAc !== undefined) {
        if (!isRecord(data.contextualTargetAc)) return undefined;
        const contextualTargetAc = data.contextualTargetAc;
        if (!isSceneTokenUuid(contextualTargetAc.targetUuid) || !normalized.targets.includes(contextualTargetAc.targetUuid) || !isFiniteNumber(contextualTargetAc.value)) return undefined;
        normalized.contextualTargetAc = { targetUuid: contextualTargetAc.targetUuid, value: contextualTargetAc.value };
    }
    if (data.interceptedAttack !== undefined) {
        if (data.interceptedAttack !== true || normalized.type !== "prad-attack" || normalized.targets.length !== 1 || normalized.save?.statistic !== "ac" || normalized.save?.basic !== false || !normalized.contextualTargetAc) return undefined;
        normalized.interceptedAttack = true;
    } else if (normalized.contextualTargetAc) {
        return undefined;
    }
    if (data.pradOvercome !== undefined) {
        if (typeof data.pradOvercome !== "boolean") return undefined;
        normalized.pradOvercome = data.pradOvercome;
    }

    if (data.saves !== undefined) {
        if (!isRecord(data.saves) || !normalized.save) return undefined;
        normalized.saves = normalizeSaveResults(data.saves, normalized.save.statistic, normalized.targets, normalized.generation, normalized.revision);
    }

    return normalized;
}
/** Discard invalid persisted sibling results rather than allowing them into rendering or writes. */
export function normalizeSaveResults(
    value: unknown,
    expectedStatistic: string,
    targetUuids: readonly string[],
    generation: number,
    revision: string,
): Record<string, PersistedSaveResultData> {
    if (!isRecord(value)) return {};

    const targetUuidsByTokenId = new Map<string, string>();
    for (const uuid of targetUuids) {
        const tokenId = getTargetTokenId(uuid);
        if (tokenId !== null) targetUuidsByTokenId.set(tokenId, uuid);
    }

    const normalized: Record<string, PersistedSaveResultData> = {};
    for (const [rawKey, result] of Object.entries(value)) {
        const save = normalizeSaveResult(result, expectedStatistic);
        if (!save || save.generation !== generation || save.revision !== revision || rawKey !== encodeTargetUuidSaveKey(save.targetUuid, save.generation, save.revision)) continue;

        const tokenId = getTargetTokenId(save.targetUuid);
        if (!tokenId || !isSafeTokenId(tokenId)) continue;
        if (targetUuidsByTokenId.get(tokenId) === save.targetUuid) normalized[tokenId] = save;
    }
    return normalized;
}

/**
 * Target Helper — Flag Helpers
 *
 * Read/write target helper data on chat message flags.
 * All data is stored at: `flags[MODULE_ID].targetHelper`
 */

import { MODULE_ID } from "../constants.js";
import { getPublicSceneTokenUuids, isPublicSceneTokenUuid } from "../shared/token-uuid.js";
import type {
    TargetHelperFlagData,
    PersistedSaveResultData,
    SaveResultData,
} from "./types.js";
import { createTargetRevision, encodeTargetUuidSaveKey, getTargetTokenId, normalizeSaveResult, normalizeTargetHelperFlagData } from "./result-validation.js";

const FLAG_KEY = "targetHelper";
const MAX_TOKEN_ID_LENGTH = 128;
const MAX_ENCODED_TARGET_UUID_KEY_LENGTH = 1 + 32 + 1 + 13 + 1 + (512 * 4);

function isSafeTokenId(value: string): boolean {
    return value.length > 0
        && value.length <= MAX_TOKEN_ID_LENGTH
        && /^[A-Za-z0-9_-]+$/.test(value)
        && value !== "__proto__"
        && value !== "constructor"
        && value !== "prototype";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEncodedTargetUuidSaveKey(value: string): boolean {
    return value.length <= MAX_ENCODED_TARGET_UUID_KEY_LENGTH
        && /^r[0-9a-f]{32}g[0-9a-f]+u(?:[0-9a-f]{4})+$/.test(value);
}

function getRawFlagData(message: ChatMessage.Implementation): Record<string, unknown> | undefined {
    const flags = message.flags as Sf2eMessageFlags;
    const data = flags?.[MODULE_ID]?.[FLAG_KEY];
    return isRecord(data) ? data : undefined;
}

function serializeFlagData(data: Partial<TargetHelperFlagData>): Record<string, unknown> {
    const { saves, ...serialized } = data;
    if (saves === undefined) return serialized;

    const encodedSaves: Record<string, PersistedSaveResultData> = {};
    for (const save of Object.values(saves)) {
        encodedSaves[encodeTargetUuidSaveKey(save.targetUuid, save.generation, save.revision)] = save;
    }
    return { ...serialized, saves: encodedSaves };
}


// ─── Read Helpers ────────────────────────────────────────────────────────────

/**
 * Get the target helper flag data from a chat message, if present.
 */
export function getFlagData(message: ChatMessage.Implementation): TargetHelperFlagData | undefined {
    const flags = message.flags as Sf2eMessageFlags;
    return normalizeTargetHelperFlagData(flags?.[MODULE_ID]?.[FLAG_KEY]);
}

/**
 * Check if a message has target helper data.
 */
export function hasFlagData(message: ChatMessage.Implementation): boolean {
    return !!getFlagData(message);
}

// ─── Write Helpers ───────────────────────────────────────────────────────────

/**
 * Set the full target helper flag data on a message being created.
 * Used in `preCreateChatMessage` to inject flag data before creation.
 */
export function setSourceFlag(
    message: ChatMessage.Implementation,
    data: Partial<TargetHelperFlagData>
): void {
    let publicData = data;
    try {
        if (data.targets) publicData = { ...data, targets: getPublicSceneTokenUuids(data.targets) };
    } catch {
        throw new Error("Invalid target-helper source flags");
    }
    const serialized = serializeFlagData({ ...publicData, revision: publicData.revision ?? createTargetRevision() });
    const normalized = normalizeTargetHelperFlagData(serialized);
    if (!normalized) throw new Error("Invalid target-helper source flags");
    (message as Sf2eChatMessage).updateSource({
        [`flags.${MODULE_ID}.${FLAG_KEY}`]: serializeFlagData(normalized),
    });
}

/** Whether Foundry permits the current user to persist inline result flags. */
export function canUpdateMessage(message: ChatMessage.Implementation): boolean {
    const user = game.user;
    if (!user) return false;

    const chatMessage = message as Sf2eChatMessage;
    const canUserModify = (message as unknown as {
        canUserModify?: (user: typeof game.user, action: "update") => boolean;
    }).canUserModify;
    return canUserModify ? canUserModify.call(message, user, "update") : !!chatMessage.isAuthor;
}

const targetUpdateQueues = new WeakMap<object, Promise<void>>();


/**
 * Persist save-result leaves without rewriting concurrently-updated siblings.
 * The parent ChatMessage update is the Foundry authorization boundary.
 */
export async function updateSaves(
    message: ChatMessage.Implementation,
    saves: Record<string, SaveResultData | PersistedSaveResultData>
): Promise<boolean> {
    const flagData = getFlagData(message);
    if (!flagData?.save) throw new Error("Cannot persist saves without target-helper save flags");

    const targetUuidsByTokenId = new Map<string, string>();
    for (const uuid of flagData.targets) {
        const tokenId = getTargetTokenId(uuid);
        if (tokenId !== null) targetUuidsByTokenId.set(tokenId, uuid);
    }

    const updates: Record<string, PersistedSaveResultData> = {};
    for (const [tokenId, value] of Object.entries(saves)) {
        if (!isSafeTokenId(tokenId)) {
            throw new Error(`Invalid target token ID: ${tokenId}`);
        }
        const normalized = normalizeSaveResult(value, flagData.save.statistic);
        if (!normalized) throw new Error(`Invalid save result for target token: ${tokenId}`);
        if (normalized.targetUuid !== targetUuidsByTokenId.get(tokenId)) continue;
        if (normalized.generation !== flagData.generation || normalized.revision !== flagData.revision) continue;
        updates[`flags.${MODULE_ID}.${FLAG_KEY}.saves.${encodeTargetUuidSaveKey(normalized.targetUuid, normalized.generation, normalized.revision)}`] = normalized;
    }

    if (Object.keys(updates).length === 0) return false;
    await (message as Sf2eChatMessage).update(updates);
    return true;
}

/**
 * Update the targets list on an existing message.
 */
export async function updateTargets(
    message: ChatMessage.Implementation,
    targets: string[]
): Promise<void> {
    const previous = targetUpdateQueues.get(message) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => persistTargets(message, targets));
    targetUpdateQueues.set(message, current);
    try {
        await current;
    } finally {
        if (targetUpdateQueues.get(message) === current) targetUpdateQueues.delete(message);
    }
}

async function persistTargets(message: ChatMessage.Implementation, targets: string[]): Promise<void> {
    const existing = getFlagData(message);
    if (!existing) throw new Error("Cannot persist targets without target-helper flags");
    if (existing.generation === Number.MAX_SAFE_INTEGER) throw new Error("Cannot increment target-helper generation");
    let publicTargets: string[];
    try {
        publicTargets = getPublicSceneTokenUuids(targets);
    } catch {
        throw new Error("Invalid target-helper targets");
    }
    const normalized = normalizeTargetHelperFlagData(serializeFlagData({ ...existing, targets: publicTargets, generation: existing.generation + 1, revision: createTargetRevision() }));
    if (!normalized) throw new Error("Invalid target-helper targets");

    const updates: Record<string, unknown> = {
        [`flags.${MODULE_ID}.${FLAG_KEY}.targets`]: normalized.targets,
        [`flags.${MODULE_ID}.${FLAG_KEY}.generation`]: normalized.generation,
        [`flags.${MODULE_ID}.${FLAG_KEY}.revision`]: normalized.revision,
    };
    const rawSaves = getRawFlagData(message)?.saves;
    if (isRecord(rawSaves)) {
        for (const rawKey of Object.keys(rawSaves)) {
            if (isEncodedTargetUuidSaveKey(rawKey) || isSafeTokenId(rawKey)) {
                updates[`flags.${MODULE_ID}.${FLAG_KEY}.saves.-=${rawKey}`] = null;
            }
        }
    }

    await (message as Sf2eChatMessage).update(updates);
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Get the current user's targeted tokens as an array of UUIDs.
 */
export function getCurrentTargetUUIDs(): string[] {
    const sf2eG = game as Sf2eGame;
    const targets = sf2eG.user?.targets;
    if (!targets || typeof (targets as Iterable<unknown>)[Symbol.iterator] !== "function") return [];

    const uuids: string[] = [];
    for (const token of targets) {
        const actor = token.actor;
        if (actor && ["creature", "npc", "character", "hazard", "vehicle"].includes(actor.type as string)) {
            const uuid = token.document?.uuid ?? token.uuid;
            if (isPublicSceneTokenUuid(uuid)) uuids.push(uuid);
        }
    }
    return uuids;
}

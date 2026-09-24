import { setTerrainStatus, hasTerrainStatus } from "./rulesets/sf2e/movement/index.js";
import { movementFeatureEnabled } from "./rulesets/sf2e/movement/index.js";
import { migrateLegacy,configureSurfaceVisibility } from "./canvas/regions/index.js";
import { MODULE_ID } from "./constants.js";
import {
    canUpdateMessage,
    getFlagData,
    rollNpcSaves,
    rollOvercomeForTargets,
    rollSavesForTargets,
    updateTargets,
} from "./rulesets/sf2e/target-helper/index.js";
import {
    postAttackCard,
    resolveAttackCardProvenance,
    rollAttackCardArmorSaves,
    rollWeaponDamage,
} from "./rulesets/sf2e/prad/index.js";
import { toggleFlying } from "./rulesets/sf2e/flying/index.js";

export type CodexFoundryApiErrorCode =
    | "disabled"
    | "unauthorized"
    | "not-found"
    | "invalid-argument"
    | "operation-failed";

export interface CodexFoundryApiError {
    readonly code: CodexFoundryApiErrorCode;
    readonly message: string;
}

export interface CodexFoundryApiFailure {
    readonly ok: false;
    readonly error: CodexFoundryApiError;
}

export type CodexFoundryApiResult = { readonly ok: true } | CodexFoundryApiFailure;
export type CodexFoundryCreatedMessageResult = { readonly ok: true; readonly messageUuid: string } | CodexFoundryApiFailure;

export interface MessageRequest {
    readonly messageUuid: string;
}

export interface SetTargetsRequest extends MessageRequest {
    readonly targetTokenUuids: readonly string[];
}

export type RollTargetsRequest = SetTargetsRequest;

export interface PostAttackCardRequest {
    readonly attackerUuid: string;
    readonly weaponItemUuid: string;
    readonly attackDC: number;
    readonly attackerTokenUuid?: string;
    readonly targetTokenUuids: readonly string[];
}

export interface RollArmorSavesRequest extends MessageRequest {
    readonly targetTokenUuids: readonly string[];
}

export interface ToggleFlyingRequest {
    readonly tokenUuids: readonly string[];
}

export interface ForceMoveRequest {
    tokenUuid:string;
    waypoints:{x:number;y:number;elevation?:number;level?:string}[];
    danger:"allowed"|"forbidden";
}
export interface CodexFoundryApi {
    readonly movement:{forceMove(request:ForceMoveRequest):Promise<CodexFoundryApiResult>;toggleStatus(request:{status:"climbing"|"swimming";tokenUuids:string[]}):Promise<CodexFoundryApiResult>};
    readonly regions: { migrateLegacy: typeof migrateLegacy;configureSurfaceVisibility:typeof configureSurfaceVisibility };
    readonly flying: {
        /** Add the Flying effect to each token's actor, or remove it from actors that already fly. */
        toggleFlying(request: ToggleFlyingRequest): Promise<CodexFoundryApiResult>;
    };
    readonly targetHelper: {
        setTargets(request: SetTargetsRequest): Promise<CodexFoundryApiResult>;
        rollPlayerSaves(request: RollTargetsRequest): Promise<CodexFoundryApiResult>;
        rollNpcSaves(request: MessageRequest): Promise<CodexFoundryApiResult>;
        rollOvercome(request: RollTargetsRequest): Promise<CodexFoundryApiResult>;
    };
    readonly prad: {
        postAttackCard(request: PostAttackCardRequest): Promise<CodexFoundryCreatedMessageResult>;
        rollArmorSaves(request: RollArmorSavesRequest): Promise<CodexFoundryApiResult>;
        rollWeaponDamage(request: MessageRequest): Promise<CodexFoundryApiResult>;
    };
}

const success: CodexFoundryApiResult = { ok: true };

function failure(code: CodexFoundryApiErrorCode, message: string): CodexFoundryApiFailure {
    return { ok: false, error: { code, message } };
}

function isEnabled(setting: "enableCustomRules" | "enableTargetHelper" | "playersRollAllDice"): boolean {
    return game.settings!.get(MODULE_ID, setting) === true;
}

function requireTargetHelperEnabled(): CodexFoundryApiFailure | undefined {
    if (!isEnabled("enableCustomRules")) return failure("disabled", "Custom rules are disabled.");
    if (!isEnabled("enableTargetHelper")) return failure("disabled", "Target Helper is disabled.");
    return undefined;
}

function requirePradEnabled(): CodexFoundryApiFailure | undefined {
    const targetHelperFailure = requireTargetHelperEnabled();
    if (targetHelperFailure) return targetHelperFailure;
    if (!isEnabled("playersRollAllDice")) return failure("disabled", "Players Roll All Dice is disabled.");
    return undefined;
}

const UUID_SEGMENT = /^[A-Za-z0-9_-]+$/;

function isUuid(value: string): boolean {
    const parts = value.split(".");
    if (!parts.every((part) => UUID_SEGMENT.test(part))) return false;
    return parts[0] === "Compendium"
        ? parts.length >= 4
        : parts.length >= 2 && parts.length % 2 === 0;
}

function requireUuid(uuid: unknown, name: string): CodexFoundryApiFailure | undefined {
    if (typeof uuid !== "string" || uuid.length > 512 || !isUuid(uuid)) {
        return failure("invalid-argument", `${name} must be a syntactically valid bounded UUID.`);
    }
    return undefined;
}

function resolveUuid(uuid: string): CodexFoundryResolvedUuidDocument | null {
    try {
        return fromUuidSync(uuid) as CodexFoundryResolvedUuidDocument | null;
    } catch {
        return null;
    }
}

function hasDocumentName<T extends CodexFoundryResolvedUuidDocumentName>(
    document: CodexFoundryResolvedUuidDocument | null,
    name: T,
): document is Extract<CodexFoundryResolvedUuidDocument, { readonly documentName: T }> {
    return document?.documentName === name;
}

function resolveMessage(messageUuid: unknown): ChatMessage.Implementation | CodexFoundryApiFailure {
    const invalid = requireUuid(messageUuid, "messageUuid");
    if (invalid) return invalid;

    const document = resolveUuid(messageUuid as string);
    if (!document) return failure("not-found", `No document exists for messageUuid: ${String(messageUuid)}`);
    if (!hasDocumentName(document, "ChatMessage")) {
        return failure("invalid-argument", "messageUuid must identify a ChatMessage document.");
    }
    return document;
}

function resolveActor(actorUuid: unknown, name = "actorUuid"): Actor.Implementation | CodexFoundryApiFailure {
    const invalid = requireUuid(actorUuid, name);
    if (invalid) return invalid;

    const document = resolveUuid(actorUuid as string);
    if (!document) return failure("not-found", `No document exists for ${name}: ${String(actorUuid)}`);
    if (!hasDocumentName(document, "Actor")) {
        return failure("invalid-argument", `${name} must identify an Actor document.`);
    }
    return document;
}

function resolveItem(itemUuid: unknown): Item.Implementation | CodexFoundryApiFailure {
    const invalid = requireUuid(itemUuid, "weaponItemUuid");
    if (invalid) return invalid;

    const document = resolveUuid(itemUuid as string);
    if (!document) return failure("not-found", `No document exists for weaponItemUuid: ${String(itemUuid)}`);
    if (!hasDocumentName(document, "Item")) {
        return failure("invalid-argument", "weaponItemUuid must identify an Item document.");
    }
    return document;
}

function resolveTokens(targetTokenUuids: unknown, allowEmpty: boolean): Sf2eTokenDocument[] | CodexFoundryApiFailure {
    if (!Array.isArray(targetTokenUuids) || targetTokenUuids.length > 100 || (!allowEmpty && targetTokenUuids.length === 0)) {
        return failure("invalid-argument", `targetTokenUuids must be ${allowEmpty ? "an" : "a non-empty"} bounded array of token UUIDs.`);
    }

    const tokens: Sf2eTokenDocument[] = [];
    const seenUuids = new Set<string>();
    const seenTokenIds = new Set<string>();
    for (const uuid of targetTokenUuids) {
        const invalid = requireUuid(uuid, "targetTokenUuid");
        if (invalid) return invalid;
        if (seenUuids.has(uuid)) continue;

        const document = resolveUuid(uuid);
        if (!document) return failure("not-found", `No document exists for targetTokenUuid: ${uuid}`);
        if (!hasDocumentName(document, "Token") || !document.actor) {
            return failure("invalid-argument", `Target UUID must identify a Token document with an actor: ${uuid}`);
        }
        if (seenTokenIds.has(document.id)) {
            return failure("invalid-argument", "Target UUIDs must not resolve to tokens with colliding IDs.");
        }
        seenUuids.add(uuid);
        seenTokenIds.add(document.id);
        tokens.push(document);
    }
    return tokens;
}

function requireMessageAuthorization(message: ChatMessage.Implementation): CodexFoundryApiFailure | undefined {
    if (!canUpdateMessage(message)) return failure("unauthorized", "The current user cannot update this chat message.");
    return undefined;
}

function requireTargetHelperFlags(message: ChatMessage.Implementation): CodexFoundryApiFailure | undefined {
    if (!getFlagData(message)) {
        return failure("invalid-argument", "The chat message does not contain Target Helper data.");
    }
    return undefined;
}

function requireSaveFlags(message: ChatMessage.Implementation): CodexFoundryApiFailure | undefined {
    const flagData = getFlagData(message);
    if (!flagData?.save || flagData.pradOvercome) {
        return failure("invalid-argument", "The chat message is not configured for ordinary Target Helper save rolling.");
    }
    return undefined;
}

function requireFiniteDC(attackDC: unknown): CodexFoundryApiFailure | undefined {
    if (typeof attackDC !== "number" || !Number.isFinite(attackDC) || !Number.isInteger(attackDC) || attackDC < 0) {
        return failure("invalid-argument", "attackDC must be a non-negative integer.");
    }
    return undefined;
}


function requireCardMembership(message: ChatMessage.Implementation, tokens: readonly Sf2eTokenDocument[]): CodexFoundryApiFailure | undefined {
    const targetUuids = new Set(getFlagData(message)?.targets ?? []);
    if (tokens.some((token) => !targetUuids.has(token.uuid))) {
        return failure("invalid-argument", "Every target token must belong to the chat card target list.");
    }
    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function invoke(operation: () => Promise<unknown>): Promise<CodexFoundryApiResult> {
    try {
        await operation();
        return success;
    } catch (error) {
        console.error(`${MODULE_ID} | Runtime API operation failed`, error);
        return failure("operation-failed", "The requested operation failed.");
    }
}

async function invokeOutcome(operation: () => Promise<boolean>): Promise<CodexFoundryApiResult> {
    try {
        return await operation() ? success : failure("operation-failed", "The requested operation did not complete.");
    } catch (error) {
        console.error(`${MODULE_ID} | Runtime API operation failed`, error);
        return failure("operation-failed", "The requested operation failed.");
    }
}

async function invokeCreatedMessage(operation: () => Promise<string>): Promise<CodexFoundryCreatedMessageResult> {
    try {
        const messageUuid = await operation();
        return { ok: true, messageUuid };
    } catch (error) {
        console.error(`${MODULE_ID} | Runtime API operation failed`, error);
        return failure("operation-failed", "The requested operation failed.");
    }
}

export function createRuntimeApi(): CodexFoundryApi {
    return {
        regions: { migrateLegacy,configureSurfaceVisibility },
        movement: {
            async toggleStatus(request) {
                if(!isRecord(request) || !["climbing","swimming"].includes(request.status))return failure("invalid-argument","Choose climbing or swimming.");
                if(!game.user?.isGM)return failure("unauthorized","Only a GM can toggle terrain statuses.");
                if(!movementFeatureEnabled(request.status))return failure("disabled","This movement feature is disabled.");
                const tokens=resolveTokens(request.tokenUuids,false);
                if(!Array.isArray(tokens))return tokens;
                return invoke(async()=>{for(const token of tokens) {
                    if(!token.actor)continue;
                    const actor=token.actor as unknown as Parameters<typeof setTerrainStatus>[0];
                    await setTerrainStatus(actor,token.uuid,request.status,!hasTerrainStatus(actor,token.uuid,request.status));
                }});
            },
            async forceMove(request) {
                if(!isRecord(request) || typeof request.tokenUuid!=="string" || !/^Scene\.[A-Za-z0-9_-]+\.Token\.[A-Za-z0-9_-]+$/.test(request.tokenUuid) ||
                    request.tokenUuid.length>512 || !["allowed","forbidden"].includes(request.danger) ||
                    !Array.isArray(request.waypoints) || !request.waypoints.length || request.waypoints.length>100 ||
                    request.waypoints.some(point=>!isRecord(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
                        (point.elevation!==undefined && !Number.isFinite(point.elevation)) || (point.level!==undefined && (typeof point.level!=="string" || !UUID_SEGMENT.test(point.level))))) {
                    return failure("invalid-argument","Supply a token UUID, 1–100 finite waypoints and allowed or forbidden danger.");
                }
                if(!game.user?.isGM) return failure("unauthorized","Only a GM can force movement.");
                if(!movementFeatureEnabled("forcedMovement")) return failure("disabled","Forced movement is disabled.");
                const token=resolveUuid(request.tokenUuid);
                if(!token) return failure("not-found","The token was not found.");
                if(!hasDocumentName(token,"Token")) return failure("invalid-argument","The UUID must identify a token.");
                const native=token as unknown as {move(waypoints:ForceMoveRequest["waypoints"],options:object):Promise<unknown>};
                return invoke(()=>native.move(request.waypoints,{codexMovementIntent:{kind:"forced",danger:request.danger}}));
            },
        },
        flying: {
            async toggleFlying(request) {
                if (!isRecord(request)) return failure("invalid-argument", "request must be an object.");
                if (!isEnabled("enableCustomRules")) return failure("disabled", "Custom rules are disabled.");
                const tokens = resolveTokens(request.tokenUuids, false);
                if (!Array.isArray(tokens)) return tokens;
                if (!game.user?.isGM && tokens.some((token) => !token.isOwner)) {
                    return failure("unauthorized", "The current user does not own every token.");
                }
                return invoke(() => toggleFlying(tokens as unknown as Parameters<typeof toggleFlying>[0]));
            },
        },
        targetHelper: {
            async setTargets(request) {
                if (!isRecord(request)) return failure("invalid-argument", "request must be an object.");
                const { messageUuid, targetTokenUuids } = request;
                const disabled = requireTargetHelperEnabled();
                if (disabled) return disabled;
                const message = resolveMessage(messageUuid);
                if (!("flags" in message)) return message;
                const unauthorized = requireMessageAuthorization(message);
                if (unauthorized) return unauthorized;
                const invalidMessage = requireTargetHelperFlags(message);
                if (invalidMessage) return invalidMessage;
                const tokens = resolveTokens(targetTokenUuids, true);
                if (!Array.isArray(tokens)) return tokens;
                return invoke(() => updateTargets(message, tokens.map((token) => token.uuid)));
            },
            async rollPlayerSaves(request) {
                if (!isRecord(request)) return failure("invalid-argument", "request must be an object.");
                const { messageUuid, targetTokenUuids } = request;
                const disabled = requireTargetHelperEnabled();
                if (disabled) return disabled;
                const message = resolveMessage(messageUuid);
                if (!("flags" in message)) return message;
                const unauthorized = requireMessageAuthorization(message);
                if (unauthorized) return unauthorized;
                const invalidMessage = requireSaveFlags(message);
                if (invalidMessage) return invalidMessage;
                const tokens = resolveTokens(targetTokenUuids, false);
                if (!Array.isArray(tokens)) return tokens;
                if (!game.user?.isGM && tokens.some((token) => !token.isOwner)) {
                    return failure("unauthorized", "The current user does not own every target token.");
                }
                const invalidTargets = requireCardMembership(message, tokens);
                if (invalidTargets) return invalidTargets;
                return invokeOutcome(() => rollSavesForTargets(new MouseEvent("click"), message, tokens));
            },
            async rollNpcSaves(request) {
                if (!isRecord(request)) return failure("invalid-argument", "request must be an object.");
                const { messageUuid } = request;
                const disabled = requireTargetHelperEnabled();
                if (disabled) return disabled;
                if (!game.user?.isGM) return failure("unauthorized", "Only a GM can roll NPC saves.");
                const message = resolveMessage(messageUuid);
                if (!("flags" in message)) return message;
                const unauthorized = requireMessageAuthorization(message);
                if (unauthorized) return unauthorized;
                const invalidMessage = requireSaveFlags(message);
                if (invalidMessage) return invalidMessage;
                return invokeOutcome(() => rollNpcSaves(new MouseEvent("click"), message));
            },
            async rollOvercome(request) {
                if (!isRecord(request)) return failure("invalid-argument", "request must be an object.");
                const { messageUuid, targetTokenUuids } = request;
                const disabled = requirePradEnabled();
                if (disabled) return disabled;
                const message = resolveMessage(messageUuid);
                if (!("flags" in message)) return message;
                const unauthorized = requireMessageAuthorization(message);
                if (unauthorized) return unauthorized;
                const flagData = getFlagData(message);
                if (!flagData?.save || !flagData.pradOvercome) {
                    return failure("invalid-argument", "The chat message is not configured for PRAD overcome rolling.");
                }
                const caster = flagData.author
                    ? resolveUuid(flagData.author)
                    : (message as Sf2eChatMessage).actor ?? null;
                if (!hasDocumentName(caster, "Actor")) {
                    return failure("invalid-argument", "The PRAD overcome caster cannot be resolved.");
                }
                if (!game.user?.isGM) {
                    const canRoll = flagData.author
                        ? !!(caster as Actor.Implementation & { readonly isOwner?: boolean }).isOwner
                        : !!(message as Sf2eChatMessage).isAuthor;
                    if (!canRoll) return failure("unauthorized", "The current user cannot roll for the PRAD overcome caster.");
                }
                const tokens = resolveTokens(targetTokenUuids, false);
                if (!Array.isArray(tokens)) return tokens;
                const invalidTargets = requireCardMembership(message, tokens);
                if (invalidTargets) return invalidTargets;
                return invokeOutcome(() => rollOvercomeForTargets(new MouseEvent("click"), message, tokens));
            },
        },
        prad: {
            async postAttackCard(request) {
                if (!isRecord(request)) return failure("invalid-argument", "request must be an object.");
                const { attackerUuid, weaponItemUuid, attackDC, attackerTokenUuid, targetTokenUuids } = request;
                const disabled = requirePradEnabled();
                if (disabled) return disabled;
                if (!game.user?.isGM) return failure("unauthorized", "Only a GM can post PRAD attack cards.");
                const invalidDC = requireFiniteDC(attackDC);
                if (invalidDC) return invalidDC;
                const attacker = resolveActor(attackerUuid, "attackerUuid");
                if (!("items" in attacker)) return attacker;
                if ((attacker.type as string) !== "npc") {
                    return failure("invalid-argument", "attackerUuid must identify an NPC actor.");
                }
                const weaponItem = resolveItem(weaponItemUuid);
                if (!("system" in weaponItem)) return weaponItem;
                if (!weaponItem.id || attacker.items.get(weaponItem.id) !== weaponItem) {
                    return failure("invalid-argument", "weaponItemUuid must identify an item owned by the attacker.");
                }
                let attackerTokenUUID: string | undefined;
                if (attackerTokenUuid !== undefined) {
                    const tokens = resolveTokens([attackerTokenUuid], false);
                    if (!Array.isArray(tokens)) return tokens;
                    const [attackerToken] = tokens;
                    if (attackerToken.actor !== attacker) {
                        return failure("invalid-argument", "attackerTokenUuid must identify the exact token actor supplied by attackerUuid.");
                    }
                    attackerTokenUUID = attackerToken.uuid;
                }
                const tokens = resolveTokens(targetTokenUuids, true);
                if (!Array.isArray(tokens)) return tokens;
                const resolvedTargetUuids = tokens.map((token) => token.uuid);
                return invokeCreatedMessage(() => postAttackCard({
                    attacker,
                    attackDC,
                    attackerTokenUUID,
                    targetTokenUUIDs: resolvedTargetUuids,
                    weaponItem,
                }));
            },
            async rollArmorSaves(request) {
                if (!isRecord(request)) return failure("invalid-argument", "request must be an object.");
                const { messageUuid, targetTokenUuids } = request;
                const disabled = requirePradEnabled();
                if (disabled) return disabled;
                const message = resolveMessage(messageUuid);
                if (!("flags" in message)) return message;
                const provenance = resolveAttackCardProvenance(message);
                if (!provenance) {
                    return failure("invalid-argument", "messageUuid must identify a GM-authored PRAD attack card with valid persisted provenance.");
                }
                const tokens = resolveTokens(targetTokenUuids, false);
                if (!Array.isArray(tokens)) return tokens;
                if (!game.user?.isGM && tokens.some((token) => !token.isOwner)) {
                    return failure("unauthorized", "The current user does not own every target token.");
                }
                const cardTargets = new Set(provenance.targetTokenUUIDs);
                if (tokens.some((token) => !cardTargets.has(token.uuid))) {
                    return failure("invalid-argument", "Every target token must belong to the trusted PRAD attack card.");
                }
                return invokeOutcome(() => rollAttackCardArmorSaves(message, tokens));
            },
            async rollWeaponDamage(request) {
                if (!isRecord(request)) return failure("invalid-argument", "request must be an object.");
                const { messageUuid } = request;
                const disabled = requirePradEnabled();
                if (disabled) return disabled;
                if (!game.user?.isGM) return failure("unauthorized", "Only a GM can roll weapon damage.");
                const message = resolveMessage(messageUuid);
                if (!("flags" in message)) return message;
                const moduleFlags = (message.flags as Sf2eMessageFlags)?.[MODULE_ID];
                if (moduleFlags?.pradType !== "attack-card") {
                    return failure("invalid-argument", "The chat message is not a PRAD attack card.");
                }
                return invokeOutcome(() => rollWeaponDamage(message));
            },
        },
    };
}

export function installRuntimeApi(): void {
    const module = (game as Sf2eGame).modules?.get(MODULE_ID);
    if (!module) throw new Error(`Cannot install runtime API: module ${MODULE_ID} is unavailable`);
    module.api = createRuntimeApi();
}

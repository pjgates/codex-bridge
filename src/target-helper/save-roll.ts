/**
 * Target Helper — Save Rolling (Imperative Shell)
 *
 * Handles rolling saves for targets using the system's native check APIs.
 * Results are captured via callback and stored in message flags.
 *
 * Filtering and result-building logic is delegated to pure functions
 * in shared/roll-logic.ts.
 *
 * Ported from PF2e Toolbelt's Target Helper save.ts.
 */

import { MODULE_ID } from "../constants.js";
import { isCurrentUserDesignatedActorRoller, isCurrentUserDesignatedTargetRoller } from "../shared/authorized-roller.js";
import { getArmorSaveModifier, getPcAC, getSaveDC } from "../shared/dc.js";
import { calculateDegree, degreeToString, invertDegreeString } from "../shared/degree.js";
import {
    filterUnrolledNpcTargets,
    filterEligibleActiveTokens,
    filterUnrolledTargets,
    buildSaveResult,
    buildOvercomeResult,
    selectBestStatistic,
    type RollCallbackData,
    type TokenFilterData,
    type StatisticCandidate,
} from "../shared/roll-logic.js";
import { canUpdateMessage, getFlagData, updateSaves } from "./flags.js";
import { type PersistedSaveResultData, type SaveResultData, type DegreeOfSuccessString } from "./types.js";
import { getTargetTokenId, normalizeSaveResult } from "./result-validation.js";

// ─── Roll Callback Helpers ───────────────────────────────────────────────────

/**
 * Extract raw data from a Foundry roll callback for the pure builder.
 */
function extractRollCallbackData(roll: Roll, msg: ChatMessage.Implementation | null): RollCallbackData {
    const dieTerm = roll.terms?.[0] as Sf2eRollDieTerm | undefined;
    const dieTotal: number = dieTerm?.total ?? dieTerm?.results?.[0]?.result ?? 0;

    const msgFlags = msg?.flags as Sf2eMessageFlags | undefined;
    const systemFlags = (msgFlags?.sf2e ?? msgFlags?.pf2e) as Sf2eSystemFlags | undefined;
    const rawModifiers = systemFlags?.modifiers ?? [];

    const isPrivate = (msg?.whisper?.length ?? 0) > 0;

    return {
        total: roll.total ?? 0,
        dieTotal,
        modifiers: rawModifiers.map((m) => ({
            label: m.label ?? "Unknown",
            modifier: m.modifier ?? 0,
            enabled: !!m.enabled,
        })),
        isPrivate,
    };
}

const inFlightTokenRolls = new WeakMap<object, Set<string>>();

function notifyPersistenceUnavailable(): void {
    const key = "sf2e-forge-custom.targetHelper.cannotPersist";
    ui.notifications?.error(game.i18n?.localize?.(key) ?? key);
}

function reserveTokenRoll(message: ChatMessage.Implementation, tokenUuid: string): (() => void) | null {
    let tokenUuids = inFlightTokenRolls.get(message);
    if (!tokenUuids) {
        tokenUuids = new Set<string>();
        inFlightTokenRolls.set(message, tokenUuids);
    }
    if (tokenUuids.has(tokenUuid)) return null;

    tokenUuids.add(tokenUuid);
    return () => {
        tokenUuids!.delete(tokenUuid);
        if (tokenUuids!.size === 0) inFlightTokenRolls.delete(message);
    };
}

function resolveUuidSync<T>(uuid: string): T | null {
    try {
        return fromUuidSync(uuid) as T | null;
    } catch {
        return null;
    }
}

function getTokenUuid(token: Sf2eTokenDocument): string {
    return token.uuid;
}

const OVERCOME_REROLL_IDENTIFIER_PREFIX = `${MODULE_ID}:target-helper-overcome:v1`;
const MAX_OVERCOME_REROLL_IDENTIFIER_LENGTH = 768;
const MAX_PARENT_MESSAGE_ID_LENGTH = 128;
const TARGET_REVISION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PARENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

interface OvercomeRerollLink {
    readonly parentMessageId: string;
    readonly targetUuid: string;
    readonly generation: number;
    readonly revision: string;
}

interface RollDieResult {
    readonly active?: unknown;
    readonly result?: unknown;
}

interface RollDie {
    readonly number?: unknown;
    readonly faces?: unknown;
    readonly results?: readonly RollDieResult[];
}

function isSafeParentMessageId(value: unknown): value is string {
    return typeof value === "string"
        && value.length > 0
        && value.length <= MAX_PARENT_MESSAGE_ID_LENGTH
        && SAFE_PARENT_MESSAGE_ID_PATTERN.test(value)
        && value !== "__proto__"
        && value !== "constructor"
        && value !== "prototype";
}

function isTargetRevision(value: unknown): value is string {
    return typeof value === "string" && TARGET_REVISION_PATTERN.test(value);
}

function createOvercomeRerollIdentifier(link: OvercomeRerollLink): string | null {
    if (!isSafeParentMessageId(link.parentMessageId)
        || getTargetTokenId(link.targetUuid) === null
        || !Number.isSafeInteger(link.generation)
        || link.generation < 0
        || !isTargetRevision(link.revision)) return null;

    const identifier = `${OVERCOME_REROLL_IDENTIFIER_PREFIX}|${link.parentMessageId}|${link.targetUuid}|${link.generation}|${link.revision}`;
    return identifier.length <= MAX_OVERCOME_REROLL_IDENTIFIER_LENGTH ? identifier : null;
}

function parseOvercomeRerollIdentifier(value: unknown): OvercomeRerollLink | null {
    if (typeof value !== "string" || value.length > MAX_OVERCOME_REROLL_IDENTIFIER_LENGTH) return null;
    const parts = value.split("|");
    if (parts.length !== 5 || parts[0] !== OVERCOME_REROLL_IDENTIFIER_PREFIX) return null;

    const [, parentMessageId, targetUuid, rawGeneration, revision] = parts;
    const generation = Number(rawGeneration);
    if (!isSafeParentMessageId(parentMessageId)
        || getTargetTokenId(targetUuid) === null
        || !Number.isSafeInteger(generation)
        || generation < 0
        || generation.toString() !== rawGeneration
        || !isTargetRevision(revision)) return null;

    return { parentMessageId, targetUuid, generation, revision };
}

function getRollIdentifier(roll: Roll): unknown {
    return (roll as Roll & { readonly options?: { readonly identifier?: unknown } }).options?.identifier;
}

function getActiveD20Result(roll: Roll): number | null {
    const dice = (roll as Roll & { readonly dice?: readonly RollDie[] }).dice;
    if (!Array.isArray(dice)) return null;
    const d20s = dice.filter((die) => die.number === 1 && die.faces === 20);
    if (d20s.length !== 1 || !Array.isArray(d20s[0].results)) return null;
    const activeResults = d20s[0].results.filter((result) => result.active === true);
    const result = activeResults.length === 1 ? activeResults[0].result : null;
    return typeof result === "number" && Number.isInteger(result) && result >= 1 && result <= 20 ? result : null;
}

function getMessageById(id: string): ChatMessage.Implementation | null {
    const message = game.messages?.get(id) as ChatMessage.Implementation | undefined;
    return message?.id === id ? message : null;
}

async function updateLinkedOvercomeReroll(oldRoll: Roll, newRoll: Roll): Promise<void> {
    const oldIdentifier = getRollIdentifier(oldRoll);
    if (getRollIdentifier(newRoll) !== oldIdentifier) return;
    const link = parseOvercomeRerollIdentifier(oldIdentifier);
    if (!link) return;

    const parent = getMessageById(link.parentMessageId);
    if (!parent || !canUpdateMessage(parent)) return;
    const flagData = getFlagData(parent);
    if (!flagData?.pradOvercome
        || !flagData.save
        || flagData.generation !== link.generation
        || flagData.revision !== link.revision
        || !flagData.targets.includes(link.targetUuid)) return;

    const targetId = getTargetTokenId(link.targetUuid);
    const previous = targetId ? flagData.saves?.[targetId] : undefined;
    if (!targetId
        || !previous
        || previous.private
        || previous.targetUuid !== link.targetUuid
        || previous.generation !== link.generation
        || previous.revision !== link.revision
        || previous.statistic !== flagData.save.statistic
        || typeof previous.overcomeDc !== "number"
        || !Number.isFinite(previous.overcomeDc)
        || previous.overcomeSuccess === undefined
        || previous.success !== invertDegreeString(previous.overcomeSuccess)
        || !canRollOvercomeAsCurrentUser(parent, flagData.author)) return;

    const die = getActiveD20Result(newRoll);
    const total = newRoll.total;
    if (die === null || typeof total !== "number" || !Number.isFinite(total)) return;
    const overcomeSuccess = degreeToString(calculateDegree(total, previous.overcomeDc, die));
    const replacement = normalizeSaveResult({
        ...previous,
        value: total,
        die,
        success: invertDegreeString(overcomeSuccess),
        overcomeSuccess,
    }, flagData.save.statistic);
    if (!replacement) return;

    await updateSaves(parent, { [targetId]: replacement });
}

/** Update a linked inline Overcome result after PF2e evaluates a native replacement roll. */
export function onTargetHelperReroll(oldRoll: Roll, newRoll: Roll): void {
    void updateLinkedOvercomeReroll(oldRoll, newRoll).catch((error: unknown) => {
        console.error(`${MODULE_ID} | PRAD Overcome: Unable to persist native reroll result`, error);
    });
}

function resolveMessageOriginToken(message: ChatMessage.Implementation, origin: Sf2eActor | null): Sf2eTokenDocument | null {
    const sceneId = message.speaker?.scene;
    const tokenId = message.speaker?.token;
    if (!origin || typeof sceneId !== "string" || typeof tokenId !== "string") return null;
    const uuid = `Scene.${sceneId}.Token.${tokenId}`;
    const token = resolveUuidSync<Sf2eTokenDocument>(uuid);
    return token?.uuid === uuid && token.actor === origin ? token : null;
}

/** Resolve an explicit PRAD caster, or the actor carried by a normal spell card. */
export function resolveOvercomeCasterActor(
    message: ChatMessage.Implementation,
    explicitAuthorUuid?: string,
): Sf2eActor | null {
    return explicitAuthorUuid
        ? resolveUuidSync<Sf2eActor>(explicitAuthorUuid)
        : (message as Sf2eChatMessage).actor ?? null;
}

/** Explicit PRAD cards require actor ownership; normal spell cards use authorship. */
export function canRollOvercomeAsCurrentUser(
    message: ChatMessage.Implementation,
    explicitAuthorUuid?: string,
    casterActor = resolveOvercomeCasterActor(message, explicitAuthorUuid),
): boolean {
    if (!casterActor) return false;
    return isCurrentUserDesignatedActorRoller(message, casterActor, explicitAuthorUuid === undefined);
}

function hasCollidingResolvedTokenIds(tokenUuids: readonly string[]): boolean {
    const tokenUuidsById = new Map<string, string>();
    for (const uuid of tokenUuids) {
        const token = resolveUuidSync<Sf2eTokenDocument>(uuid);
        if (!token) continue;
        const existingUuid = tokenUuidsById.get(token.id);
        if (existingUuid !== undefined && existingUuid !== uuid) return true;
        tokenUuidsById.set(token.id, uuid);
    }
    return false;
}

function hasExactCardTargets(targets: Sf2eTokenDocument[], cardTargetUuids: readonly string[]): boolean {
    const cardTargets = new Set(cardTargetUuids);
    if (hasCollidingResolvedTokenIds(cardTargetUuids)) return false;
    const tokenIds = new Set<string>();
    return targets.every((target) => {
        if (tokenIds.has(target.id) || !cardTargets.has(getTokenUuid(target))) return false;
        tokenIds.add(target.id);
        return true;
    });
}

async function persistSaveUpdates(
    message: ChatMessage.Implementation,
    updates: Record<string, SaveResultData | PersistedSaveResultData>,
): Promise<boolean> {
    if (Object.keys(updates).length === 0) return false;

    try {
        return await updateSaves(message, updates);
    } catch (error) {
        console.error(`${MODULE_ID} | Target Helper: Unable to persist inline save results`, error);
        notifyPersistenceUnavailable();
        return false;
    }
}

function isConsumableWeapon(item: Sf2eItem | null): boolean {
    const traits = (item as Sf2eItem & { readonly traits?: { has?(slug: string): boolean } } | null)?.traits;
    return item?.isOfType?.("weapon") === true && traits?.has?.("consumable") === true;
}

export interface ArmorSaveRollOptions {
    readonly actor: Sf2eActor;
    readonly token: Sf2eTokenDocument;
    readonly attackDC: number;
    readonly weaponName: string;
    /** Trusted resolved AC for this exact intercepted target. Manual cards omit it. */
    readonly armorClass?: number;
    readonly origin?: Actor.Implementation | null;
    readonly originToken?: Sf2eTokenDocument | null;
    readonly item?: Sf2eItem | null;
    readonly rollOptions?: readonly string[];
    readonly event?: Event | null;
    readonly skipDialog: boolean;
    readonly createMessage: boolean;
    readonly callback?: Sf2eRollCallback;
}

/** Roll an armor save using the actor's exact current AC, including DC-only modifiers. */
export async function rollArmorSave(options: ArmorSaveRollOptions): Promise<Roll | null> {
    const pf2e = (game as Sf2eGame).pf2e;
    if (!pf2e?.Check?.roll || !pf2e.CheckModifier || !pf2e.Modifier) return null;

    const { actor, token, attackDC, weaponName, armorClass, origin = null, originToken = null, item = null } = options;
    if (armorClass !== undefined && !Number.isFinite(armorClass)) return null;
    if (token.actor !== actor || (originToken && (!origin || originToken.actor !== origin))) return null;
    const armorSaveLabel = game.i18n!.localize("sf2e-forge-custom.prad.armorSave");
    const modifier = new pf2e.Modifier({
        label: armorSaveLabel,
        modifier: getArmorSaveModifier(armorClass ?? actor.armorClass?.value ?? getPcAC(actor)),
        type: "untyped",
    });
    const check = new pf2e.CheckModifier(armorSaveLabel, { modifiers: [] }, [modifier]);

    return pf2e.Check.roll(check, {
        actor,
        token,
        type: "check",
        title: armorSaveLabel,
        dc: { value: attackDC, label: weaponName },
        origin: origin ? {
            actor: origin,
            token: originToken,
            statistic: null,
            self: false,
            item,
            modifiers: [],
        } : null,
        target: {
            actor,
            token,
            statistic: null,
            self: true,
            item: null,
            distance: null,
            rangeIncrement: null,
        },
        ...(item ? { item } : {}),
        options: new Set(options.rollOptions ?? []),
        skipDialog: options.skipDialog,
        createMessage: options.createMessage,
    }, options.event ?? null, options.callback);
}

// ─── Save Rolling ────────────────────────────────────────────────────────────

/**
 * Roll saves for the given targets against a message's save DC.
 */
export async function rollSavesForTargets(
    event: MouseEvent,
    message: ChatMessage.Implementation,
    targets: Sf2eTokenDocument[],
): Promise<boolean> {
    const flagData = getFlagData(message);
    if (!flagData?.save || flagData.pradOvercome || targets.length === 0 || !hasExactCardTargets(targets, flagData.targets)) return false;
    if (!canUpdateMessage(message)) {
        notifyPersistenceUnavailable();
        return false;
    }
    if (targets.some((target) => !isCurrentUserDesignatedTargetRoller(message, target))) return false;

    const { statistic: saveStatistic, dc } = flagData.save;
    const { generation, revision } = flagData;
    const existingSaves = flagData.saves ?? {};
    const origin = (message as Sf2eChatMessage).actor ?? null;
    const messageItem = (message as Sf2eChatMessage).item;
    const originToken = resolveMessageOriginToken(message, origin);
    const item = messageItem && messageItem.uuid === flagData.item
        ? messageItem
        : flagData.item ? resolveUuidSync<Sf2eItem>(flagData.item) ?? null : null;
    if (flagData.type === "prad-attack" && saveStatistic === "ac" && flagData.interceptedAttack) {
        const itemActor = (item as Sf2eItem & { readonly actor?: Sf2eActor | null } | null)?.actor;
        if (!origin || !originToken || !item || item.uuid !== flagData.item || itemActor !== origin) return false;
    }
    const skipDialog = targets.length > 1;
    const updates: Record<string, PersistedSaveResultData> = {};
    const releases: Array<() => void> = [];

    const rollPromises = targets.map(async (target) => {
        if (existingSaves[target.id]) return;

        const actor = target.actor;
        if (!actor) return;
        const isArmorSave = flagData.type === "prad-attack" && saveStatistic === "ac";
        if (isArmorSave && flagData.interceptedAttack) {
            const exactTarget = resolveUuidSync<Sf2eTokenDocument>(getTokenUuid(target));
            if (exactTarget?.uuid !== getTokenUuid(target) || exactTarget.actor !== actor) return;
        }
        const statistic = isArmorSave ? undefined : actor.getStatistic?.(saveStatistic);
        if (!isArmorSave && !statistic?.check?.roll) return;

        const release = reserveTokenRoll(message, getTokenUuid(target));
        if (!release) return;
        releases.push(release);

        let callbackHandled = false;
        const callback: Sf2eRollCallback = (roll, success, msg) => {
            if (callbackHandled) return;
            callbackHandled = true;
            try {
                const data = extractRollCallbackData(roll, msg);
                const result = buildSaveResult(
                    data,
                    success as DegreeOfSuccessString,
                    saveStatistic,
                );
                const normalized = normalizeSaveResult({ ...result, targetUuid: getTokenUuid(target), generation, revision }, saveStatistic);
                if (normalized) updates[target.id] = normalized;
                else console.error(`${MODULE_ID} | Target Helper: Native save roll returned invalid data`);
            } catch (error) {
                console.error(`${MODULE_ID} | Target Helper: Error processing save roll`, error);
            }
        };

        try {
            const rollItem = isConsumableWeapon(item) ? null : item;
            const contextualTargetAc = flagData.contextualTargetAc;
            if (isArmorSave && contextualTargetAc && (contextualTargetAc.targetUuid !== getTokenUuid(target) || !Number.isFinite(contextualTargetAc.value))) return;
            if (isArmorSave) {
                if (flagData.interceptedAttack && !originToken) return;
                await rollArmorSave({
                    actor,
                    token: target,
                    attackDC: dc,
                    weaponName: item?.name ?? "",
                    ...(contextualTargetAc ? { armorClass: contextualTargetAc.value } : {}),
                    origin,
                    item: rollItem,
                    rollOptions: flagData.options ?? [],
                    originToken,
                    event,
                    skipDialog,
                    createMessage: false,
                    callback,
                });
            } else {
                if (!statistic?.check?.roll) return;
                await statistic.check.roll({
                    dc: { value: dc },
                    origin,
                    ...(rollItem ? { item: rollItem } : {}),
                    token: target,
                    extraRollOptions: flagData.options ?? [],
                    event,
                    skipDialog,
                    createMessage: false,
                    callback,
                });
            }
        } catch (error) {
            console.error(`${MODULE_ID} | Target Helper: Error rolling save`, error);
        }
    });

    await Promise.allSettled(rollPromises);
    try {
        return await persistSaveUpdates(message, updates);
    } finally {
        for (const release of releases) release();
    }
}

/**
 * Roll saves for all NPC targets that haven't rolled yet.
 * Only callable by the GM.
 */
export async function rollNpcSaves(
    event: MouseEvent,
    message: ChatMessage.Implementation,
): Promise<boolean> {
    if (!game.user?.isGM) return false;

    const flagData = getFlagData(message);
    if (!flagData?.save) return false;

    const existingSaves = flagData.saves ?? {};
    const saveStatistic = flagData.save.statistic;

    // Resolve tokens into plain data for the pure filter
    const tokenData: Array<{ token: Sf2eTokenDocument; filterData: TokenFilterData }> = [];
    for (const uuid of flagData.targets) {
        const token = resolveUuidSync<Sf2eTokenDocument>(uuid);
        if (!token?.actor) continue;
        tokenData.push({
            token,
            filterData: {
                id: token.id,
                uuid,
                hasActor: true,
                hasPlayerOwner: token.actor.hasPlayerOwner ?? false,
                hasStatistic: !!token.actor.getStatistic?.(saveStatistic),
            },
        });
    }

    // Pure filter
    const eligibleFilterData = filterUnrolledNpcTargets(
        tokenData.map((t) => t.filterData),
        existingSaves,
    );

    // Resolve back to Foundry tokens
    const eligibleIds = new Set(eligibleFilterData.map((t) => t.id));
    const npcTargets = tokenData
        .filter((t) => eligibleIds.has(t.filterData.id))
        .map((t) => t.token);

    if (npcTargets.length === 0) return false;

    return rollSavesForTargets(event, message, npcTargets);
}

/**
 * Roll a save for the current user's selected/active tokens.
 * Filters to tokens that are in the message's target list and haven't rolled.
 */
export async function rollSaveForActiveTokens(
    event: MouseEvent,
    message: ChatMessage.Implementation,
): Promise<boolean> {
    const flagData = getFlagData(message);
    if (!flagData?.save) return false;

    const existingSaves = flagData.saves ?? {};
    const targetUUIDs = flagData.targets;

    const sf2eG = game as Sf2eGame;
    const activeTokens: Sf2eActiveToken[] = sf2eG.user?.getActiveTokens?.() ?? [];

    // Map to plain data for the pure filter
    const tokenUUIDData = activeTokens.map((t) => ({
        id: t.id ?? t.document?.id ?? "",
        uuid: t.document?.uuid ?? t.uuid ?? "",
        raw: t,
    }));

    const eligible = filterEligibleActiveTokens(tokenUUIDData, targetUUIDs, existingSaves);

    if (eligible.length === 0) {
        if (activeTokens.length > 0) {
            ui.notifications!.info(game.i18n!.localize("sf2e-forge-custom.targetHelper.notInTargetList"));
        }
        return false;
    }

    // Resolve back to Foundry tokens
    const eligibleIds = new Set(eligible.map((t) => t.id));
    const eligibleTargets = activeTokens
        .filter((t) => eligibleIds.has(t.id ?? t.document?.id ?? ""))
        .map((t) => t.document ?? t) as Sf2eTokenDocument[];

    return rollSavesForTargets(event, message, eligibleTargets);
}

interface ContextualRollOptions {
    readonly origin?: Sf2eActor | null;
    readonly target?: Sf2eActor | null;
    readonly item?: Sf2eItem | null;
    readonly extraRollOptions?: readonly string[];
}

interface ContextualStatistic extends Sf2eStatistic {
    readonly check: Sf2eStatistic["check"] & {
        readonly modifiers: Sf2eModifier[];
        createRollOptions(options: ContextualRollOptions): Set<string>;
    };
    readonly dc?: { readonly value: number };
    withRollOptions(options: ContextualRollOptions): ContextualStatistic;
}

function resolveContextualStatistic(
    statistic: ContextualStatistic | undefined,
    options: ContextualRollOptions,
): ContextualStatistic | null {
    if (typeof statistic?.withRollOptions !== "function") return null;
    try {
        const contextual = statistic.withRollOptions(options);
        return Array.isArray(contextual?.check?.modifiers) && typeof contextual.check.createRollOptions === "function" ? contextual : null;
    } catch {
        return null;
    }
}

// ─── PRAD Overcome Rolling ───────────────────────────────────────────────────

/**
 * Roll an Overcome Check for the caster against one or more NPC targets.
 */
export async function rollOvercomeForTargets(
    event: MouseEvent,
    message: ChatMessage.Implementation,
    targets: Sf2eTokenDocument[],
): Promise<boolean> {
    const flagData = getFlagData(message);
    if (!flagData?.save || !flagData.pradOvercome || targets.length === 0 || !hasExactCardTargets(targets, flagData.targets)) return false;
    if (!canUpdateMessage(message)) {
        notifyPersistenceUnavailable();
        return false;
    }

    const { statistic: saveStatistic } = flagData.save;
    const existingSaves = flagData.saves ?? {};
    const { generation, revision } = flagData;
    const parentMessageId = message.id;
    if (!isSafeParentMessageId(parentMessageId)) return false;
    const messageItem = (message as Sf2eChatMessage).item;
    const item = messageItem && messageItem.uuid === flagData.item
        ? messageItem
        : flagData.item ? resolveUuidSync<Sf2eItem>(flagData.item) ?? null : null;

    const casterActor = resolveOvercomeCasterActor(message, flagData.author);
    if (!casterActor) {
        console.warn(`${MODULE_ID} | PRAD Overcome: Cannot resolve caster actor`);
        return false;
    }
    if (flagData.item !== undefined) {
        const itemActor = (item as Sf2eItem & { readonly actor?: Sf2eActor | null } | null)?.actor;
        if (!item || item.uuid !== flagData.item || itemActor !== casterActor) return false;
    }
    if (!canRollOvercomeAsCurrentUser(message, flagData.author, casterActor)) {
        console.warn(`${MODULE_ID} | PRAD Overcome: Current user cannot roll for caster actor`);
        return false;
    }
    const casterToken = resolveMessageOriginToken(message, casterActor);
    const casterStatistic = findBestOvercomeStatistic(casterActor);
    if (!casterStatistic?.check?.roll) {
        console.warn(`${MODULE_ID} | PRAD Overcome: No rollable statistic found for caster`);
        ui.notifications!.warn(game.i18n!.localize("sf2e-forge-custom.prad.noOvercomeStatistic"));
        return false;
    }

    const skipDialog = targets.length > 1;
    const updates: Record<string, PersistedSaveResultData> = {};
    const releases: Array<() => void> = [];

    const rollPromises = targets.map(async (target) => {
        if (existingSaves[target.id]) return;
        const npcActor = target.actor;
        const targetUuid = getTokenUuid(target);
        const exactTarget = resolveUuidSync<Sf2eTokenDocument>(targetUuid);
        if (!npcActor || exactTarget?.uuid !== targetUuid || exactTarget.actor !== npcActor) return;
        const identifier = createOvercomeRerollIdentifier({ parentMessageId, targetUuid, generation, revision });
        if (!identifier) return;
        const pf2e = (game as Sf2eGame).pf2e;
        const rollItem = isConsumableWeapon(item) ? null : item;
        const npcStatistic = npcActor.getStatistic?.(saveStatistic) as ContextualStatistic | undefined;
        const contextItem = item;
        const contextualNpcStatistic = resolveContextualStatistic(npcStatistic, {
            origin: casterActor,
            item: contextItem,
            extraRollOptions: flagData.options ?? [],
        });
        const contextualCasterStatistic = resolveContextualStatistic(casterStatistic as ContextualStatistic, {
            target: npcActor,
            item: contextItem,
            extraRollOptions: flagData.options ?? [],
        });
        const nativeNpcSaveDC = contextualNpcStatistic?.dc?.value;
        const npcSaveDC = typeof nativeNpcSaveDC === "number" ? getSaveDC(nativeNpcSaveDC - 10) : undefined;
        const casterModifiers = contextualCasterStatistic?.check?.modifiers;
        const rawOptions = contextualCasterStatistic?.check.createRollOptions({
            target: npcActor,
            item: contextItem,
            extraRollOptions: flagData.options ?? [],
        });
        if (!pf2e?.Check?.roll || !pf2e.CheckModifier || typeof npcSaveDC !== "number" || !Number.isFinite(npcSaveDC) || !Array.isArray(casterModifiers) || !(rawOptions instanceof Set)) return;

        const release = reserveTokenRoll(message, targetUuid);
        if (!release) return;
        releases.push(release);

        let callbackHandled = false;
        const callback: Sf2eRollCallback = (roll, success, msg) => {
            if (callbackHandled) return;
            callbackHandled = true;
            try {
                const data = extractRollCallbackData(roll, msg);
                const result = buildOvercomeResult(
                    data,
                    success as DegreeOfSuccessString,
                    saveStatistic,
                    npcSaveDC,
                );
                const normalized = normalizeSaveResult({ ...result, targetUuid, generation, revision }, saveStatistic);
                if (normalized) updates[target.id] = normalized;
                else console.error(`${MODULE_ID} | PRAD Overcome: Native roll returned invalid data`);
            } catch (error) {
                console.error(`${MODULE_ID} | PRAD Overcome: Error processing roll`, error);
            }
        };

        try {
            const label = `${npcActor.name}: ${saveStatistic}`;
            const check = new pf2e.CheckModifier(label, { modifiers: casterModifiers }, []);
            await pf2e.Check.roll(check, {
                actor: casterActor,
                token: casterToken,
                type: "check",
                title: label,
                dc: { value: npcSaveDC, label },
                identifier,
                origin: {
                    actor: casterActor,
                    token: casterToken,
                    statistic: contextualCasterStatistic,
                    self: true,
                    item: rollItem,
                    modifiers: [],
                },
                target: {
                    actor: npcActor,
                    token: exactTarget,
                    statistic: contextualNpcStatistic,
                    self: false,
                    item: null,
                    distance: null,
                    rangeIncrement: null,
                },
                ...(rollItem ? { item: rollItem } : {}),
                options: rawOptions,
                skipDialog,
                createMessage: true,
            }, event, callback);
        } catch (error) {
            console.error(`${MODULE_ID} | PRAD Overcome: Error rolling check`, error);
        }
    });

    await Promise.allSettled(rollPromises);
    try {
        return await persistSaveUpdates(message, updates);
    } finally {
        for (const release of releases) release();
    }
}

/**
 * Roll Overcome for all NPC targets that haven't been rolled yet.
 */
export async function rollOvercomeAll(
    event: MouseEvent,
    message: ChatMessage.Implementation,
): Promise<boolean> {
    const flagData = getFlagData(message);
    if (!flagData?.save) return false;

    const existingSaves = flagData.saves ?? {};

    // Resolve tokens into plain data for the pure filter
    const tokenData: Array<{ token: Sf2eTokenDocument; filterData: { id: string; hasActor: boolean } }> = [];
    for (const uuid of flagData.targets) {
        const token = resolveUuidSync<Sf2eTokenDocument>(uuid);
        tokenData.push({
            token: token!,
            filterData: { id: token?.id ?? "", hasActor: !!token?.actor },
        });
    }

    const eligible = filterUnrolledTargets(
        tokenData.map((t) => t.filterData),
        existingSaves,
    );

    const eligibleIds = new Set(eligible.map((t) => t.id));
    const unrolledTargets = tokenData
        .filter((t) => eligibleIds.has(t.filterData.id))
        .map((t) => t.token);

    if (unrolledTargets.length === 0) return false;

    return rollOvercomeForTargets(event, message, unrolledTargets);
}

/**
 * Roll Overcome for the currently active PC's token(s) in the target list.
 */
export async function rollOvercomeForActiveTokens(
    event: MouseEvent,
    message: ChatMessage.Implementation,
): Promise<boolean> {
    const flagData = getFlagData(message);
    if (!flagData?.save || !flagData.pradOvercome) return false;

    return rollOvercomeAll(event, message);
}

// ─── Overcome Utility Functions ──────────────────────────────────────────────

/**
 * Find the caster's best spellcasting or class DC statistic for rolling
 * an overcome check. Uses the pure `selectBestStatistic` for the selection
 * decision, with Foundry resolution in this shell.
 */
function findBestOvercomeStatistic(caster: Sf2eActor): Sf2eStatistic | null {
    // Collect candidates from spellcasting entries
    const candidates: StatisticCandidate[] = [];

    const spellcasting = caster.spellcasting?.contents;
    if (spellcasting) {
        for (const entry of spellcasting) {
            const stat = entry.statistic;
            if (stat) {
                candidates.push({
                    checkMod: stat.check?.mod ?? null,
                    hasRoll: !!stat.check?.roll,
                    ref: stat,
                });
            }
        }
    }

    // Select best from spellcasting
    const best = selectBestStatistic(candidates);
    if (best) return best.ref as Sf2eStatistic;

    // Fallback: class DC
    const classDC = caster.classDC;
    if (classDC?.check?.roll) return classDC;

    // Fallback: getStatistic API
    if (typeof caster.getStatistic === "function") {
        const stat =
            caster.getStatistic("class-dc") ??
            caster.getStatistic("spell-attack");
        if (stat?.check?.roll) return stat;
    }

    return null;
}

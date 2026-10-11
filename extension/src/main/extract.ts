import { PROTOCOL_VERSION, type Degree, type DefenseKind, type Observation } from "../shared/protocol.js";

export interface RuntimeIdentity {
    foundryGeneration: number;
    systemId: string;
    systemVersion: string;
}

type UnknownObject = Record<string, unknown>;
type CheckRoll = Extract<Observation, { type: "check-roll" }>;
type CheckPayload = CheckRoll["payload"];
type TokenSnapshot = Extract<Observation, { type: "token-snapshot" }>;

const ID_MAX_LENGTH = 512;
const NAME_MAX_LENGTH = 200;
const REASON_VALUE_MAX_LENGTH = 40;
const SUPPORTED_GENERATION = 14;
const SUPPORTED_SYSTEM = "pf2e";
const SUPPORTED_VERSION = /^8\.5(\.|$)/;
const DEGREES: readonly Degree[] = ["criticalFailure", "failure", "success", "criticalSuccess"];
const SAVE_STATISTICS = ["fortitude", "reflex", "will"] as const;
const SNAPSHOT_STATISTICS = ["fortitude", "reflex", "will", "perception"] as const;
const CONTEXT_OPTION_PREFIX = "target:condition:";
const CONTEXT_OPTION_MAX_LENGTH = 100;
const CONTEXT_MAX_OPTIONS = 10;
const BASE_CONTEXT = "base";
const SESSION = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

let eventCounter = 0;

// Foundry documents and rolls are class instances, so only reject primitives here.
function asObject(value: unknown): UnknownObject | null {
    return typeof value === "object" && value !== null ? value as UnknownObject : null;
}

function isId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= ID_MAX_LENGTH;
}

function isDegree(value: unknown): value is Degree {
    return typeof value === "string" && (DEGREES as readonly string[]).includes(value);
}

function safeInteger(value: unknown): number | undefined {
    return Number.isSafeInteger(value) ? value as number : undefined;
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export function nextEventId(prefix: string, subject?: string): string {
    eventCounter += 1;
    const id = `${prefix}:${SESSION}:${eventCounter}`;
    return subject === undefined ? id : `${id}:${subject}`.slice(0, ID_MAX_LENGTH);
}

export function compatibilityOf(identity: RuntimeIdentity): {
    status: "active" | "unsupported";
    reason?: string;
} {
    const describe = (value: unknown): string => truncate(String(value), REASON_VALUE_MAX_LENGTH);
    if (identity.foundryGeneration !== SUPPORTED_GENERATION) {
        return { status: "unsupported", reason: `Foundry ${describe(identity.foundryGeneration)} is not Foundry 14` };
    }
    if (identity.systemId !== SUPPORTED_SYSTEM) {
        return { status: "unsupported", reason: `System ${describe(identity.systemId)} is not pf2e` };
    }
    if (!SUPPORTED_VERSION.test(identity.systemVersion)) {
        return { status: "unsupported", reason: `PF2e ${describe(identity.systemVersion)} is not PF2e 8.5` };
    }
    return { status: "active" };
}

function naturalOf(roll: UnknownObject): number | null {
    const dice = roll.dice;
    if (!Array.isArray(dice)) return null;
    for (const entry of dice) {
        const die = asObject(entry);
        if (die?.faces !== 20 || !Array.isArray(die.results)) continue;
        const active = die.results.map(asObject).find((result) => result !== null && result.active !== false);
        const natural = active?.result;
        return Number.isInteger(natural) && (natural as number) >= 1 && (natural as number) <= 20
            ? natural as number
            : null;
    }
    return null;
}

function contextKeyOf(options: unknown): string {
    const conditions = [...new Set(stringArray(options))]
        .filter((option) => option.startsWith(CONTEXT_OPTION_PREFIX) && option.length <= CONTEXT_OPTION_MAX_LENGTH)
        .sort();
    const kept: string[] = [];
    let length = 0;
    for (const condition of conditions) {
        if (kept.length >= CONTEXT_MAX_OPTIONS) break;
        const nextLength = length + (kept.length > 0 ? 1 : 0) + condition.length;
        if (nextLength > ID_MAX_LENGTH) break;
        kept.push(condition);
        length = nextLength;
    }
    return kept.length > 0 ? kept.join("|") : BASE_CONTEXT;
}

function outcomeOf(context: UnknownObject): Pick<CheckPayload, "outcome" | "degreeAdjustment"> {
    if (isDegree(context.unadjustedOutcome)) return { outcome: context.unadjustedOutcome, degreeAdjustment: 0 };
    return { outcome: isDegree(context.outcome) ? context.outcome : null, degreeAdjustment: null };
}

function saveStatisticOf(context: UnknownObject): DefenseKind | null {
    const domains = stringArray(context.domains);
    const matches = SAVE_STATISTICS.filter((statistic) => domains.includes(statistic));
    return matches.length === 1 ? matches[0]! : null;
}

function rollerTokenUuidOf(message: UnknownObject): string | undefined {
    const speaker = asObject(message.speaker);
    const scene = speaker?.scene;
    const token = speaker?.token;
    if (typeof scene !== "string" || typeof token !== "string" || scene === "" || token === "") return undefined;
    const uuid = `Scene.${scene}.Token.${token}`;
    return isId(uuid) ? uuid : undefined;
}

export function extractCheck(message: unknown): CheckRoll | null {
    const source = asObject(message);
    if (source === null || !isId(source.id)) return null;
    const context = asObject(asObject(asObject(source.flags)?.pf2e)?.context);
    if (context === null) return null;

    const roll = Array.isArray(source.rolls) ? asObject(source.rolls[0]) : null;
    if (roll === null) return null;
    const total = safeInteger(roll.total);
    const natural = naturalOf(roll);
    if (total === undefined || natural === null) return null;

    const rawTarget = asObject(context.target)?.token;
    const targetTokenUuid = isId(rawTarget) ? rawTarget : null;
    const exactDc = safeInteger(asObject(context.dc)?.value);
    const { outcome, degreeAdjustment } = outcomeOf(context);

    let checkType: CheckPayload["checkType"];
    let statistic: DefenseKind;
    let rollerTokenUuid: string | undefined;
    switch (context.type) {
        case "attack-roll":
            if (targetTokenUuid === null || (outcome === null && exactDc === undefined)) return null;
            checkType = "attack";
            statistic = "ac";
            break;
        case "saving-throw": {
            const save = saveStatisticOf(context);
            if (save === null) return null;
            checkType = "save";
            statistic = save;
            rollerTokenUuid = rollerTokenUuidOf(source);
            break;
        }
        case "perception-check":
            checkType = "perception";
            statistic = "perception";
            rollerTokenUuid = rollerTokenUuidOf(source);
            break;
        default:
            return null;
    }

    const payload: CheckPayload = {
        checkType,
        statistic,
        total,
        natural,
        outcome,
        degreeAdjustment,
        targetTokenUuid,
        contextKey: contextKeyOf(context.options),
    };
    if (rollerTokenUuid !== undefined) payload.rollerTokenUuid = rollerTokenUuid;
    if (exactDc !== undefined) payload.exactDc = exactDc;

    const timestamp = source.timestamp;
    return {
        protocol: PROTOCOL_VERSION,
        eventId: `chat:${source.id}`.slice(0, ID_MAX_LENGTH),
        timestamp: typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp >= 0
            ? timestamp
            : Date.now(),
        type: "check-roll",
        payload,
    };
}

function statisticModifier(actor: UnknownObject, slug: string): number | undefined {
    if (typeof actor.getStatistic !== "function") return undefined;
    let statistic: UnknownObject | null;
    try {
        statistic = asObject((actor.getStatistic as (slug: string) => unknown).call(actor, slug));
    } catch {
        return undefined;
    }
    if (statistic === null) return undefined;
    const check = asObject(statistic.check);
    return safeInteger(check?.mod) ?? safeInteger(statistic.mod);
}

function defensesOf(actor: UnknownObject | null): Partial<Record<DefenseKind, number>> {
    const defenses: Partial<Record<DefenseKind, number>> = {};
    if (actor === null) return defenses;
    const ac = safeInteger(asObject(actor.armorClass)?.value)
        ?? safeInteger(asObject(asObject(asObject(actor.system)?.attributes)?.ac)?.value);
    if (ac !== undefined) defenses.ac = ac;
    for (const slug of SNAPSHOT_STATISTICS) {
        const modifier = statisticModifier(actor, slug);
        if (modifier !== undefined) defenses[slug] = modifier;
    }
    return defenses;
}

export function snapshotToken(token: unknown): TokenSnapshot | null {
    const placeable = asObject(token);
    const document = asObject(placeable?.document);
    if (placeable === null || document === null || !isId(document.uuid)) return null;
    const rawName = typeof document.name === "string" && document.name !== "" ? document.name : placeable.name;
    const name = typeof rawName === "string" && rawName !== "" ? truncate(rawName, NAME_MAX_LENGTH) : "Unknown token";
    const actor = asObject(placeable.actor);
    const actorUuid = isId(actor?.uuid) ? actor.uuid as string : null;
    return {
        protocol: PROTOCOL_VERSION,
        eventId: nextEventId("snapshot", document.uuid),
        timestamp: Date.now(),
        type: "token-snapshot",
        payload: { tokenUuid: document.uuid, actorUuid, name, defenses: defensesOf(actor) },
    };
}

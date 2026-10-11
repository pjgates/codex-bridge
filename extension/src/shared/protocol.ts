export const PROTOCOL_VERSION = 1 as const;
export const OBSERVATION_EVENT = "pf2e-combat-notebook:observation";
export const COMMAND_EVENT = "pf2e-combat-notebook:command";

export type Degree = "criticalFailure" | "failure" | "success" | "criticalSuccess";
export type DefenseKind = "ac" | "fortitude" | "reflex" | "will" | "perception";
export type CompatibilityStatus = "active" | "fallback" | "unsupported";

export interface Envelope<TType extends string, TPayload> {
    protocol: typeof PROTOCOL_VERSION;
    eventId: string;
    timestamp: number;
    type: TType;
    payload: TPayload;
}

export type Observation =
    | Envelope<"handshake", {
        status: CompatibilityStatus;
        foundry: string;
        system: string;
        systemVersion: string;
        worldId: string;
        userId: string;
        reason?: string;
    }>
    | Envelope<"scope", { sceneId: string; combatId: string | null }>
    | Envelope<"target", { tokenUuid: string | null }>
    | Envelope<"token-snapshot", {
        tokenUuid: string;
        actorUuid: string | null;
        name: string;
        defenses: Partial<Record<DefenseKind, number>>;
    }>
    | Envelope<"check-roll", {
        checkType: "attack" | "save" | "perception";
        statistic: DefenseKind;
        total: number;
        natural: number;
        outcome: Degree | null;
        degreeAdjustment: number | null;
        targetTokenUuid: string | null;
        rollerTokenUuid?: string;
        exactDc?: number;
        contextKey: string;
    }>
    | Envelope<"unassigned-check", {
        messageId: string;
        total: number;
        outcome: Degree | null;
    }>;

export type PageCommand =
    | {
        protocol: typeof PROTOCOL_VERSION;
        type: "render-overlay";
        payload: { tokenUuid: string; name: string; ac: string; health?: string };
    }
    | {
        protocol: typeof PROTOCOL_VERSION;
        type: "activate" | "clear-overlay" | "teardown";
        payload: Record<string, never>;
    };

type ObservationType = Observation["type"];
type PageCommandType = PageCommand["type"];
type CheckType = Extract<Observation, { type: "check-roll" }>["payload"]["checkType"];
type UnknownRecord = Record<string, unknown>;

const ID_MAX_LENGTH = 512;
const TEXT_MAX_LENGTH = 200;

const OBSERVATION_TYPES: readonly ObservationType[] = [
    "handshake",
    "scope",
    "target",
    "token-snapshot",
    "check-roll",
    "unassigned-check",
];
const COMMAND_TYPES: readonly PageCommandType[] = [
    "render-overlay",
    "activate",
    "clear-overlay",
    "teardown",
];
const DEGREES: readonly Degree[] = ["criticalFailure", "failure", "success", "criticalSuccess"];
const DEFENSE_KINDS: readonly DefenseKind[] = ["ac", "fortitude", "reflex", "will", "perception"];
const COMPATIBILITY_STATUSES: readonly CompatibilityStatus[] = ["active", "fallback", "unsupported"];
const CHECK_TYPES: readonly CheckType[] = ["attack", "save", "perception"];

function isRecord(value: unknown): value is UnknownRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isId(value: unknown): value is string {
    return isBoundedString(value, ID_MAX_LENGTH);
}

function isText(value: unknown): value is string {
    return isBoundedString(value, TEXT_MAX_LENGTH);
}

function isNullableId(value: unknown): value is string | null {
    return value === null || isId(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value);
}

function isNatural(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 20;
}

function isDegreeAdjustment(value: unknown): value is number | null {
    return value === null || (Number.isInteger(value) && (value as number) >= -3 && (value as number) <= 3);
}

function isNullableDegree(value: unknown): value is Degree | null {
    return value === null || isOneOf(value, DEGREES);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function parseDefenses(value: unknown): Partial<Record<DefenseKind, number>> | null {
    if (!isRecord(value)) return null;
    const defenses: Partial<Record<DefenseKind, number>> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!isOneOf(key, DEFENSE_KINDS) || !isSafeInteger(entry)) return null;
        defenses[key] = entry;
    }
    return defenses;
}

function envelope<TType extends ObservationType, TPayload>(
    source: UnknownRecord,
    type: TType,
    payload: TPayload,
): Envelope<TType, TPayload> {
    return {
        protocol: PROTOCOL_VERSION,
        eventId: source.eventId as string,
        timestamp: source.timestamp as number,
        type,
        payload,
    };
}

export function parseObservation(value: unknown): Observation | null {
    if (!isRecord(value)) return null;
    if (value.protocol !== PROTOCOL_VERSION) return null;
    if (!isId(value.eventId)) return null;
    if (!isFiniteNumber(value.timestamp) || value.timestamp < 0) return null;
    if (!isOneOf(value.type, OBSERVATION_TYPES)) return null;
    const payload = value.payload;
    if (!isRecord(payload)) return null;

    const type: ObservationType = value.type;
    switch (type) {
        case "handshake": {
            if (
                !isOneOf(payload.status, COMPATIBILITY_STATUSES)
                || !isId(payload.foundry)
                || !isId(payload.system)
                || !isId(payload.systemVersion)
                || !isId(payload.worldId)
                || !isId(payload.userId)
            ) return null;
            const parsed: Extract<Observation, { type: "handshake" }>["payload"] = {
                status: payload.status,
                foundry: payload.foundry,
                system: payload.system,
                systemVersion: payload.systemVersion,
                worldId: payload.worldId,
                userId: payload.userId,
            };
            if (hasOwn(payload, "reason")) {
                if (!isText(payload.reason)) return null;
                parsed.reason = payload.reason;
            }
            return envelope(value, type, parsed);
        }
        case "scope": {
            if (!isId(payload.sceneId) || !isNullableId(payload.combatId)) return null;
            return envelope(value, type, { sceneId: payload.sceneId, combatId: payload.combatId });
        }
        case "target": {
            if (!isNullableId(payload.tokenUuid)) return null;
            return envelope(value, type, { tokenUuid: payload.tokenUuid });
        }
        case "token-snapshot": {
            const defenses = parseDefenses(payload.defenses);
            if (
                !isId(payload.tokenUuid)
                || !isNullableId(payload.actorUuid)
                || !isText(payload.name)
                || defenses === null
            ) return null;
            return envelope(value, type, {
                tokenUuid: payload.tokenUuid,
                actorUuid: payload.actorUuid,
                name: payload.name,
                defenses,
            });
        }
        case "check-roll": {
            if (
                !isOneOf(payload.checkType, CHECK_TYPES)
                || !isOneOf(payload.statistic, DEFENSE_KINDS)
                || !isSafeInteger(payload.total)
                || !isNatural(payload.natural)
                || !isNullableDegree(payload.outcome)
                || !isDegreeAdjustment(payload.degreeAdjustment)
                || !isNullableId(payload.targetTokenUuid)
                || !isId(payload.contextKey)
            ) return null;
            const parsed: Extract<Observation, { type: "check-roll" }>["payload"] = {
                checkType: payload.checkType,
                statistic: payload.statistic,
                total: payload.total,
                natural: payload.natural,
                outcome: payload.outcome,
                degreeAdjustment: payload.degreeAdjustment,
                targetTokenUuid: payload.targetTokenUuid,
                contextKey: payload.contextKey,
            };
            if (hasOwn(payload, "rollerTokenUuid")) {
                if (!isId(payload.rollerTokenUuid)) return null;
                parsed.rollerTokenUuid = payload.rollerTokenUuid;
            }
            if (hasOwn(payload, "exactDc")) {
                if (!isSafeInteger(payload.exactDc)) return null;
                parsed.exactDc = payload.exactDc;
            }
            return envelope(value, type, parsed);
        }
        case "unassigned-check": {
            if (
                !isId(payload.messageId)
                || !isSafeInteger(payload.total)
                || !isNullableDegree(payload.outcome)
            ) return null;
            return envelope(value, type, {
                messageId: payload.messageId,
                total: payload.total,
                outcome: payload.outcome,
            });
        }
        default: {
            const exhaustive: never = type;
            return exhaustive;
        }
    }
}

export function parsePageCommand(value: unknown): PageCommand | null {
    if (!isRecord(value)) return null;
    if (value.protocol !== PROTOCOL_VERSION) return null;
    if (!isOneOf(value.type, COMMAND_TYPES)) return null;
    const payload = value.payload;
    if (!isRecord(payload)) return null;

    const type: PageCommandType = value.type;
    switch (type) {
        case "render-overlay": {
            if (!isId(payload.tokenUuid) || !isText(payload.name) || !isText(payload.ac)) return null;
            const parsed: Extract<PageCommand, { type: "render-overlay" }>["payload"] = {
                tokenUuid: payload.tokenUuid,
                name: payload.name,
                ac: payload.ac,
            };
            if (hasOwn(payload, "health")) {
                if (!isText(payload.health)) return null;
                parsed.health = payload.health;
            }
            return { protocol: PROTOCOL_VERSION, type, payload: parsed };
        }
        case "activate":
        case "clear-overlay":
        case "teardown": {
            if (Object.keys(payload).length > 0) return null;
            return { protocol: PROTOCOL_VERSION, type, payload: {} };
        }
        default: {
            const exhaustive: never = type;
            return exhaustive;
        }
    }
}

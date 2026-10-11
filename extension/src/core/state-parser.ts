import type { CandidateSet, IntegerRange } from "./defense.js";
import {
    MAX_CREATURE_ENTRIES,
    MAX_DIAGNOSTICS,
    MAX_SEEN_EVENT_IDS,
} from "./types.js";
import type { CreatureRecord, DefenseFact, Evidence, NotebookState, Provenance } from "./types.js";
import type { CompatibilityStatus, DefenseKind } from "../shared/protocol.js";

type UnknownRecord = Record<string, unknown>;

const ID_MAX_LENGTH = 512;
const SCOPE_ID_MAX_LENGTH = ID_MAX_LENGTH * 2 + 1;
const TEXT_MAX_LENGTH = 2_000;
const MAX_CANDIDATE_RANGES = 8;

const PROVENANCES: readonly Provenance[] = ["exact-client", "observed", "inferred", "possible"];
const CERTAINTIES: readonly CandidateSet["certainty"][] = ["inferred", "possible"];
const DEFENSE_KINDS: readonly DefenseKind[] = ["ac", "fortitude", "reflex", "will", "perception"];
const COMPATIBILITY_STATUSES: readonly CompatibilityStatus[] = ["active", "fallback", "unsupported"];

const STATE_KEYS = [
    "compatibility",
    "compatibilityReason",
    "worldId",
    "userId",
    "sceneId",
    "combatId",
    "scopeId",
    "selectedTokenUuid",
    "creatures",
    "seenEventIds",
    "diagnostics",
];
const CREATURE_KEYS = ["tokenUuid", "actorUuid", "name", "defenses", "evidence", "contradictions"];
const FACT_KEYS = ["display", "provenance", "contextKey", "evidenceIds"];
const EVIDENCE_KEYS = ["id", "timestamp", "summary"];

function isRecord(value: unknown): value is UnknownRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: UnknownRecord, required: readonly string[], optional: readonly string[] = []): boolean {
    const keys = Object.keys(record);
    return required.every((key) => Object.hasOwn(record, key))
        && keys.every((key) => required.includes(key) || optional.includes(key));
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

function parseList<T>(value: unknown, limit: number, parseItem: (item: unknown) => T | null): T[] | null {
    if (!Array.isArray(value) || value.length > limit) return null;
    const parsed: T[] = [];
    for (const item of value) {
        const entry = parseItem(item);
        if (entry === null) return null;
        parsed.push(entry);
    }
    return parsed;
}

function parseBound(value: unknown): number | null | undefined {
    if (value === null) return null;
    return Number.isSafeInteger(value) ? value as number : undefined;
}

function parseRange(value: unknown): IntegerRange | null {
    if (!isRecord(value) || !hasExactKeys(value, ["min", "max"])) return null;
    const min = parseBound(value.min);
    const max = parseBound(value.max);
    if (min === undefined || max === undefined) return null;
    if (min !== null && max !== null && min > max) return null;
    return { min, max };
}

function parseCandidates(value: unknown): CandidateSet | null {
    if (!isRecord(value) || !hasExactKeys(value, ["ranges", "certainty"])) return null;
    if (!isOneOf(value.certainty, CERTAINTIES)) return null;
    const ranges = parseList(value.ranges, MAX_CANDIDATE_RANGES, parseRange);
    if (ranges === null || ranges.length === 0) return null;
    return { ranges, certainty: value.certainty };
}

function parseFact(value: unknown): DefenseFact | null {
    if (!isRecord(value) || !hasExactKeys(value, FACT_KEYS, ["candidates"])) return null;
    if (!isText(value.display) || !isOneOf(value.provenance, PROVENANCES) || !isId(value.contextKey)) return null;
    const evidenceIds = parseList(value.evidenceIds, MAX_CREATURE_ENTRIES, (id) => isId(id) ? id : null);
    if (evidenceIds === null) return null;
    const fact: DefenseFact = {
        display: value.display,
        provenance: value.provenance,
        contextKey: value.contextKey,
        evidenceIds,
    };
    if (Object.hasOwn(value, "candidates")) {
        const candidates = parseCandidates(value.candidates);
        if (candidates === null) return null;
        fact.candidates = candidates;
    }
    return fact;
}

function parseEvidence(value: unknown): Evidence | null {
    if (!isRecord(value) || !hasExactKeys(value, EVIDENCE_KEYS)) return null;
    if (!isId(value.id) || !isText(value.summary)) return null;
    if (typeof value.timestamp !== "number" || !Number.isFinite(value.timestamp) || value.timestamp < 0) return null;
    return { id: value.id, timestamp: value.timestamp, summary: value.summary };
}

function parseDefenses(value: unknown): CreatureRecord["defenses"] | null {
    if (!isRecord(value)) return null;
    const defenses: CreatureRecord["defenses"] = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!isOneOf(key, DEFENSE_KINDS)) return null;
        const fact = parseFact(entry);
        if (fact === null) return null;
        defenses[key] = fact;
    }
    return defenses;
}

function parseCreature(key: string, value: unknown): CreatureRecord | null {
    if (!isRecord(value) || !hasExactKeys(value, CREATURE_KEYS)) return null;
    if (value.tokenUuid !== key || !isId(value.tokenUuid)) return null;
    if (!isNullableId(value.actorUuid) || !isText(value.name)) return null;
    const defenses = parseDefenses(value.defenses);
    const evidence = parseList(value.evidence, MAX_CREATURE_ENTRIES, parseEvidence);
    const contradictions = parseList(value.contradictions, MAX_CREATURE_ENTRIES, parseEvidence);
    if (defenses === null || evidence === null || contradictions === null) return null;
    return {
        tokenUuid: value.tokenUuid,
        actorUuid: value.actorUuid,
        name: value.name,
        defenses,
        evidence,
        contradictions,
    };
}

function parseCreatures(value: unknown): Record<string, CreatureRecord> | null {
    if (!isRecord(value)) return null;
    const creatures: Record<string, CreatureRecord> = {};
    for (const [key, entry] of Object.entries(value)) {
        const creature = parseCreature(key, entry);
        if (creature === null) return null;
        Object.defineProperty(creatures, key, { value: creature, enumerable: true, writable: true, configurable: true });
    }
    return creatures;
}

export function parseNotebookState(value: unknown): NotebookState | null {
    if (!isRecord(value) || !hasExactKeys(value, STATE_KEYS)) return null;
    if (!isOneOf(value.compatibility, COMPATIBILITY_STATUSES)) return null;
    if (value.compatibilityReason !== null && !isText(value.compatibilityReason)) return null;
    if (
        !isNullableId(value.worldId)
        || !isNullableId(value.userId)
        || !isNullableId(value.sceneId)
        || !isNullableId(value.combatId)
        || (value.scopeId !== null && !isBoundedString(value.scopeId, SCOPE_ID_MAX_LENGTH))
        || !isNullableId(value.selectedTokenUuid)
    ) return null;
    const creatures = parseCreatures(value.creatures);
    const seenEventIds = parseList(value.seenEventIds, MAX_SEEN_EVENT_IDS, (id) => isId(id) ? id : null);
    const diagnostics = parseList(value.diagnostics, MAX_DIAGNOSTICS, (text) => isText(text) ? text : null);
    if (creatures === null || seenEventIds === null || diagnostics === null) return null;
    return {
        compatibility: value.compatibility,
        compatibilityReason: value.compatibilityReason,
        worldId: value.worldId,
        userId: value.userId,
        sceneId: value.sceneId,
        combatId: value.combatId,
        scopeId: value.scopeId,
        selectedTokenUuid: value.selectedTokenUuid,
        creatures,
        seenEventIds,
        diagnostics,
    };
}

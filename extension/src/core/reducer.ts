import { defenseCandidates, formatCandidates, intersectCandidates } from "./defense.js";
import type { CandidateSet } from "./defense.js";
import { parseNotebookState } from "./state-parser.js";
import {
    MAX_CREATURE_ENTRIES,
    MAX_DIAGNOSTICS,
    MAX_SEEN_EVENT_IDS,
} from "./types.js";
import type { CreatureRecord, DefenseFact, Evidence, NotebookState } from "./types.js";
import type { DefenseKind, Observation, PageCommand } from "../shared/protocol.js";

export { parseNotebookState } from "./state-parser.js";

export const STORED_STATE_INVALID_DIAGNOSTIC = "Stored encounter data was invalid and was reset.";

const AWAITING_HANDSHAKE_REASON = "Waiting for the Foundry adapter handshake.";
const UNKNOWN_CREATURE = "Unknown creature";
const BASE_CONTEXT = "base";

type CheckRoll = Extract<Observation, { type: "check-roll" }>;

const DEFENSE_LABELS: Record<DefenseKind, string> = {
    ac: "AC",
    fortitude: "Fortitude",
    reflex: "Reflex",
    will: "Will",
    perception: "Perception",
};

export function emptyNotebook(): NotebookState {
    return {
        compatibility: "unsupported",
        compatibilityReason: AWAITING_HANDSHAKE_REASON,
        worldId: null,
        userId: null,
        sceneId: null,
        combatId: null,
        scopeId: null,
        selectedTokenUuid: null,
        creatures: {},
        seenEventIds: [],
        diagnostics: [],
    };
}

export function restoreNotebookState(value: unknown): NotebookState {
    return parseNotebookState(value) ?? {
        ...emptyNotebook(),
        diagnostics: [STORED_STATE_INVALID_DIAGNOSTIC],
    };
}

function appendBounded<T>(list: readonly T[], entry: T, limit: number): T[] {
    const next = [...list, entry];
    return next.length > limit ? next.slice(next.length - limit) : next;
}

export function withDiagnostic(state: NotebookState, message: string): NotebookState {
    return { ...state, diagnostics: appendBounded(state.diagnostics, message, MAX_DIAGNOSTICS) };
}

function evidenceFor(observation: Observation, summary: string): Evidence {
    return { id: observation.eventId, timestamp: observation.timestamp, summary };
}

function unknownCreature(tokenUuid: string): CreatureRecord {
    return {
        tokenUuid,
        actorUuid: null,
        name: UNKNOWN_CREATURE,
        defenses: {},
        evidence: [],
        contradictions: [],
    };
}

function creatureAt(state: NotebookState, tokenUuid: string): CreatureRecord | undefined {
    return Object.hasOwn(state.creatures, tokenUuid) ? state.creatures[tokenUuid] : undefined;
}

function updateCreature(
    state: NotebookState,
    tokenUuid: string,
    update: (record: CreatureRecord) => CreatureRecord,
): NotebookState {
    const record = creatureAt(state, tokenUuid) ?? unknownCreature(tokenUuid);
    return { ...state, creatures: { ...state.creatures, [tokenUuid]: update(record) } };
}

function addEvidence(record: CreatureRecord, evidence: Evidence): CreatureRecord {
    return { ...record, evidence: appendBounded(record.evidence, evidence, MAX_CREATURE_ENTRIES) };
}

function addContradiction(record: CreatureRecord, evidence: Evidence): CreatureRecord {
    return {
        ...record,
        contradictions: appendBounded(record.contradictions, evidence, MAX_CREATURE_ENTRIES),
    };
}

function setDefense(record: CreatureRecord, kind: DefenseKind, fact: DefenseFact): CreatureRecord {
    return { ...record, defenses: { ...record.defenses, [kind]: fact } };
}

function signed(value: number): string {
    return value >= 0 ? `+${value}` : String(value);
}

function exactDisplay(kind: DefenseKind, value: number): string {
    return kind === "ac" ? String(value) : signed(value);
}

function exactFact(
    kind: DefenseKind,
    value: number,
    contextKey: string,
    previous: DefenseFact | undefined,
    id: string,
): DefenseFact {
    const display = exactDisplay(kind, value);
    const evidenceIds = previous?.provenance === "exact-client" && previous.display === display
        ? appendBounded(previous.evidenceIds, id, MAX_CREATURE_ENTRIES)
        : [id];
    return { display, provenance: "exact-client", contextKey, evidenceIds };
}

function candidateFact(candidates: CandidateSet, evidenceIds: string[]): DefenseFact {
    return {
        display: formatCandidates(candidates),
        provenance: candidates.certainty,
        candidates,
        contextKey: BASE_CONTEXT,
        evidenceIds,
    };
}

function containsValue(candidates: CandidateSet, value: number): boolean {
    return candidates.ranges.some((range) =>
        (range.min === null || value >= range.min) && (range.max === null || value <= range.max));
}

function isUnchangedSnapshot(
    record: CreatureRecord | undefined,
    payload: Extract<Observation, { type: "token-snapshot" }>["payload"],
): boolean {
    if (!record || record.name !== payload.name || record.actorUuid !== payload.actorUuid) return false;
    return Object.entries(payload.defenses).every(([kind, value]) => {
        const fact = record.defenses[kind as DefenseKind];
        return fact?.provenance === "exact-client" && fact.display === exactDisplay(kind as DefenseKind, value);
    });
}

function applySnapshot(
    state: NotebookState,
    observation: Extract<Observation, { type: "token-snapshot" }>,
): NotebookState {
    const { tokenUuid, actorUuid, name, defenses } = observation.payload;
    if (isUnchangedSnapshot(creatureAt(state, tokenUuid), observation.payload)) return state;
    const entries = Object.entries(defenses) as [DefenseKind, number][];
    const described = entries.map(([kind, value]) => `${DEFENSE_LABELS[kind]} ${exactDisplay(kind, value)}`).join(", ");
    const summary = described
        ? `Snapshot: ${described} (exact client data)`
        : "Snapshot: no defenses visible (exact client data)";
    return updateCreature(state, tokenUuid, (record) => {
        let next: CreatureRecord = { ...record, actorUuid, name };
        for (const [kind, value] of entries) {
            next = setDefense(next, kind, exactFact(kind, value, BASE_CONTEXT, next.defenses[kind], observation.eventId));
        }
        return addEvidence(next, evidenceFor(observation, summary));
    });
}

function applyAttack(state: NotebookState, observation: CheckRoll): NotebookState {
    const { statistic, total, natural, outcome, degreeAdjustment, targetTokenUuid, exactDc, contextKey } =
        observation.payload;
    if (statistic !== "ac") {
        return withDiagnostic(state, `Attack ${total} against ${DEFENSE_LABELS[statistic]} was not recorded.`);
    }
    if (targetTokenUuid === null) {
        return withDiagnostic(state, `Attack ${total} had no reliable target and was not recorded.`);
    }
    const label = DEFENSE_LABELS[statistic];
    const roll = `Attack ${total} (natural ${natural})`;
    const id = observation.eventId;

    return updateCreature(state, targetTokenUuid, (record) => {
        const existing = record.defenses[statistic];
        const isBase = contextKey === BASE_CONTEXT;

        if (exactDc !== undefined) {
            const evidence = evidenceFor(observation, `${roll}: ${label} ${exactDc} (exact client data, ${contextKey})`);
            if (!isBase) return addEvidence(record, evidence);
            if (existing?.provenance === "exact-client" && existing.display !== String(exactDc)) {
                return addContradiction(record, evidence);
            }
            return addEvidence(setDefense(record, statistic, exactFact(statistic, exactDc, contextKey, existing, id)), evidence);
        }

        if (outcome === null) {
            return addEvidence(record, evidenceFor(observation, `${roll}: outcome not visible`));
        }

        const candidates = defenseCandidates({ total, natural, outcome, degreeAdjustment });
        const summary = `${roll}: ${outcome}`;
        if (candidates.ranges.length === 0) {
            return addContradiction(record, evidenceFor(observation, `${summary} (impossible ${label} result)`));
        }
        const evidence = evidenceFor(observation, summary);
        if (!isBase) return addEvidence(record, evidence);
        if (existing?.provenance === "exact-client") {
            if (!containsValue(candidates, Number(existing.display))) {
                return addContradiction(record, evidenceFor(observation, `${summary} (contradicts ${label} ${existing.display})`));
            }
            const supported = { ...existing, evidenceIds: appendBounded(existing.evidenceIds, id, MAX_CREATURE_ENTRIES) };
            return addEvidence(setDefense(record, statistic, supported), evidence);
        }

        const previous = existing?.candidates;
        const merged = previous ? intersectCandidates(previous, candidates) : candidates;
        if (merged === null) {
            return addContradiction(record, evidenceFor(observation, `${summary} (contradicts ${label} ${existing?.display})`));
        }
        const evidenceIds = previous && existing
            ? appendBounded(existing.evidenceIds, id, MAX_CREATURE_ENTRIES)
            : [id];
        return addEvidence(setDefense(record, statistic, candidateFact(merged, evidenceIds)), evidence);
    });
}

function applyModifierRoll(state: NotebookState, observation: CheckRoll): NotebookState {
    const { checkType, statistic, total, natural, rollerTokenUuid, contextKey } = observation.payload;
    const label = DEFENSE_LABELS[statistic];
    if (statistic === "ac") {
        return withDiagnostic(state, `${checkType} ${total} reported an AC modifier and was not recorded.`);
    }
    if (rollerTokenUuid === undefined) {
        return withDiagnostic(state, `${label} ${checkType} ${total} had no reliable roller and was not recorded.`);
    }
    const display = signed(total - natural);
    const evidence = evidenceFor(observation, `${label} ${checkType} ${total} (natural ${natural}): modifier ${display} (observed)`);
    return updateCreature(state, rollerTokenUuid, (record) => {
        const existing = record.defenses[statistic];
        if (contextKey !== BASE_CONTEXT || existing?.provenance === "exact-client") {
            return addEvidence(record, evidence);
        }
        const evidenceIds = existing?.provenance === "observed" && existing.display === display
            ? appendBounded(existing.evidenceIds, observation.eventId, MAX_CREATURE_ENTRIES)
            : [observation.eventId];
        const fact: DefenseFact = { display, provenance: "observed", contextKey, evidenceIds };
        return addEvidence(setDefense(record, statistic, fact), evidence);
    });
}

function applyScope(
    state: NotebookState,
    observation: Extract<Observation, { type: "scope" }>,
): NotebookState {
    const { sceneId, combatId } = observation.payload;
    const scopeId = `${sceneId}:${combatId ?? "exploration"}`;
    if (scopeId === state.scopeId) return { ...state, sceneId, combatId };
    return {
        ...state,
        sceneId,
        combatId,
        scopeId,
        selectedTokenUuid: null,
        creatures: {},
        seenEventIds: [],
        diagnostics: [],
    };
}

function reduce(state: NotebookState, observation: Observation): NotebookState {
    switch (observation.type) {
        case "handshake": {
            const { status, reason, worldId, userId } = observation.payload;
            return { ...state, compatibility: status, compatibilityReason: reason ?? null, worldId, userId };
        }
        case "scope":
            return applyScope(state, observation);
        case "target":
            return { ...state, selectedTokenUuid: observation.payload.tokenUuid };
        case "token-snapshot":
            return applySnapshot(state, observation);
        case "check-roll":
            return observation.payload.checkType === "attack"
                ? applyAttack(state, observation)
                : applyModifierRoll(state, observation);
        case "unassigned-check": {
            const { messageId, total, outcome } = observation.payload;
            return withDiagnostic(
                state,
                `Check ${total} (${outcome ?? "outcome not visible"}) in message ${messageId} had no target.`,
            );
        }
        default: {
            const exhaustive: never = observation;
            return exhaustive;
        }
    }
}

export function applyObservation(state: NotebookState, observation: Observation): NotebookState {
    if (state.seenEventIds.includes(observation.eventId)) return state;
    const next = reduce(state, observation);
    return {
        ...next,
        seenEventIds: appendBounded(next.seenEventIds, observation.eventId, MAX_SEEN_EVENT_IDS),
    };
}

export function currentOverlay(
    state: NotebookState,
): Extract<PageCommand, { type: "render-overlay" }>["payload"] | null {
    const tokenUuid = state.selectedTokenUuid;
    if (tokenUuid === null) return null;
    const record = creatureAt(state, tokenUuid);
    const ac = record?.defenses.ac;
    if (!record || !ac) return null;
    return { tokenUuid, name: record.name, ac: ac.display, provenance: ac.provenance };
}

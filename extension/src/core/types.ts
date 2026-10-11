import type { CandidateSet } from "./defense.js";
import type { CompatibilityStatus, DefenseKind } from "../shared/protocol.js";

export type Provenance = "exact-client" | "observed" | "inferred" | "possible";

export interface DefenseFact {
    display: string;
    provenance: Provenance;
    candidates?: CandidateSet;
    contextKey: string;
    evidenceIds: string[];
}

export interface Evidence {
    id: string;
    timestamp: number;
    summary: string;
}

export interface CreatureRecord {
    tokenUuid: string;
    actorUuid: string | null;
    name: string;
    defenses: Partial<Record<DefenseKind, DefenseFact>>;
    evidence: Evidence[];
    contradictions: Evidence[];
}

export interface NotebookState {
    compatibility: CompatibilityStatus;
    compatibilityReason: string | null;
    worldId: string | null;
    userId: string | null;
    sceneId: string | null;
    combatId: string | null;
    scopeId: string | null;
    selectedTokenUuid: string | null;
    creatures: Record<string, CreatureRecord>;
    seenEventIds: string[];
    diagnostics: string[];
}

export const MAX_SEEN_EVENT_IDS = 2_000;
export const MAX_DIAGNOSTICS = 100;
export const MAX_CREATURE_ENTRIES = 200;

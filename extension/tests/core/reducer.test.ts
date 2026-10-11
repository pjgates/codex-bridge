import { describe, expect, it } from "vitest";
import {
    applyObservation,
    currentOverlay,
    emptyNotebook,
    parseNotebookState,
    restoreNotebookState,
    STORED_STATE_INVALID_DIAGNOSTIC,
} from "../../src/core/reducer.js";
import type { NotebookState } from "../../src/core/types.js";
import type { Observation } from "../../src/shared/protocol.js";

const event = (overrides: Partial<Observation>): Observation => ({
    protocol: 1,
    eventId: crypto.randomUUID(),
    timestamp: 1,
    type: "target",
    payload: { tokenUuid: null },
    ...overrides,
} as Observation);

const TOKEN = "Scene.s.Token.t";

const snapshot = (defenses: Partial<Record<"ac" | "will", number>>, eventId?: string): Observation => event({
    ...(eventId ? { eventId } : {}),
    type: "token-snapshot",
    payload: { tokenUuid: TOKEN, actorUuid: "Actor.a", name: "Graveknight", defenses },
});

const attack = (
    total: number,
    natural: number,
    outcome: "criticalFailure" | "failure" | "success" | "criticalSuccess" | null,
    extra: Partial<Extract<Observation, { type: "check-roll" }>["payload"]> = {},
): Observation => event({
    type: "check-roll",
    payload: {
        checkType: "attack",
        statistic: "ac",
        total,
        natural,
        outcome,
        degreeAdjustment: 0,
        targetTokenUuid: TOKEN,
        contextKey: "base",
        ...extra,
    },
});

const scope = (sceneId: string, combatId: string | null): Observation => event({
    type: "scope",
    payload: { sceneId, combatId },
});

function deepFreeze<T>(value: T): T {
    if (typeof value === "object" && value !== null) {
        for (const entry of Object.values(value)) deepFreeze(entry);
        Object.freeze(value);
    }
    return value;
}

describe("notebook reducer", () => {
    it("prefers an exact snapshot and retains its evidence", () => {
        let state = emptyNotebook();
        state = applyObservation(state, event({
            type: "token-snapshot",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                actorUuid: "Actor.a",
                name: "Graveknight",
                defenses: { ac: 28 },
            },
        }));
        expect(state.creatures["Scene.s.Token.t"].defenses.ac).toMatchObject({
            display: "28",
            provenance: "exact-client",
        });
        expect(state.creatures["Scene.s.Token.t"].evidence).toHaveLength(1);
    });

    it("intersects attack evidence for the target and ignores duplicates", () => {
        let state = applyObservation(emptyNotebook(), event({
            eventId: "snapshot",
            type: "token-snapshot",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                actorUuid: null,
                name: "Unknown creature",
                defenses: {},
            },
        }));
        const attack = event({
            eventId: "attack",
            type: "check-roll",
            payload: {
                checkType: "attack",
                statistic: "ac",
                total: 27,
                natural: 12,
                outcome: "success",
                degreeAdjustment: 0,
                targetTokenUuid: "Scene.s.Token.t",
                contextKey: "base",
            },
        });
        state = applyObservation(state, attack);
        state = applyObservation(state, attack);
        expect(state.creatures["Scene.s.Token.t"].defenses.ac?.display).toBe("18–27");
        expect(state.creatures["Scene.s.Token.t"].evidence).toHaveLength(2);
    });

    it("records contradictions without replacing the previous estimate", () => {
        let state = emptyNotebook();
        for (const [eventId, total, outcome] of [
            ["one", 20, "success"],
            ["two", 40, "failure"],
        ] as const) {
            state = applyObservation(state, event({
                eventId,
                type: "check-roll",
                payload: {
                    checkType: "attack",
                    statistic: "ac",
                    total,
                    natural: 10,
                    outcome,
                    degreeAdjustment: 0,
                    targetTokenUuid: "Scene.s.Token.t",
                    contextKey: "base",
                },
            }));
        }
        expect(state.creatures["Scene.s.Token.t"].contradictions).toHaveLength(1);
    });

    it("builds the calm overlay only for the current target", () => {
        let state = emptyNotebook();
        state = applyObservation(state, event({
            type: "token-snapshot",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                actorUuid: null,
                name: "Graveknight",
                defenses: { ac: 28 },
            },
        }));
        state = applyObservation(state, event({
            type: "target",
            payload: { tokenUuid: "Scene.s.Token.t" },
        }));
        expect(currentOverlay(state)).toEqual({
            tokenUuid: "Scene.s.Token.t",
            name: "Graveknight",
            ac: "28",
        });
    });

    it("keeps the contradicted estimate and its provenance intact", () => {
        let state = applyObservation(emptyNotebook(), attack(20, 10, "success"));
        const before = state.creatures[TOKEN].defenses.ac;
        state = applyObservation(state, attack(40, 10, "failure"));
        expect(state.creatures[TOKEN].defenses.ac).toEqual(before);
        expect(state.creatures[TOKEN].name).toBe("Unknown creature");
        expect(before).toMatchObject({ display: "11–20", provenance: "inferred" });
    });

    it("never lets later attacks replace an exact snapshot", () => {
        let state = applyObservation(emptyNotebook(), snapshot({ ac: 28 }, "snap"));
        state = applyObservation(state, attack(27, 12, "success"));
        state = applyObservation(state, attack(40, 10, "failure"));
        const record = state.creatures[TOKEN];
        expect(record.defenses.ac).toEqual({
            display: "28",
            provenance: "exact-client",
            contextKey: "base",
            evidenceIds: ["snap"],
        });
        expect(record.evidence).toHaveLength(3);
        expect(record.contradictions).toHaveLength(0);
    });

    it("lets a fresh exact snapshot replace an inferred estimate", () => {
        let state = applyObservation(emptyNotebook(), attack(27, 12, "success"));
        state = applyObservation(state, snapshot({ ac: 25 }));
        expect(state.creatures[TOKEN].defenses.ac).toMatchObject({ display: "25", provenance: "exact-client" });
        expect(state.creatures[TOKEN].name).toBe("Graveknight");
    });

    it("marks attack-derived AC possible when the degree adjustment is unknown", () => {
        const state = applyObservation(
            emptyNotebook(),
            attack(27, 12, "criticalSuccess", { degreeAdjustment: null }),
        );
        expect(state.creatures[TOKEN].defenses.ac?.provenance).toBe("possible");
    });

    it("treats an impossible attack observation as a contradiction", () => {
        let state = applyObservation(emptyNotebook(), attack(27, 12, "success"));
        const before = state.creatures[TOKEN].defenses.ac;
        state = applyObservation(state, attack(27, 20, "criticalFailure"));
        expect(state.creatures[TOKEN].defenses.ac).toEqual(before);
        expect(state.creatures[TOKEN].contradictions).toHaveLength(1);
        expect(state.creatures[TOKEN].evidence).toHaveLength(1);
    });

    it("records an exact attack DC as exact client data", () => {
        const state = applyObservation(emptyNotebook(), attack(27, 12, "success", { exactDc: 26 }));
        expect(state.creatures[TOKEN].defenses.ac).toMatchObject({ display: "26", provenance: "exact-client" });
    });

    it("keeps non-base attack contexts out of the base AC fact", () => {
        let state = applyObservation(emptyNotebook(), attack(27, 12, "success"));
        state = applyObservation(state, attack(10, 12, "success", { contextKey: "flanked" }));
        expect(state.creatures[TOKEN].defenses.ac?.display).toBe("18–27");
        expect(state.creatures[TOKEN].evidence).toHaveLength(2);
    });

    it("needs a target and an outcome before inferring attack AC", () => {
        let state = applyObservation(emptyNotebook(), attack(27, 12, "success", { targetTokenUuid: null }));
        expect(state.creatures).toEqual({});
        expect(state.diagnostics).toHaveLength(1);
        state = applyObservation(state, attack(27, 12, null));
        expect(state.creatures[TOKEN].defenses.ac).toBeUndefined();
        expect(state.creatures[TOKEN].evidence).toHaveLength(1);
    });

    it("attaches an observed save modifier to the roller without overwriting exact data", () => {
        const save = (total: number, rollerTokenUuid?: string): Observation => event({
            type: "check-roll",
            payload: {
                checkType: "save",
                statistic: "will",
                total,
                natural: 7,
                outcome: "failure",
                degreeAdjustment: 0,
                targetTokenUuid: null,
                contextKey: "base",
                ...(rollerTokenUuid ? { rollerTokenUuid } : {}),
            },
        });
        let state = applyObservation(emptyNotebook(), save(25, "Scene.s.Token.r"));
        expect(state.creatures["Scene.s.Token.r"].defenses.will).toMatchObject({
            display: "+18",
            provenance: "observed",
        });
        expect(state.creatures["Scene.s.Token.r"].name).toBe("Unknown creature");

        state = applyObservation(state, save(5));
        expect(state.diagnostics).toHaveLength(1);
        expect(Object.keys(state.creatures)).toEqual(["Scene.s.Token.r"]);

        state = applyObservation(state, snapshot({ will: 30 }));
        state = applyObservation(state, save(20, TOKEN));
        expect(state.creatures[TOKEN].defenses.will).toMatchObject({ display: "30", provenance: "exact-client" });
        expect(state.creatures[TOKEN].evidence).toHaveLength(2);
    });

    it("formats a negative observed modifier with its sign", () => {
        const state = applyObservation(emptyNotebook(), event({
            type: "check-roll",
            payload: {
                checkType: "perception",
                statistic: "perception",
                total: 3,
                natural: 5,
                outcome: null,
                degreeAdjustment: null,
                targetTokenUuid: null,
                rollerTokenUuid: TOKEN,
                contextKey: "base",
            },
        }));
        expect(state.creatures[TOKEN].defenses.perception?.display).toBe("-2");
    });

    it("clears encounter data only when the scope changes", () => {
        let state = applyObservation(emptyNotebook(), event({
            type: "handshake",
            payload: {
                status: "active",
                foundry: "14",
                system: "pf2e",
                systemVersion: "8.5.0",
                worldId: "world",
                userId: "user",
            },
        }));
        state = applyObservation(state, scope("s", null));
        expect(state.scopeId).toBe("s:exploration");
        state = applyObservation(state, snapshot({ ac: 28 }));
        state = applyObservation(state, event({ type: "target", payload: { tokenUuid: TOKEN } }));
        state = applyObservation(state, event({
            type: "unassigned-check",
            payload: { messageId: "m", total: 12, outcome: null },
        }));

        state = applyObservation(state, scope("s", null));
        expect(state.creatures[TOKEN]).toBeDefined();
        expect(state.selectedTokenUuid).toBe(TOKEN);
        expect(state.diagnostics).toHaveLength(1);

        state = applyObservation(state, scope("s", "c"));
        expect(state.scopeId).toBe("s:c");
        expect(state.combatId).toBe("c");
        expect(state.creatures).toEqual({});
        expect(state.selectedTokenUuid).toBeNull();
        expect(state.diagnostics).toEqual([]);
        expect(state.seenEventIds).toHaveLength(1);
        expect(state).toMatchObject({ compatibility: "active", worldId: "world", userId: "user" });
    });

    it("updates compatibility from the handshake", () => {
        const state = applyObservation(emptyNotebook(), event({
            type: "handshake",
            payload: {
                status: "unsupported",
                foundry: "13",
                system: "pf2e",
                systemVersion: "7.0.0",
                worldId: "w",
                userId: "u",
                reason: "Foundry 13 is not supported",
            },
        }));
        expect(state).toMatchObject({
            compatibility: "unsupported",
            compatibilityReason: "Foundry 13 is not supported",
            worldId: "w",
            userId: "u",
        });
    });

    it("does not mutate the previous state", () => {
        const frozen = deepFreeze(applyObservation(emptyNotebook(), snapshot({ ac: 28 })));
        expect(() => applyObservation(frozen, attack(27, 12, "success"))).not.toThrow();
        expect(() => applyObservation(frozen, scope("x", null))).not.toThrow();
        expect(frozen.creatures[TOKEN].evidence).toHaveLength(1);
    });

    it("bounds seen events, diagnostics, evidence, and contradictions", () => {
        let state = emptyNotebook();
        for (let index = 0; index < 2_050; index += 1) {
            state = applyObservation(state, event({
                eventId: `u${index}`,
                type: "unassigned-check",
                payload: { messageId: `m${index}`, total: index, outcome: null },
            }));
        }
        expect(state.seenEventIds).toHaveLength(2_000);
        expect(state.seenEventIds[0]).toBe("u50");
        expect(state.diagnostics).toHaveLength(100);

        state = applyObservation(state, attack(20, 10, "success"));
        for (let index = 0; index < 250; index += 1) {
            state = applyObservation(state, attack(20, 10, "success"));
            state = applyObservation(state, attack(40, 10, "failure"));
        }
        const record = state.creatures[TOKEN];
        expect(record.evidence).toHaveLength(200);
        expect(record.contradictions).toHaveLength(200);
        expect(record.defenses.ac?.evidenceIds.length).toBeLessThanOrEqual(200);
        expect(parseNotebookState(state)).toEqual(state);
    });

    it("hides the overlay without a selected, recorded, AC-bearing target", () => {
        let state = applyObservation(emptyNotebook(), snapshot({ will: 30 }));
        expect(currentOverlay(state)).toBeNull();
        state = applyObservation(state, event({ type: "target", payload: { tokenUuid: "Scene.s.Token.other" } }));
        expect(currentOverlay(state)).toBeNull();
        state = applyObservation(state, event({ type: "target", payload: { tokenUuid: TOKEN } }));
        expect(currentOverlay(state)).toBeNull();
    });
});

describe("parseNotebookState", () => {
    it("accepts an empty notebook", () => {
        expect(parseNotebookState(emptyNotebook())).toEqual(emptyNotebook());
    });

    it("rejects a corrupted creature container", () => {
        expect(parseNotebookState({ creatures: "<script>" })).toBeNull();
        expect(parseNotebookState({ ...emptyNotebook(), creatures: "<script>" })).toBeNull();
    });

    it("round-trips a populated notebook into a fresh object", () => {
        let state = applyObservation(emptyNotebook(), scope("s", "c"));
        state = applyObservation(state, snapshot({ will: 30 }));
        state = applyObservation(state, attack(27, 12, "success"));
        state = applyObservation(state, attack(40, 10, "failure"));
        state = applyObservation(state, event({ type: "target", payload: { tokenUuid: TOKEN } }));
        const stored: unknown = JSON.parse(JSON.stringify(state));
        const parsed = parseNotebookState(stored);
        expect(parsed).toEqual(state);
        expect(parsed).not.toBe(stored);
        expect(parsed?.creatures[TOKEN]).not.toBe((stored as NotebookState).creatures[TOKEN]);
    });

    it("rejects mismatched keys, unknown provenance, unknown keys, and oversized arrays", () => {
        const state = applyObservation(emptyNotebook(), snapshot({ ac: 28 }));
        const clone = (): NotebookState => JSON.parse(JSON.stringify(state)) as NotebookState;

        const mismatched = clone();
        mismatched.creatures["Scene.s.Token.other"] = mismatched.creatures[TOKEN];
        expect(parseNotebookState(mismatched)).toBeNull();

        const provenance = clone();
        (provenance.creatures[TOKEN].defenses.ac as { provenance: string }).provenance = "guessed";
        expect(parseNotebookState(provenance)).toBeNull();

        expect(parseNotebookState({ ...clone(), extra: true })).toBeNull();

        const defenseKind = clone();
        (defenseKind.creatures[TOKEN].defenses as Record<string, unknown>).speed = state.creatures[TOKEN].defenses.ac;
        expect(parseNotebookState(defenseKind)).toBeNull();

        const compatibility = { ...clone(), compatibility: "maybe" };
        expect(parseNotebookState(compatibility)).toBeNull();

        const seen = { ...clone(), seenEventIds: Array.from({ length: 2_001 }, (_value, index) => `e${index}`) };
        expect(parseNotebookState(seen)).toBeNull();

        const diagnostics = { ...clone(), diagnostics: Array.from({ length: 101 }, () => "d") };
        expect(parseNotebookState(diagnostics)).toBeNull();

        const evidence = clone();
        evidence.creatures[TOKEN].evidence = Array.from({ length: 201 }, (_value, index) => ({
            id: `e${index}`,
            timestamp: 1,
            summary: "s",
        }));
        expect(parseNotebookState(evidence)).toBeNull();
    });

    it("treats prototype-like token keys as ordinary records", () => {
        let state = emptyNotebook();
        expect(currentOverlay(applyObservation(state, event({
            type: "target",
            payload: { tokenUuid: "__proto__" },
        })))).toBeNull();
        state = applyObservation(state, event({
            type: "token-snapshot",
            payload: { tokenUuid: "__proto__", actorUuid: null, name: "Odd", defenses: { ac: 15 } },
        }));
        expect(Object.getPrototypeOf(state.creatures)).toBe(Object.prototype);
        const parsed = parseNotebookState(JSON.parse(JSON.stringify(state)));
        expect(parsed?.creatures.__proto__).toMatchObject({ name: "Odd" });
        expect(Object.getPrototypeOf(parsed?.creatures)).toBe(Object.prototype);
    });

    it("restores invalid storage as an empty notebook with a local diagnostic", () => {
        expect(restoreNotebookState({ creatures: "<script>" })).toEqual({
            ...emptyNotebook(),
            diagnostics: [STORED_STATE_INVALID_DIAGNOSTIC],
        });
        expect(STORED_STATE_INVALID_DIAGNOSTIC).toBe("Stored encounter data was invalid and was reset.");
        const state = applyObservation(emptyNotebook(), snapshot({ ac: 28 }));
        expect(restoreNotebookState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    });
});

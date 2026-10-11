import { describe, expect, it } from "vitest";
import { compatibilityOf, extractCheck, snapshotToken } from "../../src/main/extract.js";
import { parseObservation, type Observation } from "../../src/shared/protocol.js";

function expectValid(observation: Observation | null): Observation {
    expect(observation).not.toBeNull();
    expect(parseObservation(observation)).toEqual(observation);
    return observation as Observation;
}

function checkPayload(observation: Observation | null): Extract<Observation, { type: "check-roll" }>["payload"] {
    const valid = expectValid(observation);
    if (valid.type !== "check-roll") throw new Error(`expected check-roll, got ${valid.type}`);
    return valid.payload;
}

function message(context: Record<string, unknown>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "message-1",
        timestamp: 10,
        flags: { pf2e: { context } },
        rolls: [{ total: 27, dice: [{ faces: 20, results: [{ result: 12 }] }] }],
        ...overrides,
    };
}

describe("PF2e runtime extraction", () => {
    it("supports only Foundry 14 and PF2e 8.5", () => {
        expect(compatibilityOf({
            foundryGeneration: 14,
            systemId: "pf2e",
            systemVersion: "8.5.3",
        }).status).toBe("active");
        expect(compatibilityOf({
            foundryGeneration: 14,
            systemId: "pf2e",
            systemVersion: "8.6.0",
        }).status).toBe("unsupported");
    });

    it("explains unsupported runtimes and accepts the bare 8.5 version", () => {
        expect(compatibilityOf({ foundryGeneration: 14, systemId: "pf2e", systemVersion: "8.5" }).status)
            .toBe("active");
        expect(compatibilityOf({ foundryGeneration: 14, systemId: "pf2e", systemVersion: "8.50.0" }).status)
            .toBe("unsupported");
        const foundry = compatibilityOf({ foundryGeneration: 13, systemId: "pf2e", systemVersion: "8.5.0" });
        expect(foundry.status).toBe("unsupported");
        expect(foundry.reason).toContain("13");
        const system = compatibilityOf({ foundryGeneration: 14, systemId: "sf2e", systemVersion: "8.5.0" });
        expect(system.status).toBe("unsupported");
        expect(system.reason).toContain("sf2e");
        const version = compatibilityOf({ foundryGeneration: 14, systemId: "pf2e", systemVersion: "8.6.0" });
        expect(version.reason).toContain("8.6.0");
        expect(version.reason!.length).toBeLessThanOrEqual(200);
    });

    it("extracts a targeted attack from PF2e flags", () => {
        expect(extractCheck({
            id: "message-1",
            timestamp: 10,
            flags: {
                pf2e: {
                    context: {
                        type: "attack-roll",
                        outcome: "success",
                        dc: { value: 28 },
                        target: { token: "Scene.s.Token.t" },
                        options: [],
                    },
                },
            },
            rolls: [{
                total: 27,
                dice: [{ faces: 20, results: [{ result: 12 }] }],
            }],
        })).toMatchObject({
            type: "check-roll",
            payload: {
                checkType: "attack",
                statistic: "ac",
                total: 27,
                natural: 12,
                outcome: "success",
                targetTokenUuid: "Scene.s.Token.t",
                exactDc: 28,
            },
        });
    });

    it("builds the event envelope from the chat message", () => {
        const observation = expectValid(extractCheck(message({
            type: "attack-roll",
            outcome: "failure",
            target: { token: "Scene.s.Token.t" },
        })));
        expect(observation.eventId).toBe("chat:message-1");
        expect(observation.timestamp).toBe(10);
        const payload = checkPayload(observation);
        expect(payload.degreeAdjustment).toBeNull();
        expect(payload.contextKey).toBe("base");
        expect(payload).not.toHaveProperty("exactDc");
        expect(payload).not.toHaveProperty("rollerTokenUuid");
    });

    it("falls back to the current time when the message timestamp is unusable", () => {
        const before = Date.now();
        const observation = expectValid(extractCheck(message(
            { type: "attack-roll", outcome: "failure", target: { token: "Scene.s.Token.t" } },
            { timestamp: Number.NaN },
        )));
        expect(observation.timestamp).toBeGreaterThanOrEqual(before);
    });

    it("rejects targetless attacks and malformed dice", () => {
        expect(extractCheck({ flags: { pf2e: { context: { type: "attack-roll" } } } }))
            .toBeNull();
        expect(extractCheck(message({ type: "attack-roll", outcome: "success" }))).toBeNull();
        const target = { token: "Scene.s.Token.t" };
        expect(extractCheck(message({ type: "attack-roll", outcome: "success", target }, {
            rolls: [{ total: 27, dice: [{ faces: 6, results: [{ result: 4 }] }] }],
        }))).toBeNull();
        expect(extractCheck(message({ type: "attack-roll", outcome: "success", target }, {
            rolls: [{ total: 27, dice: [{ faces: 20, results: [{ result: 21 }] }] }],
        }))).toBeNull();
        expect(extractCheck(message({ type: "attack-roll", outcome: "success", target }, {
            rolls: [{ total: 27.5, dice: [{ faces: 20, results: [{ result: 12 }] }] }],
        }))).toBeNull();
        expect(extractCheck(message({ type: "attack-roll", outcome: "success", target }, { rolls: [] })))
            .toBeNull();
        expect(extractCheck(message({ type: "attack-roll", outcome: "success", target }, { id: "" })))
            .toBeNull();
    });

    it("rejects attacks with neither a known outcome nor an exact DC", () => {
        expect(extractCheck(message({ type: "attack-roll", target: { token: "Scene.s.Token.t" } }))).toBeNull();
        const payload = checkPayload(extractCheck(message({
            type: "attack-roll",
            outcome: "bogus",
            dc: { value: 25 },
            target: { token: "Scene.s.Token.t" },
        })));
        expect(payload.outcome).toBeNull();
        expect(payload.exactDc).toBe(25);
    });

    it("ignores non-integer DCs and unrelated check types", () => {
        const payload = checkPayload(extractCheck(message({
            type: "attack-roll",
            outcome: "success",
            dc: { value: Number.POSITIVE_INFINITY },
            target: { token: "Scene.s.Token.t" },
        })));
        expect(payload).not.toHaveProperty("exactDc");
        expect(extractCheck(message({ type: "skill-check", outcome: "success" }))).toBeNull();
        expect(extractCheck(message({ type: "damage-roll" }))).toBeNull();
        expect(extractCheck({ flags: {} })).toBeNull();
        expect(extractCheck(null)).toBeNull();
    });

    it("skips inactive d20 results", () => {
        const payload = checkPayload(extractCheck(message(
            { type: "attack-roll", outcome: "success", target: { token: "Scene.s.Token.t" } },
            {
                rolls: [{
                    total: 30,
                    dice: [
                        { faces: 6, results: [{ result: 5 }] },
                        { faces: 20, results: [{ result: 3, active: false }, { result: 15 }] },
                    ],
                }],
            },
        )));
        expect(payload.natural).toBe(15);
    });

    it("uses the unadjusted outcome with zero adjustment when PF2e records it", () => {
        const payload = checkPayload(extractCheck(message({
            type: "attack-roll",
            outcome: "criticalSuccess",
            unadjustedOutcome: "success",
            target: { token: "Scene.s.Token.t" },
        })));
        expect(payload.outcome).toBe("success");
        expect(payload.degreeAdjustment).toBe(0);
    });

    it("falls back to the adjusted outcome with an unknown adjustment", () => {
        const payload = checkPayload(extractCheck(message({
            type: "attack-roll",
            outcome: "criticalSuccess",
            unadjustedOutcome: "nonsense",
            target: { token: "Scene.s.Token.t" },
        })));
        expect(payload.outcome).toBe("criticalSuccess");
        expect(payload.degreeAdjustment).toBeNull();
    });

    it("derives the save statistic from a single save domain", () => {
        const payload = checkPayload(extractCheck(message({
            type: "saving-throw",
            outcome: "failure",
            domains: ["saving-throw", "reflex", "dex-based", "all"],
            dc: { value: 22 },
        }, { speaker: { scene: "s", token: "roller" } })));
        expect(payload).toMatchObject({
            checkType: "save",
            statistic: "reflex",
            targetTokenUuid: null,
            rollerTokenUuid: "Scene.s.Token.roller",
            exactDc: 22,
        });
    });

    it("rejects saves with no or several save domains", () => {
        expect(extractCheck(message({ type: "saving-throw", outcome: "failure", domains: ["saving-throw"] })))
            .toBeNull();
        expect(extractCheck(message({ type: "saving-throw", outcome: "failure" }))).toBeNull();
        expect(extractCheck(message({
            type: "saving-throw",
            outcome: "failure",
            domains: ["fortitude", "will"],
        }))).toBeNull();
    });

    it("extracts perception checks and keeps a null outcome", () => {
        const payload = checkPayload(extractCheck(message(
            { type: "perception-check", domains: ["perception"], target: { token: "Scene.s.Token.t" } },
            { speaker: { scene: "s", token: "" } },
        )));
        expect(payload).toMatchObject({
            checkType: "perception",
            statistic: "perception",
            outcome: null,
            degreeAdjustment: null,
            targetTokenUuid: "Scene.s.Token.t",
        });
        expect(payload).not.toHaveProperty("rollerTokenUuid");
    });

    it("builds a bounded context key from target condition options", () => {
        const payload = checkPayload(extractCheck(message({
            type: "attack-roll",
            outcome: "success",
            target: { token: "Scene.s.Token.t" },
            options: [
                "target:condition:prone",
                "self:condition:flat-footed",
                "target:condition:off-guard",
                "target:condition:prone",
                `target:condition:${"x".repeat(100)}`,
                42,
            ],
        })));
        expect(payload.contextKey).toBe("target:condition:off-guard|target:condition:prone");

        const many = Array.from({ length: 30 }, (_, index) => `target:condition:c${String(index).padStart(2, "0")}`);
        const bounded = checkPayload(extractCheck(message({
            type: "attack-roll",
            outcome: "success",
            target: { token: "Scene.s.Token.t" },
            options: many,
        })));
        const parts = bounded.contextKey.split("|");
        expect(parts.length).toBeLessThanOrEqual(10);
        expect(parts).toEqual([...parts].sort());
        expect(bounded.contextKey.length).toBeLessThanOrEqual(512);

        const long = Array.from({ length: 10 }, (_, index) => `target:condition:${String(index)}${"y".repeat(80)}`);
        const longKey = checkPayload(extractCheck(message({
            type: "attack-roll",
            outcome: "success",
            target: { token: "Scene.s.Token.t" },
            options: long,
        }))).contextKey;
        expect(longKey.length).toBeLessThanOrEqual(512);
        expect(longKey.split("|").length).toBeGreaterThan(0);
    });

    it("takes exact defenses only from an already-instantiated token actor", () => {
        expect(snapshotToken({
            document: { uuid: "Scene.s.Token.t", name: "Graveknight" },
            actor: {
                uuid: "Actor.a",
                armorClass: { value: 28 },
                getStatistic: (slug: string) =>
                    ({ fortitude: 18, reflex: 15, will: 16, perception: 17 })[slug] === undefined
                        ? undefined
                        : { check: { mod: ({ fortitude: 18, reflex: 15, will: 16, perception: 17 })[slug] } },
            },
        })?.payload.defenses).toEqual({
            ac: 28,
            fortitude: 18,
            reflex: 15,
            will: 16,
            perception: 17,
        });
    });

    it("produces valid, uniquely identified snapshots with fallbacks", () => {
        const token = {
            name: "N".repeat(300),
            document: { uuid: "Scene.s.Token.t" },
            actor: {
                system: { attributes: { ac: { value: 21 } } },
                getStatistic: (slug: string) => (slug === "will" ? { mod: 9 } : slug === "reflex" ? { mod: 1.5 } : null),
            },
        };
        const first = expectValid(snapshotToken(token));
        const second = expectValid(snapshotToken(token));
        expect(first.eventId).not.toBe(second.eventId);
        if (first.type !== "token-snapshot") throw new Error("expected snapshot");
        expect(first.payload).toEqual({
            tokenUuid: "Scene.s.Token.t",
            actorUuid: null,
            name: "N".repeat(200),
            defenses: { ac: 21, will: 9 },
        });
    });

    it("snapshots tokens without actors and rejects tokens without a UUID", () => {
        const observation = expectValid(snapshotToken({ document: { uuid: "Scene.s.Token.t", name: "Hidden" } }));
        expect(observation.payload).toMatchObject({ actorUuid: null, defenses: {} });
        expect(snapshotToken({ document: { name: "Nope" } })).toBeNull();
        expect(snapshotToken(undefined)).toBeNull();
    });

    it("survives throwing statistic getters", () => {
        const observation = expectValid(snapshotToken({
            document: { uuid: "Scene.s.Token.t", name: "Trap" },
            actor: {
                uuid: "Actor.a",
                armorClass: { value: 20 },
                getStatistic: () => {
                    throw new Error("boom");
                },
            },
        }));
        expect(observation.payload).toMatchObject({ defenses: { ac: 20 } });
    });
});

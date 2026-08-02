import { describe, expect, it } from "vitest";
import { encodeTargetUuidSaveKey, normalizeSaveResult, normalizeSaveResults, normalizeTargetHelperFlagData } from "../../../src/rulesets/sf2e/target-helper/result-validation.js";

const REVISION = "11111111-1111-4111-8111-111111111111";

const VALID_RESULT = {
    value: 24,
    die: 17,
    success: "success",
    modifiers: [{ label: "Reflex", modifier: 7 }],
    private: false,
    statistic: "reflex",
    targetUuid: "Scene.scene.Token.valid",
    generation: 0,
    revision: REVISION,
};

const VALID_SAVE_KEY = encodeTargetUuidSaveKey(VALID_RESULT.targetUuid, 0, REVISION);

describe("normalizeSaveResult", () => {
    it("copies a well-shaped save result", () => {
        expect(normalizeSaveResult(VALID_RESULT, "reflex")).toEqual(VALID_RESULT);
    });

    it("redacts untrusted private result details into a completion marker", () => {
        expect(normalizeSaveResult({
            ...VALID_RESULT,
            private: true,
            value: 999,
            die: 999,
            success: "maybe",
            modifiers: [{ label: "secret", modifier: Number.NaN }],
            overcomeDc: 999,
            overcomeSuccess: "maybe",
        }, "reflex")).toEqual({
            private: true,
            statistic: "reflex",
            targetUuid: "Scene.scene.Token.valid",
            generation: 0,
            revision: REVISION,
        });
    });

    it("accepts an already-redacted private completion marker", () => {
        expect(normalizeSaveResult({
            private: true,
            statistic: "reflex",
            targetUuid: "Scene.scene.Token.valid",
            generation: 0,
            revision: REVISION,
        }, "reflex")).toEqual({
            private: true,
            statistic: "reflex",
            targetUuid: "Scene.scene.Token.valid",
            generation: 0,
            revision: REVISION,
        });
    });

    it("rejects private completion markers with invalid routing metadata", () => {
        expect(normalizeSaveResult({
            private: true,
            statistic: "will",
            targetUuid: "Scene.scene.Token.valid",
            generation: 0,
            revision: REVISION,
        }, "reflex")).toBeNull();
    });

    it.each([
        { ...VALID_RESULT, value: Number.POSITIVE_INFINITY },
        { ...VALID_RESULT, die: 0 },
        { ...VALID_RESULT, die: 21 },
        { ...VALID_RESULT, die: 1.5 },
        { ...VALID_RESULT, success: "maybe" },
        { ...VALID_RESULT, success: "toString" },
        { ...VALID_RESULT, private: "false" },
        { ...VALID_RESULT, statistic: "will" },
        { ...VALID_RESULT, modifiers: [{ label: "Reflex", modifier: Number.NaN }] },
        { ...VALID_RESULT, overcomeDc: "20" },
        { ...VALID_RESULT, generation: undefined },
        { ...VALID_RESULT, generation: -1 },
        { ...VALID_RESULT, generation: 1.5 },
        { ...VALID_RESULT, overcomeSuccess: "maybe" },
    ])("rejects malformed persisted data", (result) => {
        expect(normalizeSaveResult(result, "reflex")).toBeNull();
    });

    it("rejects oversized modifier lists and labels", () => {
        expect(normalizeSaveResult({ ...VALID_RESULT, modifiers: Array.from({ length: 101 }, () => ({ label: "x", modifier: 1 })) }, "reflex")).toBeNull();
        expect(normalizeSaveResult({ ...VALID_RESULT, modifiers: [{ label: "x".repeat(201), modifier: 1 }] }, "reflex")).toBeNull();
    });

    it("drops invalid siblings without mutating valid siblings", () => {
        expect(normalizeSaveResults({ [VALID_SAVE_KEY]: VALID_RESULT, [encodeTargetUuidSaveKey("Scene.scene.Token.invalid", 0, REVISION)]: { ...VALID_RESULT, die: 0 } }, "reflex", ["Scene.scene.Token.valid", "Scene.scene.Token.invalid"], 0, REVISION)).toEqual({ valid: VALID_RESULT });
    });

    it.each([
        { ...VALID_RESULT, targetUuid: undefined },
        { ...VALID_RESULT, targetUuid: "Actor.actor" },
        { ...VALID_RESULT, targetUuid: "Scene.scene.Token.valid.Actor.actor" },
    ])("rejects missing or invalid target provenance", (result) => {
        expect(normalizeSaveResult(result, "reflex")).toBeNull();
    });

    it.each([
        "Actor.actor.Token.valid",
        "Garbage.value.Token.valid",
        "Scene.scene.Token.bad.id",
        "Scene.bad$id.Token.valid",
    ])("rejects non-canvas token UUID %s", (targetUuid) => {
        expect(normalizeSaveResult({ ...VALID_RESULT, targetUuid }, "reflex")).toBeNull();
    });

    it("drops a stored leaf whose provenance does not match its current target UUID", () => {
        expect(normalizeSaveResults({ [VALID_SAVE_KEY]: VALID_RESULT }, "reflex", ["Scene.reassigned.Token.valid"], 0, REVISION)).toEqual({});
    });

    it("drops a stored leaf from an older target-list generation even when its UUID is current again", () => {
        expect(normalizeSaveResults({ [VALID_SAVE_KEY]: VALID_RESULT }, "reflex", ["Scene.scene.Token.valid"], 2, REVISION)).toEqual({});
    });

    it("drops a leaf from a different target-list revision even when generation and UUID match", () => {
        expect(normalizeSaveResults({ [VALID_SAVE_KEY]: VALID_RESULT }, "reflex", ["Scene.scene.Token.valid"], 0, "22222222-2222-4222-8222-222222222222")).toEqual({});
    });

    it("encodes exact UUIDs as distinct Foundry update-path-safe keys", () => {
        expect(encodeTargetUuidSaveKey("Scene.first.Token.shared", 0, REVISION)).toMatch(/^r[0-9a-f]{32}g0u[0-9a-f]+$/);
        expect(encodeTargetUuidSaveKey("Scene.first.Token.shared", 0, REVISION)).not.toContain(".");
        expect(encodeTargetUuidSaveKey("Scene.first.Token.shared", 0, REVISION)).not.toBe(encodeTargetUuidSaveKey("Scene.second.Token.shared", 0, REVISION));
        expect(encodeTargetUuidSaveKey("Scene.first.Token.shared", 0, REVISION)).not.toBe(encodeTargetUuidSaveKey("Scene.first.Token.shared", 1, REVISION));
    });

    it("drops legacy token-ID leaves and encoded leaves with mismatched provenance", () => {
        expect(normalizeSaveResults({
            valid: VALID_RESULT,
            [encodeTargetUuidSaveKey("Scene.other.Token.valid", 0, REVISION)]: VALID_RESULT,
        }, "reflex", ["Scene.scene.Token.valid"], 0, REVISION)).toEqual({});
    });
});

describe("normalizeTargetHelperFlagData", () => {
    it("normalizes bounded token UUID arrays and item UUIDs", () => {
        expect(normalizeTargetHelperFlagData({
            type: "spell",
            revision: REVISION,
            targets: ["Scene.scene.Token.target", "Scene.scene.Token.target"],
            item: "Actor.actor.Item.item",
            options: ["damaging-effect"],
        })).toEqual({
            type: "spell",
            targets: ["Scene.scene.Token.target"],
            generation: 0,
            revision: REVISION,
            item: "Actor.actor.Item.item",
            options: ["damaging-effect"],
        });
    });

    it.each([
        { type: "spell", targets: [] },
        { type: "spell", revision: REVISION, targets: ["Scene.scene.Token"] },
        { type: "spell", revision: REVISION, targets: ["Scene.scene.Token.target.Actor.actor"] },
        { type: "spell", revision: REVISION, targets: Array.from({ length: 101 }, (_, index) => `Scene.scene.Token.${index}`) },
        { type: "spell", revision: REVISION, targets: [], item: "Actor.actor.Token.token" },
        { type: "spell", revision: REVISION, targets: [], author: "Actor.actor.Item.item" },
        { type: "spell", revision: REVISION, targets: [], item: "Actor.actor.Item.item.Actor.actor" },
        { type: "spell", revision: REVISION, targets: [], options: ["x".repeat(201)] },
        { type: "spell", revision: REVISION, targets: [], save: [] },
        { type: "spell", revision: REVISION, targets: [], generation: -1 },
        { type: "spell", revision: REVISION, targets: [], generation: 1.5 },
    ])("rejects malformed stored payloads", (value) => {
        expect(normalizeTargetHelperFlagData(value)).toBeUndefined();
    });

    it("rejects target UUIDs with colliding embedded token IDs", () => {
        expect(normalizeTargetHelperFlagData({
            type: "spell",
            revision: REVISION,
            targets: ["Scene.first.Token.shared", "Scene.second.Token.shared"],
        })).toBeUndefined();
    });

    it("drops unsafe result keys", () => {
        expect(normalizeSaveResults({ "token.escape": VALID_RESULT, [VALID_SAVE_KEY]: VALID_RESULT }, "reflex", ["Scene.scene.Token.valid"], 0, REVISION)).toEqual({ valid: VALID_RESULT });
    });

    it("keeps only stored leaves with exact target provenance", () => {
        expect(normalizeTargetHelperFlagData({
            type: "spell",
            revision: REVISION,
            targets: ["Scene.scene.Token.valid", "Scene.scene.Token.missing", "Scene.reassigned.Token.stale"],
            save: { statistic: "reflex", dc: 20, basic: true },
            saves: {
                [VALID_SAVE_KEY]: VALID_RESULT,
                [encodeTargetUuidSaveKey("Scene.scene.Token.missing", 0, REVISION)]: { ...VALID_RESULT, targetUuid: undefined },
                [encodeTargetUuidSaveKey("Scene.original.Token.stale", 0, REVISION)]: { ...VALID_RESULT, targetUuid: "Scene.original.Token.stale" },
            },
        })?.saves).toEqual({ valid: VALID_RESULT });
    });
});

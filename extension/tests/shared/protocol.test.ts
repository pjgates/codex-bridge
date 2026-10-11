import { describe, expect, it } from "vitest";
import {
    PROTOCOL_VERSION,
    parseObservation,
    parsePageCommand,
} from "../../src/shared/protocol.js";

describe("page protocol", () => {
    it("accepts a supported check observation", () => {
        const value = {
            protocol: PROTOCOL_VERSION,
            eventId: "event-1",
            timestamp: 1,
            type: "check-roll",
            payload: {
                checkType: "attack",
                statistic: "ac",
                total: 27,
                natural: 14,
                outcome: "success",
                degreeAdjustment: 0,
                targetTokenUuid: "Scene.s.Token.t",
                contextKey: "base",
            },
        };
        expect(parseObservation(value)).toEqual(value);
    });

    it.each([
        null,
        {},
        { protocol: 99, type: "check-roll" },
        {
            protocol: PROTOCOL_VERSION,
            eventId: "bad",
            timestamp: 1,
            type: "check-roll",
            payload: { total: "<script>" },
        },
    ])("rejects malformed observations %#", (value) => {
        expect(parseObservation(value)).toBeNull();
    });

    it("accepts only constrained overlay commands", () => {
        expect(parsePageCommand({
            protocol: PROTOCOL_VERSION,
            type: "render-overlay",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                name: "Graveknight",
                ac: "27–28",
            },
        })).not.toBeNull();
        expect(parsePageCommand({
            protocol: PROTOCOL_VERSION,
            type: "invoke",
            payload: { method: "fromUuid" },
        })).toBeNull();
    });

    it("rejects token snapshots with unknown defense keys or non-finite values", () => {
        const base = {
            protocol: PROTOCOL_VERSION,
            eventId: "event-2",
            timestamp: 2,
            type: "token-snapshot",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                actorUuid: null,
                name: "Graveknight",
                defenses: { ac: 28, will: 20 },
            },
        };
        expect(parseObservation(base)).toEqual(base);
        expect(parseObservation({
            ...base,
            payload: { ...base.payload, defenses: { ac: 28, hp: 100 } },
        })).toBeNull();
        expect(parseObservation({
            ...base,
            payload: { ...base.payload, defenses: { ac: Number.NaN } },
        })).toBeNull();
    });

    it.each([27.5, 1e20])("rejects non-safe-integer numeric values %s", (value) => {
        const check = {
            protocol: PROTOCOL_VERSION,
            eventId: "event-int",
            timestamp: 3,
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
        };
        expect(parseObservation(check)).not.toBeNull();
        expect(parseObservation({ ...check, payload: { ...check.payload, total: value } })).toBeNull();
        expect(parseObservation({ ...check, payload: { ...check.payload, exactDc: value } })).toBeNull();
        expect(parseObservation({
            protocol: PROTOCOL_VERSION,
            eventId: "event-unassigned",
            timestamp: 3,
            type: "unassigned-check",
            payload: { messageId: "m", total: value, outcome: null },
        })).toBeNull();
        expect(parseObservation({
            protocol: PROTOCOL_VERSION,
            eventId: "event-snapshot",
            timestamp: 3,
            type: "token-snapshot",
            payload: { tokenUuid: "Scene.s.Token.t", actorUuid: null, name: "G", defenses: { ac: value } },
        })).toBeNull();
    });

    it.each([0, 21, 1.5])("rejects natural %s", (natural) => {
        expect(parseObservation({
            protocol: PROTOCOL_VERSION,
            eventId: "event-3",
            timestamp: 3,
            type: "check-roll",
            payload: {
                checkType: "save",
                statistic: "fortitude",
                total: 20,
                natural,
                outcome: null,
                degreeAdjustment: null,
                targetTokenUuid: null,
                contextKey: "base",
            },
        })).toBeNull();
    });

    it("strips unknown payload keys into a fresh object and omits absent optionals", () => {
        const value = {
            protocol: PROTOCOL_VERSION,
            eventId: "event-4",
            timestamp: 4,
            type: "handshake",
            payload: {
                status: "active",
                foundry: "14.0",
                system: "pf2e",
                systemVersion: "8.5.0",
                worldId: "world",
                userId: "user",
                injected: "<script>",
            },
        };
        const parsed = parseObservation(value);
        expect(parsed).not.toBe(value);
        expect(parsed?.payload).not.toBe(value.payload);
        expect(parsed?.payload).toEqual({
            status: "active",
            foundry: "14.0",
            system: "pf2e",
            systemVersion: "8.5.0",
            worldId: "world",
            userId: "user",
        });
        expect(parsed?.payload).not.toHaveProperty("reason");
    });

    it("rejects clear-overlay commands with a non-empty payload", () => {
        expect(parsePageCommand({
            protocol: PROTOCOL_VERSION,
            type: "clear-overlay",
            payload: {},
        })).toEqual({ protocol: PROTOCOL_VERSION, type: "clear-overlay", payload: {} });
        expect(parsePageCommand({
            protocol: PROTOCOL_VERSION,
            type: "clear-overlay",
            payload: { method: "fromUuid" },
        })).toBeNull();
    });
});

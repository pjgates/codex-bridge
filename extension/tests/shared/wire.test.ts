import { describe, expect, it } from "vitest";
import { decodeDetail, encodeDetail, MAX_DETAIL_LENGTH } from "../../src/shared/wire.js";
import type { PageCommand } from "../../src/shared/protocol.js";

describe("cross-world wire encoding", () => {
    it("round-trips values as JSON strings", () => {
        const command: PageCommand = { protocol: 1, type: "activate", payload: {} };
        const encoded = encodeDetail(command);
        expect(typeof encoded).toBe("string");
        expect(decodeDetail(encoded)).toEqual(command);
    });

    it("rejects non-string details", () => {
        expect(decodeDetail({ protocol: 1, type: "activate", payload: {} })).toBeUndefined();
        expect(decodeDetail(null)).toBeUndefined();
        expect(decodeDetail(undefined)).toBeUndefined();
        expect(decodeDetail(42)).toBeUndefined();
    });

    it("rejects malformed and oversized JSON", () => {
        expect(decodeDetail("{not json")).toBeUndefined();
        expect(decodeDetail("")).toBeUndefined();
        expect(decodeDetail(`"${"x".repeat(MAX_DETAIL_LENGTH)}"`)).toBeUndefined();
    });
});

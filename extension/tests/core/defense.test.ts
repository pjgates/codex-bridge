import { describe, expect, it } from "vitest";
import {
    defenseCandidates,
    formatCandidates,
    intersectCandidates,
} from "../../src/core/defense.js";

describe("defenseCandidates", () => {
    it.each([
        ["success", 12, 0, [{ min: 18, max: 27 }]],
        ["failure", 12, 0, [{ min: 28, max: 36 }]],
        ["criticalSuccess", 12, 0, [{ min: null, max: 17 }]],
        ["criticalFailure", 12, 0, [{ min: 37, max: null }]],
        ["criticalSuccess", 20, 0, [{ min: null, max: 27 }]],
        ["success", 20, 0, [{ min: 28, max: 36 }]],
        ["failure", 20, 0, [{ min: 37, max: null }]],
        ["failure", 1, 0, [{ min: 18, max: 27 }]],
        ["criticalFailure", 1, 0, [{ min: 28, max: null }]],
    ] as const)(
        "%s on natural %i maps total 27 to the correct range",
        (outcome, natural, degreeAdjustment, ranges) => {
            expect(defenseCandidates({
                total: 27,
                natural,
                outcome,
                degreeAdjustment,
            })).toEqual({ ranges, certainty: "inferred" });
        },
    );

    it("reverses a known additional degree adjustment", () => {
        expect(defenseCandidates({
            total: 27,
            natural: 12,
            outcome: "criticalSuccess",
            degreeAdjustment: 1,
        })).toEqual({
            ranges: [{ min: null, max: 27 }],
            certainty: "inferred",
        });
    });

    it("clamps the natural-die step before applying the extra adjustment", () => {
        expect(defenseCandidates({
            total: 27,
            natural: 20,
            outcome: "success",
            degreeAdjustment: -1,
        })).toEqual({
            ranges: [{ min: null, max: 27 }],
            certainty: "inferred",
        });
    });

    it("marks candidates possible when the adjustment is unknown", () => {
        expect(defenseCandidates({
            total: 27,
            natural: 12,
            outcome: "success",
            degreeAdjustment: null,
        }).certainty).toBe("possible");
    });

    it("produces the broad union when the adjustment is unknown", () => {
        const result = defenseCandidates({
            total: 27,
            natural: 12,
            outcome: "success",
            degreeAdjustment: null,
        });
        expect(result).toEqual({
            ranges: [{ min: null, max: null }],
            certainty: "possible",
        });
        expect(formatCandidates(result)).toBe("any defense");
    });

    it("returns no ranges for an impossible combination", () => {
        const result = defenseCandidates({
            total: 27,
            natural: 20,
            outcome: "criticalFailure",
            degreeAdjustment: 0,
        });
        expect(result).toEqual({ ranges: [], certainty: "inferred" });
        expect(formatCandidates(result)).toBe("no consistent value");
    });

    it("intersects observations and formats bounded results", () => {
        const first = { ranges: [{ min: 20, max: 29 }], certainty: "inferred" as const };
        const second = { ranges: [{ min: 25, max: 34 }], certainty: "inferred" as const };
        const result = intersectCandidates(first, second);
        expect(result).toEqual({
            ranges: [{ min: 25, max: 29 }],
            certainty: "inferred",
        });
        expect(formatCandidates(result!)).toBe("25–29");
    });

    it("intersects and merges multi-range sets", () => {
        const result = intersectCandidates(
            { ranges: [{ min: null, max: 17 }, { min: 28, max: null }], certainty: "possible" },
            { ranges: [{ min: 15, max: 30 }, { min: 35, max: 40 }], certainty: "inferred" },
        );
        expect(result).toEqual({
            ranges: [{ min: 15, max: 17 }, { min: 28, max: 30 }, { min: 35, max: 40 }],
            certainty: "possible",
        });
        expect(formatCandidates(result!)).toBe("15–17 or 28–30 or 35–40");

        expect(intersectCandidates(
            { ranges: [{ min: 10, max: 20 }, { min: 21, max: 30 }], certainty: "inferred" },
            { ranges: [{ min: null, max: null }], certainty: "inferred" },
        )).toEqual({ ranges: [{ min: 10, max: 30 }], certainty: "inferred" });
    });

    it("reports a contradiction instead of inventing a value", () => {
        expect(intersectCandidates(
            { ranges: [{ min: 20, max: 22 }], certainty: "inferred" },
            { ranges: [{ min: 25, max: 27 }], certainty: "inferred" },
        )).toBeNull();
    });
});

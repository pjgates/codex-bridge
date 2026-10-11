import type { Degree } from "../shared/protocol.js";

export interface IntegerRange {
    min: number | null;
    max: number | null;
}

export interface CandidateSet {
    ranges: IntegerRange[];
    certainty: "inferred" | "possible";
}

interface DefenseInput {
    total: number;
    natural: number;
    outcome: Degree;
    degreeAdjustment: number | null;
}

const DEGREES: Degree[] = ["criticalFailure", "failure", "success", "criticalSuccess"];

function indexOf(degree: Degree): number {
    return DEGREES.indexOf(degree);
}

function clampDegree(index: number): number {
    return Math.max(0, Math.min(3, index));
}

function baseRange(total: number, index: number): IntegerRange {
    switch (index) {
        case 0: return { min: total + 10, max: null };
        case 1: return { min: total + 1, max: total + 9 };
        case 2: return { min: total - 9, max: total };
        case 3: return { min: null, max: total - 10 };
        default: throw new Error(`Invalid degree index ${index}`);
    }
}

function compareMin(a: IntegerRange, b: IntegerRange): number {
    if (a.min === b.min) return 0;
    if (a.min === null) return -1;
    if (b.min === null) return 1;
    return a.min - b.min;
}

function mergeRanges(ranges: IntegerRange[]): IntegerRange[] {
    const sorted = [...ranges].sort(compareMin);
    const merged: IntegerRange[] = [];
    for (const range of sorted) {
        const previous = merged.at(-1);
        if (!previous || (previous.max ?? Infinity) + 1 < (range.min ?? -Infinity)) {
            merged.push({ ...range });
            continue;
        }
        previous.max = previous.max === null || range.max === null
            ? null
            : Math.max(previous.max, range.max);
    }
    return merged;
}

export function defenseCandidates(input: DefenseInput): CandidateSet {
    const naturalShift = input.natural === 20 ? 1 : input.natural === 1 ? -1 : 0;
    const adjustments = input.degreeAdjustment === null
        ? [-3, -2, -1, 0, 1, 2, 3]
        : [input.degreeAdjustment];
    const finalIndex = indexOf(input.outcome);
    const possibleBase = DEGREES
        .map((_degree, baseIndex) => baseIndex)
        .filter((baseIndex) => adjustments.some((adjustment) =>
            clampDegree(clampDegree(baseIndex + naturalShift) + adjustment) === finalIndex,
        ));
    const ranges = mergeRanges(possibleBase.map((baseIndex) => baseRange(input.total, baseIndex)));
    return {
        ranges,
        certainty: input.degreeAdjustment === null ? "possible" : "inferred",
    };
}

function overlap(left: IntegerRange, right: IntegerRange): IntegerRange | null {
    const min = Math.max(left.min ?? -Infinity, right.min ?? -Infinity);
    const max = Math.min(left.max ?? Infinity, right.max ?? Infinity);
    if (min > max) return null;
    return {
        min: Number.isFinite(min) ? min : null,
        max: Number.isFinite(max) ? max : null,
    };
}

export function intersectCandidates(left: CandidateSet, right: CandidateSet): CandidateSet | null {
    const ranges = mergeRanges(left.ranges.flatMap((a) =>
        right.ranges.map((b) => overlap(a, b)).filter((value): value is IntegerRange => value !== null),
    ));
    if (ranges.length === 0) return null;
    return {
        ranges,
        certainty: left.certainty === "possible" || right.certainty === "possible"
            ? "possible"
            : "inferred",
    };
}

export function formatCandidates(set: CandidateSet): string {
    if (set.ranges.length === 0) return "no consistent value";
    return set.ranges.map((range) => {
        if (range.min === null && range.max === null) return "any defense";
        if (range.min === range.max) return String(range.min);
        if (range.min === null) return `≤${range.max}`;
        if (range.max === null) return `≥${range.min}`;
        return `${range.min}–${range.max}`;
    }).join(" or ");
}

/**
 * SF2e creature-building benchmark tables (GM Core pg. 116–133, via the
 * campaign's sf2e-creature-building reference). Tables are indexed by
 * creature level −1…24 and keep ONLY the categories the source defines:
 * HP has no extreme/terrible, resist/weak is max/min, spell DC has no low.
 */

const LEVEL_MIN = -1;
const LEVEL_MAX = 24;

export type BenchmarkLabel =
    | "extreme"
    | "high"
    | "moderate"
    | "low"
    | "terrible"
    | "max"
    | "min";

export interface BenchmarkBand {
    label: BenchmarkLabel;
    /** Point benchmark (mutually exclusive with `range`). */
    at?: number | null;
    /** Inclusive [high, low] range benchmark. */
    range?: readonly [number, number];
}

export interface BenchmarkResult {
    label: BenchmarkLabel;
    /** True when the value sits exactly on a band; false when nearest-band. */
    exact: boolean;
    /** The level's reference bands, for tooltips. */
    bands: BenchmarkBand[];
}

type PointRow = readonly (number | null)[];

/** [extreme, high, moderate, low]; extreme null where the table has none */
// prettier-ignore
const ATTRIBUTES: PointRow[] = [
    [null, 3, 2, 0], [null, 3, 2, 0], [5, 4, 3, 1], [5, 4, 3, 1], [5, 4, 3, 1],
    [6, 5, 3, 2], [6, 5, 4, 2], [7, 5, 4, 2], [7, 6, 4, 2], [7, 6, 4, 3],
    [7, 6, 4, 3], [8, 7, 5, 3], [8, 7, 5, 3], [8, 7, 5, 4], [9, 8, 5, 4],
    [9, 8, 5, 4], [9, 8, 6, 4], [10, 9, 6, 5], [10, 9, 6, 5], [10, 9, 6, 5],
    [11, 10, 6, 5], [11, 10, 7, 6], [11, 10, 7, 6], [12, 10, 8, 6], [12, 10, 8, 6],
    [13, 12, 9, 7],
];

/** [extreme, high, moderate, low, terrible] — shared by Perception and saves */
// prettier-ignore
const PERCEPTION_AND_SAVES: PointRow[] = [
    [9, 8, 5, 2, 0], [10, 9, 6, 3, 1], [11, 10, 7, 4, 2], [12, 11, 8, 5, 3], [14, 12, 9, 6, 4],
    [15, 14, 11, 8, 6], [17, 15, 12, 9, 7], [18, 17, 14, 11, 8], [20, 18, 15, 12, 10], [21, 19, 16, 13, 11],
    [23, 21, 18, 15, 12], [24, 22, 19, 16, 14], [26, 24, 21, 18, 15], [27, 25, 22, 19, 16], [29, 26, 23, 20, 18],
    [30, 28, 25, 22, 19], [32, 29, 26, 23, 20], [33, 30, 28, 25, 22], [35, 32, 29, 26, 23], [36, 33, 30, 27, 24],
    [38, 35, 32, 29, 26], [39, 36, 33, 30, 27], [41, 38, 35, 32, 28], [43, 39, 36, 33, 30], [44, 40, 37, 34, 31],
    [46, 42, 38, 36, 32],
];

/** [extreme, high, moderate, [lowHi, lowLo]] */
// prettier-ignore
const SKILLS: (number | readonly [number, number])[][] = [
    [8, 5, 4, [2, 1]], [9, 6, 5, [3, 2]], [10, 7, 6, [4, 3]], [11, 8, 7, [5, 4]], [13, 10, 9, [7, 5]],
    [15, 12, 10, [8, 7]], [16, 13, 12, [10, 8]], [18, 15, 13, [11, 9]], [20, 17, 15, [13, 11]], [21, 18, 16, [14, 12]],
    [23, 20, 18, [16, 13]], [25, 22, 19, [17, 15]], [26, 23, 21, [19, 16]], [28, 25, 22, [20, 17]], [30, 27, 24, [22, 19]],
    [31, 28, 25, [23, 20]], [33, 30, 27, [25, 21]], [35, 32, 28, [26, 23]], [36, 33, 30, [28, 24]], [38, 35, 31, [29, 25]],
    [40, 37, 33, [31, 27]], [41, 38, 34, [32, 28]], [43, 40, 36, [34, 29]], [45, 42, 37, [35, 31]], [46, 43, 38, [36, 32]],
    [48, 45, 40, [38, 33]],
];

/** [extreme, high, moderate, low] */
// prettier-ignore
const AC: PointRow[] = [
    [18, 15, 14, 12], [19, 16, 15, 13], [19, 16, 15, 13], [21, 18, 17, 15], [22, 19, 18, 16],
    [24, 21, 20, 18], [25, 22, 21, 19], [27, 24, 23, 21], [28, 25, 24, 22], [30, 27, 26, 24],
    [31, 28, 27, 25], [33, 30, 29, 27], [34, 31, 30, 28], [36, 33, 32, 30], [37, 34, 33, 31],
    [39, 36, 35, 33], [40, 37, 36, 34], [42, 39, 38, 36], [43, 40, 39, 37], [45, 42, 41, 39],
    [46, 43, 42, 40], [48, 45, 44, 42], [49, 46, 45, 43], [51, 48, 47, 45], [52, 49, 48, 46],
    [54, 51, 50, 48],
];

/** [[highHi, highLo], [modHi, modLo], [lowHi, lowLo]] */
// prettier-ignore
const HP: (readonly [number, number])[][] = [
    [[9, 9], [8, 7], [6, 5]], [[20, 17], [16, 14], [13, 11]], [[26, 24], [21, 19], [16, 14]],
    [[40, 36], [32, 28], [25, 21]], [[59, 53], [48, 42], [37, 31]], [[78, 72], [63, 57], [48, 42]],
    [[97, 91], [78, 72], [59, 53]], [[123, 115], [99, 91], [75, 67]], [[148, 140], [119, 111], [90, 82]],
    [[173, 165], [139, 131], [105, 97]], [[198, 190], [159, 151], [120, 112]], [[223, 215], [179, 171], [135, 127]],
    [[248, 240], [199, 191], [150, 142]], [[273, 265], [219, 211], [165, 157]], [[298, 290], [239, 231], [180, 172]],
    [[323, 315], [259, 251], [195, 187]], [[348, 340], [279, 271], [210, 202]], [[373, 365], [299, 291], [225, 217]],
    [[398, 390], [319, 311], [240, 232]], [[423, 415], [339, 331], [255, 247]], [[448, 440], [359, 351], [270, 262]],
    [[473, 465], [379, 371], [285, 277]], [[505, 495], [405, 395], [305, 295]], [[544, 532], [436, 424], [329, 317]],
    [[581, 569], [466, 454], [351, 339]], [[633, 617], [508, 492], [383, 367]],
];

/** [max, min] */
// prettier-ignore
const RESIST_WEAK: PointRow[] = [
    [1, 1], [3, 1], [3, 2], [5, 2], [6, 3], [7, 4], [8, 4], [9, 5], [10, 5], [11, 6],
    [12, 6], [13, 7], [14, 7], [15, 8], [16, 8], [17, 9], [18, 9], [19, 9], [19, 10], [20, 10],
    [21, 11], [22, 11], [23, 12], [24, 12], [25, 13], [26, 13],
];

/** [extreme, high, moderate, low] */
// prettier-ignore
const STRIKE_ATTACK: PointRow[] = [
    [10, 8, 6, 4], [10, 8, 6, 4], [11, 9, 7, 5], [13, 11, 9, 7], [14, 12, 10, 8],
    [16, 14, 12, 9], [17, 15, 13, 11], [19, 17, 15, 12], [20, 18, 16, 13], [22, 20, 18, 15],
    [23, 21, 19, 16], [25, 23, 21, 17], [27, 24, 22, 19], [28, 26, 24, 20], [29, 27, 25, 21],
    [31, 29, 27, 23], [32, 30, 28, 24], [34, 32, 30, 25], [35, 33, 31, 27], [37, 35, 33, 28],
    [38, 36, 34, 29], [40, 38, 36, 31], [41, 39, 37, 32], [43, 41, 39, 33], [44, 42, 40, 35],
    [46, 44, 42, 36],
];

/** average damage: [extreme, high, moderate, low] */
// prettier-ignore
const STRIKE_DAMAGE: PointRow[] = [
    [4, 3, 3, 2], [6, 5, 4, 3], [8, 6, 5, 4], [11, 9, 8, 6], [15, 12, 10, 8],
    [18, 14, 12, 9], [20, 16, 13, 11], [23, 18, 15, 12], [25, 20, 17, 13], [28, 22, 18, 15],
    [30, 24, 20, 16], [33, 26, 22, 17], [35, 28, 23, 19], [38, 30, 25, 20], [40, 32, 27, 21],
    [43, 34, 28, 23], [45, 36, 30, 24], [48, 37, 31, 25], [50, 38, 32, 26], [53, 40, 33, 27],
    [55, 42, 35, 28], [58, 44, 37, 29], [60, 46, 38, 31], [63, 48, 40, 32], [65, 50, 42, 33],
    [68, 52, 44, 35],
];

/** [extreme, high, moderate] — no low/terrible defined */
// prettier-ignore
const SPELL_DC: PointRow[] = [
    [19, 16, 13], [19, 16, 13], [20, 17, 14], [22, 18, 15], [23, 20, 17],
    [25, 21, 18], [26, 22, 19], [27, 24, 21], [29, 25, 22], [30, 26, 23],
    [32, 28, 25], [33, 29, 26], [34, 30, 27], [36, 32, 29], [37, 33, 30],
    [39, 34, 31], [40, 36, 33], [41, 37, 34], [43, 38, 35], [44, 40, 37],
    [46, 41, 38], [47, 42, 39], [48, 44, 41], [50, 45, 42], [51, 46, 43],
    [52, 48, 45],
];

function row<T>(table: readonly (readonly T[])[], level: number): readonly T[] {
    const clamped = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, level));
    return table[clamped + 1];
}

/**
 * Classify `value` against ordered benchmark bands: exact containment first,
 * otherwise the nearest band (ties resolve to the stronger band).
 */
function classify(value: number, bands: BenchmarkBand[]): BenchmarkResult {
    const defined = bands.filter((b) => b.at != null || b.range != null);
    for (const b of defined) {
        if (b.range && value <= b.range[0] && value >= b.range[1]) return { label: b.label, exact: true, bands };
        if (b.at != null && b.at === value) return { label: b.label, exact: true, bands };
    }
    let best = defined[0];
    let bestDistance = Infinity;
    for (const b of defined) {
        const reference = b.range ? (value > b.range[0] ? b.range[0] : b.range[1]) : b.at!;
        const distance = Math.abs(value - reference);
        if (distance < bestDistance) {
            best = b;
            bestDistance = distance;
        }
    }
    return { label: best.label, exact: false, bands };
}

function labeled(labels: BenchmarkLabel[], values: readonly (number | null | readonly [number, number])[]): BenchmarkBand[] {
    return labels.map((label, i) => {
        const value = values[i];
        return Array.isArray(value) ? { label, range: value as readonly [number, number] } : { label, at: value as number | null };
    });
}

const EHML: BenchmarkLabel[] = ["extreme", "high", "moderate", "low"];
const EHMLT: BenchmarkLabel[] = [...EHML, "terrible"];

/** Benchmark classifiers, one per GM Core table. */
export const benchmark = {
    attribute: (v: number, level: number): BenchmarkResult => classify(v, labeled(EHML, row(ATTRIBUTES, level))),
    perception: (v: number, level: number): BenchmarkResult => classify(v, labeled(EHMLT, row(PERCEPTION_AND_SAVES, level))),
    save: (v: number, level: number): BenchmarkResult => classify(v, labeled(EHMLT, row(PERCEPTION_AND_SAVES, level))),
    skill: (v: number, level: number): BenchmarkResult => classify(v, labeled(EHML, row(SKILLS, level))),
    ac: (v: number, level: number): BenchmarkResult => classify(v, labeled(EHML, row(AC, level))),
    hp: (v: number, level: number): BenchmarkResult => classify(v, labeled(["high", "moderate", "low"], row(HP, level))),
    resistWeak: (v: number, level: number): BenchmarkResult => classify(v, labeled(["max", "min"], row(RESIST_WEAK, level))),
    strikeAttack: (v: number, level: number): BenchmarkResult => classify(v, labeled(EHML, row(STRIKE_ATTACK, level))),
    strikeDamage: (avg: number, level: number): BenchmarkResult => classify(avg, labeled(EHML, row(STRIKE_DAMAGE, level))),
    spellDC: (v: number, level: number): BenchmarkResult => classify(v, labeled(["extreme", "high", "moderate"], row(SPELL_DC, level))),
};

/** Average roll of a damage formula like "2d10+9" (floored). */
export function averageDamage(formula: string): number {
    let total = 0;
    for (const match of formula.matchAll(/(\d+)d(\d+)|([+-]?\s*\d+)/g)) {
        if (match[1]) total += Number(match[1]) * (Number(match[2]) + 1) / 2;
        else total += Number(match[3].replace(/\s+/g, ""));
    }
    return Math.floor(total);
}

import type { Bounds, Point } from "./geometry.js";

/** Axial coordinates of the fixed scene lattice. */
export interface Hex {
    q: number;
    r: number;
}

/** Neighbour offsets in bearing order, starting east. */
export const HEX_DIRECTIONS: readonly Hex[] = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

const ROOT_THREE = Math.sqrt(3);

/** Pointy-top cells where `size` is the centre-to-centre step (6 inches of game distance). */
export function hexCentre(hex: Hex, size: number): Point {
    return { x: size * (hex.q + hex.r / 2), y: (ROOT_THREE / 2) * size * hex.r };
}

export function hexAt(point: Point, size: number): Hex {
    const r = 2 * point.y / (ROOT_THREE * size);
    const q = point.x / size - r / 2;
    const roundedQ = Math.round(q), roundedR = Math.round(r);
    const dq = Math.abs(roundedQ - q), dr = Math.abs(roundedR - r), dy = Math.abs(-roundedQ - roundedR - (-q - r));
    // Cube rounding keeps q + r + s = 0; the axis with the largest error yields to the other two.
    if (dq > dr && dq > dy) return { q: -roundedR - Math.round(-q - r), r: roundedR };
    if (dr > dy) return { q: roundedQ, r: -roundedQ - Math.round(-q - r) };
    return { q: roundedQ, r: roundedR };
}

export function hexNeighbour(hex: Hex, direction: number): Hex {
    const offset = HEX_DIRECTIONS[((direction % 6) + 6) % 6];
    return { q: hex.q + offset.q, r: hex.r + offset.r };
}

/** Cell steps between two cells; every neighbour is one step away. */
export function hexDistance(a: Hex, b: Hex): number {
    const dq = a.q - b.q, dr = a.r - b.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

/** Corners of a cell, starting at 30°; shared corners match exactly between neighbours. */
export function hexCorners(hex: Hex, size: number): Point[] {
    const centre = hexCentre(hex, size), radius = size / ROOT_THREE;
    const corners: Point[] = [];
    for (let index = 0; index < 6; index++) {
        const angle = Math.PI / 6 + index * Math.PI / 3;
        corners.push({ x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) });
    }
    return corners;
}

/** Axial index range covering a scene rectangle, with one cell of slack per side. */
export function hexRange(bounds: Bounds, size: number): { qMin: number; qMax: number; rMin: number; rMax: number } {
    let qMin = Infinity, qMax = -Infinity, rMin = Infinity, rMax = -Infinity;
    for (const x of [bounds.x, bounds.x + bounds.width]) {
        for (const y of [bounds.y, bounds.y + bounds.height]) {
            const cell = hexAt({ x, y }, size);
            qMin = Math.min(qMin, cell.q); qMax = Math.max(qMax, cell.q);
            rMin = Math.min(rMin, cell.r); rMax = Math.max(rMax, cell.r);
        }
    }
    // Axial indices are linear in the pixel coordinates, so the corners bound the range.
    return { qMin: qMin - 1, qMax: qMax + 1, rMin: rMin - 1, rMax: rMax + 1 };
}

import { allFloors, surfaceBelow } from "../gridless/index.js";

/** A token's height above the surface it would land on: the floor below across every level, else the level's base. */
export function heightAbove(elevation: number, surface: number | null, levelBase: number): number {
    return Math.round((elevation - (surface ?? levelBase)) * 100) / 100;
}

// Foundry 14 shapes not represented by fvtt-types.
export interface HeightToken {
    x: number; y: number; elevation: number;
    parent: { regions: Iterable<unknown>; levels: { get(id: string): { elevation: { base: number } } | undefined } } | null;
    level: string;
    object?: { center: { x: number; y: number } } | null;
}

export function landingSurface(token: HeightToken, elevation = token.elevation): { surface: number | null; base: number } {
    const scene = token.parent;
    const base = scene?.levels.get(token.level)?.elevation.base ?? 0;
    if (!scene) return { surface: null, base };
    const point = token.object?.center ?? { x: token.x, y: token.y };
    return { surface: surfaceBelow(allFloors(scene as Parameters<typeof allFloors>[0]), point, elevation), base };
}

export function tokenHeight(token: HeightToken): number {
    const { surface, base } = landingSurface(token);
    return heightAbove(token.elevation, surface, base);
}

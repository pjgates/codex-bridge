import type { Point } from "./geometry.js";
import { allFloors, allWater, surfaceBelow, waterAt, type Floor, type Water } from "./floors.js";
import { absoluteElevationHeld, onAbsoluteElevationChange } from "./elevation-key.js";

export interface TooltipToken { id: string; center: Point; document: { elevation: number } }

/** What a token's label measures: scene elevation, height over the ground or water below it, or height relative to the reference token. */
export type ReadingKind = "absolute" | "ground" | "waterAbove" | "waterBelow" | "relative";
export interface Reading { value: number; kind: ReadingKind }

/** Labels over the ground and water use their own colours so players can tell them from plain relative heights. */
export const GROUND_COLOR = "#7ee787";
export const WATER_COLOR = "#79c0ff";
const EPSILON = 1e-6;

/** The token heights are read against: the single controlled token, else the user's character on the scene. */
export function referenceToken<T extends TooltipToken>(controlled: readonly T[], characterTokens: readonly T[]): T | null {
    if (controlled.length === 1) return controlled[0];
    return characterTokens[0] ?? null;
}

/**
 * What a token's tooltip shows: scene-absolute elevation while the key is held; the reference
 * token's height above the water or floor beneath it (any level), or its depth below a water
 * surface; every other token's height relative to the reference. Null defers to Foundry.
 */
export function tooltipReading(token: TooltipToken, floors: readonly Floor[], water: readonly Water[],
    reference: TooltipToken | null, absolute: boolean): Reading | null {
    const elevation = token.document.elevation;
    if (absolute) return { value: elevation, kind: "absolute" };
    if (reference && reference.id !== token.id) return { value: elevation - reference.document.elevation, kind: "relative" };
    const pool = waterAt(water, token.center);
    if (pool && elevation >= pool.bed - EPSILON) {
        const value = elevation - pool.surface;
        return { value, kind: value > EPSILON ? "waterAbove" : "waterBelow" };
    }
    const surface = surfaceBelow(floors, token.center, elevation);
    return surface === null ? null : { value: elevation - surface, kind: "ground" };
}

export const round = (value: number): number => Math.round(value * 100) / 100;
export const signed = (value: number): string => (value > 0 ? "+" : "") + String(value);

/** The label text for a reading, or "" when there is nothing to say. */
export function readingText(reading: Reading, units: string): string {
    const value = round(reading.value);
    if (value === 0) return "";
    const plain = `${signed(value)} ${units}`.trim();
    switch (reading.kind) {
        case "ground": return game.i18n!.format("codex-foundry.gridless.aboveGround", { value: plain });
        case "waterAbove": return game.i18n!.format("codex-foundry.gridless.aboveWater", { value: plain });
        case "waterBelow": return game.i18n!.format("codex-foundry.gridless.belowSurface", { value: `${Math.abs(value)} ${units}`.trim() });
        default: return plain;
    }
}

export function readingColor(kind: ReadingKind | undefined): string | null {
    if (kind === "ground") return GROUND_COLOR;
    if (kind === "waterAbove" || kind === "waterBelow") return WATER_COLOR;
    return null;
}

interface TooltipPlaceable extends TooltipToken {
    actor: object | null;
    document: { elevation: number; parent: object };
    renderFlags: { set(flags: { refreshTooltip: boolean }): void };
    tooltip: { style: { fill: unknown } };
}
interface TokenClass { prototype: { _getTooltipText(): string; _refreshTooltip(): void } }

export function currentReference(): TooltipPlaceable | null {
    const tokens = canvas!.tokens as unknown as { controlled: TooltipPlaceable[]; placeables: TooltipPlaceable[] };
    const character = game.user!.character as object | null;
    return referenceToken(tokens.controlled, character ? tokens.placeables.filter(token => token.actor === character) : []);
}

export function refreshTooltips(): void {
    if (!canvas?.ready) return;
    for (const token of (canvas.tokens as unknown as { placeables: TooltipPlaceable[] }).placeables) token.renderFlags.set({ refreshTooltip: true });
}

/** Floor-relative and reference-relative token tooltips on scenes with map-workshop floors, gridless or not. */
export function activateElevationTooltip(): void {
    const tokenClass = CONFIG.Token.objectClass as unknown as TokenClass;
    const nativeText = tokenClass.prototype._getTooltipText;
    const nativeRefresh = tokenClass.prototype._refreshTooltip;
    // The kind each token last read, so the refresh can colour the label the text was built for.
    const kinds = new WeakMap<object, ReadingKind>();
    tokenClass.prototype._getTooltipText = function (this: TooltipPlaceable): string {
        kinds.delete(this);
        const scene = this.document.parent as Parameters<typeof allFloors>[0];
        const floors = allFloors(scene);
        if (!floors.length) return nativeText.call(this);
        const reading = tooltipReading(this, floors, allWater(scene), currentReference(), absoluteElevationHeld());
        if (!reading) return nativeText.call(this);
        kinds.set(this, reading.kind);
        return readingText(reading, canvas!.grid!.units);
    };
    tokenClass.prototype._refreshTooltip = function (this: TooltipPlaceable): void {
        nativeRefresh.call(this);
        const color = readingColor(kinds.get(this));
        if (color) this.tooltip.style.fill = color;
    };
    // Other tokens' labels depend on the reference token, so any change refreshes them all.
    const hooks = Hooks as unknown as { on(name: string, callback: (...args: never[]) => unknown): void };
    hooks.on("controlToken", refreshTooltips);
    hooks.on("updateToken", ((_document: object, changes: Record<string, unknown>) => {
        if ("elevation" in changes || "level" in changes) refreshTooltips();
    }) as never);
    onAbsoluteElevationChange(refreshTooltips);
}

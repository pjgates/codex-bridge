import type { Point } from "./geometry.js";
import { allFloors, surfaceBelow, type Floor } from "./floors.js";
import { absoluteElevationHeld, onAbsoluteElevationChange } from "./elevation-key.js";

export interface TooltipToken { id: string; center: Point; document: { elevation: number } }

/** The token heights are read against: the single controlled token, else the user's character on the scene. */
export function referenceToken<T extends TooltipToken>(controlled: readonly T[], characterTokens: readonly T[]): T | null {
    if (controlled.length === 1) return controlled[0];
    return characterTokens[0] ?? null;
}

/**
 * The number a token's tooltip shows: scene-absolute elevation while the key is held; the
 * reference token's height above the surface below it (any level); every other token's height
 * relative to the reference. Null defers to Foundry's native text.
 */
export function tooltipElevation(token: TooltipToken, floors: readonly Floor[], reference: TooltipToken | null, absolute: boolean): number | null {
    const elevation = token.document.elevation;
    if (absolute) return elevation;
    if (reference && reference.id !== token.id) return elevation - reference.document.elevation;
    const surface = surfaceBelow(floors, token.center, elevation);
    return surface === null ? null : elevation - surface;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const signed = (value: number): string => (value > 0 ? "+" : "") + String(value);

interface TooltipPlaceable extends TooltipToken {
    actor: object | null;
    document: { elevation: number; parent: object };
    renderFlags: { set(flags: { refreshTooltip: boolean }): void };
}
interface TokenClass { prototype: { _getTooltipText(): string } }

function currentReference(): TooltipPlaceable | null {
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
    const native = tokenClass.prototype._getTooltipText;
    tokenClass.prototype._getTooltipText = function (this: TooltipPlaceable): string {
        const floors = allFloors(this.document.parent as Parameters<typeof allFloors>[0]);
        if (!floors.length) return native.call(this);
        const value = tooltipElevation(this, floors, currentReference(), absoluteElevationHeld());
        if (value === null) return native.call(this);
        const elevation = round(value);
        return elevation === 0 ? "" : `${signed(elevation)} ${canvas!.grid!.units}`.trim();
    };
    // Other tokens' labels depend on the reference token, so any change refreshes them all.
    const hooks = Hooks as unknown as { on(name: string, callback: (...args: never[]) => unknown): void };
    hooks.on("controlToken", refreshTooltips);
    hooks.on("updateToken", ((_document: object, changes: Record<string, unknown>) => {
        if ("elevation" in changes || "level" in changes) refreshTooltips();
    }) as never);
    onAbsoluteElevationChange(refreshTooltips);
}

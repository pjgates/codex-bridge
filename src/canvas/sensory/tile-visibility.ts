import { sensoryFlag } from "./definition.js";
import type { SensoryItem, SensoryUser } from "./types.js";

interface VisibilityActor {
    type: string;
    items: Iterable<SensoryItem>;
    testUserPermission(user: SensoryUser, permission: "OWNER"): boolean;
}
interface VisibilityTile {
    document: { flags: unknown };
    mesh: { unoccludedAlpha: number; occludedAlpha: number } | null;
    renderFlags: { set(flags: { refreshMesh: true }): unknown };
}
interface VisibilityCanvas {
    tiles: { placeables: VisibilityTile[] };
    tokens: { controlled: { document: { actor: VisibilityActor | null } }[] };
}

const gated = new WeakSet<object>();
let registered: typeof Hooks | null = null;

function positiveRank(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function qualifies(tile: VisibilityTile): boolean {
    const raw = sensoryFlag(tile.document.flags, "sensoryVisibility");
    if (raw === undefined) return true;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const { effectUuid, minRank } = raw as Record<string, unknown>;
    if (effectUuid === "") return true;
    if (typeof effectUuid !== "string" || !positiveRank(minRank)) return false;
    const match = /^Item\.([^.]+)$/.exec(effectUuid);
    if (!match) return false;
    const definition = game.items?.get(match[1]);
    if (!definition || definition.uuid !== effectUuid || definition.isEmbedded || definition.pack
        || String(definition.type) !== "effect" || !game.user || !canvas?.ready) return false;
    const native = canvas as unknown as VisibilityCanvas;
    return native.tokens.controlled.some(({ document: { actor } }) => {
        if (actor?.type !== "character" || !actor.testUserPermission(game.user as SensoryUser, "OWNER")) return false;
        for (const application of actor.items) {
            if (application.type !== "effect" || application.isExpired) continue;
            const explicit = sensoryFlag(application.flags, "sensoryDefinition");
            const reference = explicit === undefined ? application.sourceId : explicit;
            const rank = application.badge?.type === "counter" ? application.badge.value : 1;
            if (reference === effectUuid && positiveRank(rank) && rank >= minRank) return true;
        }
        return false;
    });
}

function applyGate(tile: VisibilityTile, nativeMeshRefreshed = false): void {
    const mesh = tile.mesh;
    if (!mesh) return;
    if (!qualifies(tile)) {
        // Both color-shader alphas must be zero; visibility/renderable also suppress native depth restrictions.
        mesh.unoccludedAlpha = mesh.occludedAlpha = 0;
        gated.add(mesh);
    } else if (nativeMeshRefreshed) gated.delete(mesh);
    else if (gated.has(mesh)) tile.renderFlags.set({ refreshMesh: true });
}

/** Close denied artwork immediately; let native refresh restore current opacity when a condition clears. */
export function refreshSensoryTileVisibility(): void {
    if (!canvas?.ready) return;
    for (const tile of (canvas as unknown as VisibilityCanvas).tiles.placeables) applyGate(tile);
}

/** Native refreshTile runs after Tile._refreshMesh; this hook never schedules another refresh for a denied tile. */
export function installSensoryTileVisibility(): void {
    if (registered === Hooks) return;
    registered = Hooks;
    Hooks.on("refreshTile", (tile, flags: Record<string, boolean> = {}) => applyGate(tile as VisibilityTile, !!flags.refreshMesh));
    Hooks.on("drawTile", tile => applyGate(tile as VisibilityTile));
}

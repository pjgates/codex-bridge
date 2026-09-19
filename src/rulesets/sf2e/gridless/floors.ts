import { MODULE_ID } from "../../../constants.js";
import type { Point } from "./geometry.js";
import { planElevationPath, STEP_FEET, type ElevationWaypoint, type FloorCrossing } from "./elevation.js";

/** Region behaviour type registered by the map-workshop importer; its `elevation` field is the floor height in feet. */
export const SET_ELEVATION_TYPE = "map-workshop-importer.setElevation";
export const SETTING_ENFORCE_CLIMB = "enforceClimb";
const REWRITTEN = `${MODULE_ID}Rewritten`;

// Foundry 14 region and movement shapes not yet represented by fvtt-types.
interface FloorRegion {
    levels: Set<string>;
    behaviors: Iterable<{ type: string; disabled: boolean; system: { elevation?: number } }>;
    polygonTree: { testPoint(point: Point): boolean };
}
interface FloorScene { regions: Iterable<FloorRegion>; initialLevel?: { id: string } | null; _source: { initialLevel?: string } }
interface MovementOrigin extends Point { elevation: number; width: number; height: number; depth?: number; shape: number }
interface FloorToken {
    name: string;
    parent: FloorScene | null;
    _source: { x: number; y: number; level: string; width: number; height: number; depth: number; shape: number };
    getMovementOrigin(position: Partial<MovementOrigin>): Point;
    move(waypoints: object[], options: Record<string, unknown>): unknown;
    updateSource(changes: object): void;
}
interface PendingMovement {
    origin: MovementOrigin;
    passed: { waypoints: (ElevationWaypoint & { level?: string })[] };
    showRuler?: boolean; autoRotate?: boolean; method?: string;
    constrainOptions?: object; terrainOptions?: object; measureOptions?: object;
}

export interface Floor { region: FloorRegion; floor: number }

export function floorRegions(scene: FloorScene, levelId: string): Floor[] {
    const out: Floor[] = [];
    for (const region of scene.regions) {
        if (!region.levels.has(levelId)) continue;
        for (const behavior of region.behaviors) {
            if (behavior.type !== SET_ELEVATION_TYPE || behavior.disabled) continue;
            out.push({ region, floor: behavior.system.elevation ?? 0 });
            break;
        }
    }
    return out;
}

/** The floor height under a movement origin, from the floor regions on that level. */
export function floorUnder(token: FloorToken, floors: readonly Floor[], position: Partial<MovementOrigin>): number | null {
    const origin = token.getMovementOrigin(position);
    const hit = floors.find(({ region }) => region.polygonTree.testPoint({ x: origin.x, y: origin.y }));
    return hit ? hit.floor : null;
}

/** Sampling step along a leg when tracing floor footprints, in scene pixels; half a lattice cell. */
const FLOOR_SAMPLE_STEP = 5;

/**
 * Where a path enters and leaves each floor footprint, as the elevation planner expects. Traced
 * geometrically along the path rather than with Foundry's region segmentiser, which gates on the
 * region's elevation band and so never sees a tread the token is not already standing on.
 */
export function floorCrossings(token: FloorToken, floors: readonly Floor[], path: Point[]): FloorCrossing[] {
    const crossings: FloorCrossing[] = [];
    if (path.length < 2 || !floors.length) return crossings;
    const floorAt = (point: Point): Floor | undefined => {
        const origin = token.getMovementOrigin({ ...path[0], ...point });
        return floors.find(({ region }) => region.polygonTree.testPoint({ x: origin.x, y: origin.y }));
    };
    let current = floorAt(path[0]);
    let open: FloorCrossing | null = null;
    let previous: Point = path[0];
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(length / FLOOR_SAMPLE_STEP));
        for (let step = 1; step <= steps; step++) {
            const point = { x: a.x + (b.x - a.x) * step / steps, y: a.y + (b.y - a.y) * step / steps };
            const floor = floorAt(point);
            if (floor !== current) {
                if (open) { open.exit = point; open = null; }
                if (floor) { open = { floor: floor.floor, from: previous, to: point }; crossings.push(open); }
                current = floor;
            }
            previous = point;
        }
    }
    return crossings;
}

export function climbsEnforced(): boolean {
    return !!game.settings!.get(MODULE_ID, SETTING_ENFORCE_CLIMB);
}

/** Rewrite the pending path so the token takes each floor's height where it enters the footprint, or stop it where a climb is refused. */
function onPreMoveToken(token: FloorToken, movement: PendingMovement, options?: Record<string, unknown>): boolean {
    if (options?.[REWRITTEN]) return true;
    // At this point the whole requested path sits in `passed`; `pending` fills later.
    const waypoints = movement.passed.waypoints;
    if (!waypoints.length || waypoints.some(w => w.action === "displace" || (w.level && w.level !== token._source.level))) return true;
    const floors = token.parent ? floorRegions(token.parent, token._source.level) : [];
    if (!floors.length) return true;
    // Measure from the floor the token stands on, not from a possibly stale record.
    const standing = floorUnder(token, floors, movement.origin);
    const start = { ...movement.origin, elevation: standing ?? movement.origin.elevation };
    const crossings = floorCrossings(token, floors, [start, ...waypoints]);
    const plan = planElevationPath({ start, waypoints, crossings, tokenElevation: movement.origin.elevation, enforceClimb: climbsEnforced() });
    if (!plan) return true;
    if (plan.blocked) {
        ui.notifications!.warn(game.i18n!.format("codex-foundry.floors.climbRefused", {
            name: token.name, rise: String(plan.blocked.rise), step: String(STEP_FEET),
        }));
    }
    if (!plan.waypoints.length) return false;
    // The ruler and animation options carry over; walls are still respected.
    void token.move(plan.waypoints, { [REWRITTEN]: true, showRuler: movement.showRuler, autoRotate: movement.autoRotate,
        method: movement.method, constrainOptions: movement.constrainOptions, terrainOptions: movement.terrainOptions,
        measureOptions: movement.measureOptions });
    return false;
}

/** A token dropped onto the map lands at the floor under it. */
function onPreCreateToken(token: FloorToken, data: { elevation?: number; level?: string }): void {
    const scene = token.parent;
    if (!scene || (data.elevation !== undefined && data.elevation !== 0)) return;
    const level = data.level ?? scene.initialLevel?.id ?? scene._source.initialLevel;
    if (!level) return;
    const floors = floorRegions(scene, level);
    if (!floors.length) return;
    const { x, y, width, height, depth, shape } = token._source;
    const floor = floorUnder(token, floors, { x, y, elevation: 0, width, height, depth, shape });
    if (floor !== null) token.updateSource({ elevation: floor });
}

export function registerFloorSetting(): void {
    game.settings!.register(MODULE_ID, SETTING_ENFORCE_CLIMB, {
        name: "codex-foundry.settings.enforceClimb.name",
        hint: "codex-foundry.settings.enforceClimb.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
    });
}

/** Floor heights apply on every scene that carries map-workshop floor regions, gridless or not. */
export function activateFloorElevation(): void {
    // Foundry 14's preMoveToken hook is not yet declared by fvtt-types.
    const hooks = Hooks as unknown as { on(name: string, callback: (...args: never[]) => unknown): void };
    hooks.on("preMoveToken", onPreMoveToken);
    hooks.on("preCreateToken", onPreCreateToken);
}

/**
 * Planned floor height at each waypoint of a chain that starts at the token's origin, plus the
 * index of the first waypoint a refused climb keeps the token from reaching, if any.
 */
export function plannedElevations(token: FloorToken, floors: readonly Floor[], chain: readonly ElevationWaypoint[],
    enforceClimb: boolean): { elevations: number[]; refusedFrom: number | null } {
    const [head, ...rest] = chain;
    const start = { ...head, elevation: floorUnder(token, floors, head) ?? head.elevation };
    const crossings = floorCrossings(token, floors, [start, ...rest]);
    const plan = planElevationPath({ start, waypoints: rest, crossings, tokenElevation: head.elevation, enforceClimb });
    const elevations = [start.elevation, ...rest.map(waypoint => waypoint.elevation)];
    if (!plan) return { elevations, refusedFrom: null };
    let index = 1;
    for (const point of plan.waypoints) {
        if (index < chain.length && point.x === chain[index].x && point.y === chain[index].y) elevations[index++] = point.elevation;
    }
    if (!plan.blocked) return { elevations, refusedFrom: null };
    // Past the ledge the token stays at the height it was refused at.
    const held = plan.waypoints.at(-1)?.elevation ?? start.elevation;
    for (let i = index; i < chain.length; i++) elevations[i] = held;
    return { elevations, refusedFrom: index };
}

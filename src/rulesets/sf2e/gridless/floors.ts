import { isFloorType, isWaterType, selectSupport, type PolygonNode } from "../../../canvas/regions/index.js";
import { MODULE_ID } from "../../../constants.js";
import type { Point } from "./geometry.js";

/** Region behaviour type registered by the map-workshop importer; its `elevation` field is the floor height in feet. */
export const SET_ELEVATION_TYPE = "map-workshop-importer.setElevation";
/** Marker behaviour on map-workshop water regions; the region's elevation band runs from the bed to the surface. */
export const WATER_TYPE = "map-workshop-importer.water";
export const SETTING_ENFORCE_CLIMB = "enforceClimb";

// Foundry 14 region and movement shapes not yet represented by fvtt-types.
interface FloorRegion {
    levels: Set<string>;
    behaviors: Iterable<{ type: string; disabled: boolean; system: { elevation?: number } }>;
    polygonTree: PolygonNode;
    elevation?: { bottom: number; top: number };
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
export interface Floor { region: FloorRegion; floor: number }

export function floorRegions(scene: FloorScene, levelId: string): Floor[] {
    return allFloors(scene).filter(({ region }) => (!region.levels.size || region.levels.has(levelId)));
}

/** Every setElevation floor on the scene, whatever level it belongs to. */
export function allFloors(scene: Pick<FloorScene, "regions">): Floor[] {
    const out: Floor[] = [];
    for (const region of scene.regions) {
        for (const behavior of region.behaviors) {
            if (!isFloorType(behavior.type) || behavior.disabled) continue;
            out.push({ region, floor: behavior.system.elevation ?? 0 });
            break;
        }
    }
    return out;
}

export interface Water { region: FloorRegion; surface: number; bed: number }

/** Every marked water region on the scene with a finite surface, whatever level it belongs to. */
export function allWater(scene: Pick<FloorScene, "regions">): Water[] {
    const out: Water[] = [];
    for (const region of scene.regions) {
        const band = region.elevation;
        if (!band || !Number.isFinite(band.top)) continue;
        for (const behavior of region.behaviors) {
            if (!isWaterType(behavior.type) || behavior.disabled) continue;
            out.push({ region, surface: band.top, bed: band.bottom });
            break;
        }
    }
    return out;
}

/** The water with the highest surface under a point, or null on dry ground. */
export function waterAt(water: readonly Water[], point: Point): Water | null {
    let best: Water | null = null;
    for (const candidate of water) {
        if ((best && candidate.surface <= best.surface) || !candidate.region.polygonTree.testPoint(point)) continue;
        best = candidate;
    }
    return best;
}

/**
 * The height of the highest floor under a point that is at or below `elevation`: the surface
 * something at that height would land on, across every level. Without an elevation, the top
 * floor at the point. Null when no floor lies there.
 */
export function surfaceBelow(floors: readonly Floor[], point: Point, elevation = Infinity): number | null {
    const candidates = floors.filter(({region}) => region.polygonTree.testPoint(point)).map(({floor}, index) =>
        ({regionId: String(index), elevation: floor, levelIds: []}));
    const selected = selectSupport(candidates, elevation, "");
    return selected.kind === "surface" ? selected.support.elevation : selected.kind === "ambiguous" ? selected.candidates[0].elevation : null;
}

/** The floor height under a movement origin, from the floor regions on that level. */
export function floorUnder(token: FloorToken, floors: readonly Floor[], position: Partial<MovementOrigin>): number | null {
    const origin = token.getMovementOrigin(position);
    const hit = floors.find(({ region }) => region.polygonTree.testPoint({ x: origin.x, y: origin.y }));
    return hit ? hit.floor : null;
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
        config: false,
        type: Boolean,
        default: false,
    });
}

/** Placement stays independent from the movement transition owner. */
export function activateFloorElevation():void {
    const hooks=Hooks as unknown as {on(name:string,callback:(...args:never[])=>unknown):void};
    hooks.on("preCreateToken",onPreCreateToken);
}

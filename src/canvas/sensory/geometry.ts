import { MODULE_ID } from "../../constants.js";
import { clipRegionId, clipRings, type TreeNode } from "../clip-tiles/index.js";
import { readTileBindings, resolveApplications, sensoryFlag } from "./definition.js";
import type { DefinitionLookup, SensoryApplication, SensoryEmitter, SensoryPosition, SensoryRing, SensoryTokenDocument } from "./types.js";
interface PolygonTree extends TreeNode { polygons: readonly unknown[]; intersectPolygon(polygon: unknown): PolygonTree }
interface SensoryTileDocument {
    uuid: string; hidden: boolean; elevation: number; levels: Set<string>; flags: Record<string, unknown>;
    shape: { center: { x: number; y: number }; polygonTree: PolygonTree };
}
export interface SensoryScene {
    tokens: Iterable<SensoryTokenDocument>; tiles: Iterable<SensoryTileDocument>;
    regions: { get(id: string): { polygonTree: PolygonTree } | undefined };
}
function emissions(uuid: string, position: SensoryPosition, rings: SensoryRing[], applications: SensoryApplication[]): SensoryEmitter[] {
    const channels = new Map<string, SensoryEmitter>();
    for (const app of applications.sort((a, b) => a.definitionUuid.localeCompare(b.definitionUuid))) {
        const { channel, emission } = app.definition;
        if (!emission.enabled || app.rank <= 0) continue;
        const strength = emission.strength === "rank" ? app.rank : emission.fixed;
        if ((channels.get(channel)?.strength ?? 0) >= strength) continue;
        channels.set(channel, { documentUuid: uuid, channel, position, rings, strength, colour: emission.colour });
    }
    return [...channels.values()];
}
export function collectEmitters(scene: SensoryScene, lookup: DefinitionLookup): SensoryEmitter[] {
    const result: SensoryEmitter[] = [];
    for (const token of scene.tokens) {
        if (token.hidden || !token.actor) continue;
        const position = { ...token.getCenterPoint(), levelId: token.level };
        const { width, height } = token.getSize();
        const points = Array.from({ length: 16 }, (_, index) => ({
            x: position.x + Math.cos(index * Math.PI / 8) * width / 2,
            y: position.y + Math.sin(index * Math.PI / 8) * height / 2 }));
        result.push(...emissions(token.uuid, position, [{ points, hole: false }], resolveApplications(token.actor.items, lookup)));
    }
    for (const tile of scene.tiles) {
        if (tile.hidden) continue;
        const bindings = readTileBindings(sensoryFlag(tile.flags, "sensoryEffects"));
        const applications = bindings.flatMap(binding => {
            const definition = lookup(binding.effectUuid);
            return definition ? [{ definitionUuid: binding.effectUuid, rank: binding.rank, definition }] : [];
        });
        if (!applications.length || !tile.shape.polygonTree.polygons.length) continue;
        const clip = clipRegionId(tile, MODULE_ID);
        const region = clip ? scene.regions.get(clip) : undefined;
        if (clip && !region) continue;
        const tree = region ? region.polygonTree.intersectPolygon(tile.shape.polygonTree.polygons[0]) : tile.shape.polygonTree;
        const rings = clipRings(tree);
        if (!rings.length) continue;
        const native = canvas as unknown as { inferLevelFromElevation(elevation: number, options: { levels: Set<string> }): { id: string } };
        const level = native.inferLevelFromElevation(tile.elevation, { levels: tile.levels });
        const position = { ...tile.shape.center, elevation: tile.elevation, levelId: level.id };
        result.push(...emissions(tile.uuid, position, rings, applications));
    }
    return result;
}

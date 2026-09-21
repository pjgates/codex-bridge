/**
 * Clip a tile's texture to a region of its scene. The tile stores the region
 * id in its `codex-foundry.clipRegion` flag; the region's polygon tree becomes
 * a stencil mask on the tile's primary mesh, rebuilt when the tile or the
 * region changes. Purely visual, runs on every client.
 */

import { MODULE_ID } from "../../constants.js";
import { clipRegionId, clipRings, localRings, tilesClippedBy, type Point, type TreeNode } from "./rings.js";

export const CLIP_FLAG = "clipRegion";

type ClipTile = Tile.Implementation;
type ClipMesh = NonNullable<ClipTile["mesh"]>;
type ClipRegion = RegionDocument.Implementation;

/** What the current mask was built from, to skip needless rebuilds. */
const built = new WeakMap<PIXI.Container, string>();
const warned = new Set<string>();

function regionFor(tile: ClipTile): ClipRegion | null | undefined {
    const id = clipRegionId(tile.document as { flags?: Record<string, unknown> }, MODULE_ID);
    if (!id) return null;
    return (tile.document.parent?.regions.get(id) as ClipRegion | undefined) ?? undefined;
}

function clearMask(mesh: ClipMesh): void {
    const mask = mesh.mask;
    if (mask instanceof PIXI.Graphics && mask.parent === mesh) { mesh.removeChild(mask); mask.destroy(); }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mesh as any).mask = null;
    built.delete(mesh);
}

/** Build or refresh the stencil for one tile. Idempotent and cheap when nothing changed. */
export function applyClip(tile: ClipTile, force = false): void {
    const mesh = tile.mesh;
    if (!mesh) return;
    const region = regionFor(tile);
    if (region === null) { if (mesh.mask) clearMask(mesh); return; }
    if (region === undefined) {
        if (mesh.mask) clearMask(mesh);
        const key = `${tile.document.uuid}`;
        if (!warned.has(key)) { warned.add(key); console.warn(`${MODULE_ID} | Tile ${tile.document.id} is clipped to a region that no longer exists.`); }
        return;
    }
    mesh.transform.updateLocalTransform();
    const local = mesh.localTransform;
    const key = `${region.id}:${local.a},${local.b},${local.c},${local.d},${local.tx},${local.ty}`;
    if (!force && built.get(mesh) === key && mesh.mask) return;
    clearMask(mesh);
    const inverse = local.clone().invert();
    const rings = localRings(clipRings(region.polygonTree as unknown as TreeNode), (p: Point) => inverse.apply(new PIXI.Point(p.x, p.y)));
    const graphics = new PIXI.Graphics();
    graphics.beginFill(0xffffff);
    for (const ring of rings) {
        if (ring.hole) graphics.beginHole();
        graphics.drawPolygon(ring.points.flatMap((p) => [p.x, p.y]));
        if (ring.hole) graphics.endHole();
    }
    graphics.endFill();
    mesh.addChild(graphics);
    mesh.mask = graphics;
    built.set(mesh, key);
}

function sceneTiles(scene: Scene.Implementation | null | undefined): ClipTile[] {
    if (!canvas?.ready || !scene || canvas.scene?.id !== scene.id) return [];
    return canvas.tiles!.placeables as ClipTile[];
}

function refreshRegionTiles(region: RegionDocument.Implementation): void {
    const docs = tilesClippedBy(region.parent?.tiles ?? [], region.id ?? "", MODULE_ID);
    const ids = new Set<string | null>(docs.map((d) => d.id));
    for (const tile of sceneTiles(region.parent)) if (ids.has(tile.document.id)) applyClip(tile, true);
}

/** Set or clear a tile's clip region. Empty region clears. */
export async function clipTileToRegion(tile: TileDocument.Implementation, regionId: string | null): Promise<void> {
    await tile.update({ [`flags.${MODULE_ID}.${CLIP_FLAG}`]: regionId ?? "" } as never);
}

export function activateClipTiles(): void {
    Hooks.on("refreshTile", (tile) => applyClip(tile as ClipTile));
    Hooks.on("updateRegion", (region) => refreshRegionTiles(region));
    Hooks.on("deleteRegion", (region) => refreshRegionTiles(region));
    Hooks.on("updateTile", (tile, changes) => {
        if (!(foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${CLIP_FLAG}`) || foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.-=${CLIP_FLAG}`))) return;
        const placeable = sceneTiles(tile.parent).find((t) => t.document.id === tile.id);
        if (placeable) applyClip(placeable, true);
    });
}

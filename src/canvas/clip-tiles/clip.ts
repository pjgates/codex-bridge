/** Visual inclusion/exclusion region masks, rebuilt when a tile or selected region changes. */

import { MODULE_ID } from "../../constants.js";
import { clipRings, localRings, type Point, type TreeNode } from "./rings.js";

import { combineMask, maskRegions } from "./mask.js";

export const CLIP_FLAG = "clipRegion";

type ClipTile = Tile.Implementation;
type ClipMesh = NonNullable<ClipTile["mesh"]>;

/** What the current mask was built from, to skip needless rebuilds. */
const built = new WeakMap<PIXI.Container, string>();
const warned = new Set<string>();

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
    const selection = maskRegions(tile.document as { flags?: Record<string, unknown> });
    if (!selection.include.length && !selection.exclude.length) { if (mesh.mask) clearMask(mesh); return; }
    const regions = tile.document.parent!.regions;
    const selected = [...selection.include, ...selection.exclude];
    const missing = selected.filter(id => !regions.has(id));
    const warning = `${tile.document.uuid}:${missing.join(',')}`;
    if (missing.length && !warned.has(warning)) {
        warned.add(warning);
        console.warn(`${MODULE_ID} | Tile ${tile.document.id} mask references missing regions: ${missing.join(', ')}.`);
    }
    mesh.transform.updateLocalTransform();
    const local = mesh.localTransform;
    const key = `${JSON.stringify(selection)}:${tile.document.width},${tile.document.height}:${local.a},${local.b},${local.c},${local.d},${local.tx},${local.ty}`;
    if (!force && built.get(mesh) === key && mesh.mask) return;
    clearMask(mesh);
    const inverse = local.clone().invert();
    const regionRings = (ids: string[]) => ids.flatMap(id => {
        const region = regions.get(id);
        return region ? clipRings(region.polygonTree as unknown as TreeNode) : [];
    });
    const toLocal = (p: Point) => inverse.apply(new PIXI.Point(p.x, p.y));
    const bounds = mesh.getLocalBounds(new PIXI.Rectangle());
    const include = selection.include.length ? localRings(regionRings(selection.include), toLocal) : [{ hole: false, points: [
        { x: bounds.x, y: bounds.y }, { x: bounds.right, y: bounds.y },
        { x: bounds.right, y: bounds.bottom }, { x: bounds.x, y: bounds.bottom },
    ] }];
    const rings = combineMask(include, localRings(regionRings(selection.exclude), toLocal));
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
    const docs = [...(region.parent?.tiles ?? [])].filter(tile => {
        const mask = maskRegions(tile as { flags?: Record<string, unknown> });
        return [...mask.include, ...mask.exclude].includes(region.id!);
    });
    const ids = new Set<string | null>(docs.map((d) => d.id));
    for (const tile of sceneTiles(region.parent)) if (ids.has(tile.document.id)) applyClip(tile, true);
}

/** Set or clear a tile's clip region. Empty region clears. */
export async function clipTileToRegion(tile: TileDocument.Implementation, regionId: string | null): Promise<void> {
    await tile.update({ [`flags.${MODULE_ID}.${CLIP_FLAG}`]: regionId ?? "", [`flags.${MODULE_ID}.clipRegions`]: regionId ? [regionId] : [] } as never);
}

export function activateClipTiles(): void {
    // ready can run after the initial tile refresh, so restore persisted masks explicitly.
    const restore = () => { for (const tile of sceneTiles(canvas?.scene)) applyClip(tile); };
    Hooks.on("canvasReady", restore);
    restore();
    Hooks.on("refreshTile", (tile) => applyClip(tile as ClipTile));
    Hooks.on("createRegion", (region) => refreshRegionTiles(region));
    Hooks.on("updateRegion", (region) => refreshRegionTiles(region));
    Hooks.on("deleteRegion", (region) => refreshRegionTiles(region));
    Hooks.on("updateTile", (tile, changes) => {
        if (![CLIP_FLAG, 'clipRegions', 'excludeRegions'].some(flag =>
            foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${flag}`) || foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.-=${flag}`))) return;
        const placeable = sceneTiles(tile.parent).find((t) => t.document.id === tile.id);
        if (placeable) applyClip(placeable, true);
    });
}

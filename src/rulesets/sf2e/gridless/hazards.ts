import { MODULE_ID } from "../../../constants.js";
import { isFloorType, isWaterType } from "../../../canvas/regions/index.js";
import { movementCellStatus, forcedIntent, forcedMovementHeld, findGridMovementStatuses,
    type GridRoutingToken, type MovementCellStatus, type MovementToken, type Waypoint } from "../movement/index.js";
import { hexAt, hexCentre, hexCorners, hexRange } from "./hex.js";
import { dragPaths, isKnownMovementPoint } from "./routing.js";
import type { Point } from "./geometry.js";

const COLORS = { walk: 0xffffff, fly: 0xffffff, climb: 0xffbf47, swim: 0x3399ff,
    fall: 0xff6666, unknown: 0xbb88ff, ruling: 0xff8844, blocked: 0xaaaaaa };
interface Cell { center: Point; vertices: Point[]; status?: MovementCellStatus; routed?: boolean }
type PreviewToken = Token.Implementation & {
    movementAnimationPromise: Promise<void> | null;
    isDragged: boolean;
    document: Token.Implementation["document"] & { movement: { origin: Waypoint } };
};
interface Ruler {
    token: PreviewToken;
    refresh(data: { pendingWaypoints: Waypoint[]; plannedMovement: Record<string, { foundPath: Waypoint[] }> }): void;
    clear(): void;
}

/** Whole grid spaces; gridless scenes use a scene-aligned hex overlay at the scene's grid scale. */
function nearbyCells(center: Point, radius: number): Cell[] {
    const grid = canvas!.grid!;
    const bounds = { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 };
    const cells: Cell[] = [];
    const add = (point: Point, vertices: Point[]): void => {
        if (Math.hypot(point.x - center.x, point.y - center.y) <= radius) cells.push({ center: point, vertices });
    };
    if (grid.isGridless) {
        const { qMin, qMax, rMin, rMax } = hexRange(bounds, grid.size);
        for (let q = qMin; q <= qMax; q++) for (let r = rMin; r <= rMax; r++) {
            add(hexCentre({ q, r }, grid.size), hexCorners({ q, r }, grid.size));
        }
    } else {
        const [i0, j0, i1, j1] = grid.getOffsetRange(bounds);
        for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
            add(grid.getCenterPoint({ i, j }), grid.getVertices({ i, j }));
        }
    }
    return cells;
}

/** A terrain inspection layer, independent of the reachable-area search and its movement budget. */
export function activateMovementHazards(previewHeld: () => boolean): void {
    const borders = (foundry.canvas as unknown as { borders: {
        drawBorder(graphics: PIXI.Graphics, shape: PIXI.Polygon,
            options: { color: number; clear: boolean; alignment: number }): void;
    } }).borders;
    const previews = new WeakMap<PreviewToken, Waypoint>();
    const origins = new WeakMap<PreviewToken, Waypoint>();
    let routeJob: ReturnType<typeof findGridMovementStatuses> | undefined;
    let routeTimer: ReturnType<typeof setInterval> | undefined;
    let routeKey = "", routeStatuses: Map<string, MovementCellStatus> | null = null;
    let completedField: { key: string; job: ReturnType<typeof findGridMovementStatuses> } | undefined;
    let container: PIXI.Container | null = null;
    let graphics: PIXI.Graphics, tooltip: PIXI.Text;
    let cells: Cell[] = [], cacheKey = "";
    let revision = 0;

    function clear(): void {
        clearInterval(routeTimer); routeTimer = undefined;
        routeJob?.cancel(); routeJob = undefined; routeKey = ""; routeStatuses = null;
        canvas?.stage?.off("pointermove", hover);
        if (container) { canvas?.interface?.removeChild(container); container.destroy({ children: true }); }
        container = null;
        cells = [];
        cacheKey = "";
    }

    function hover(): void {
        if (!container || !canvas?.ready) return;
        const point = canvas.mousePosition!;
        const cell = point && cells.find(candidate => new PIXI.Polygon(candidate.vertices).contains(point.x, point.y));
        tooltip.visible = !!cell?.status && isKnownMovementPoint(point);
        if (!tooltip.visible || !cell?.status) return;
        tooltip.text = `${cell.routed ? "Best route" : "Direct approach"}: ${cell.status.label}${cell.status.hint ? ` · ${cell.status.hint}` : ""}`;
        tooltip.style.fill = COLORS[cell.status.kind];
        tooltip.position.set(point.x, point.y - 16 / canvas.stage!.scale.x);
        tooltip.scale.set(1 / canvas.stage!.scale.x);
    }

    function refresh(): void {
        if (!canvas?.ready || !["pf2e", "sf2e"].includes(game.system!.id)
            || !game.settings!.get(MODULE_ID, "enableCustomRules")) return clear();
        const selected = canvas.tokens!.controlled as PreviewToken[];
        if (selected.length !== 1) return clear();
        const token = selected[0], preview = previews.get(token);
        if (!preview && !token.isDragged && !token.movementAnimationPromise) origins.delete(token);
        if (!previewHeld() && !preview && !token.movementAnimationPromise) return clear();
        const document = token.document as unknown as MovementToken;
        if (![...document.parent!.regions].some(region => [...region.behaviors].some(behavior =>
            !behavior.disabled && (isFloorType(behavior.type) || isWaterType(behavior.type))))) return clear();
        const { x, y, width, height, shape, depth, elevation, level } = document._source;
        const source: Waypoint = { x, y, width, height, shape, depth, elevation, level,
            action: token.document.movementAction ?? CONFIG.Token.movement.defaultAction };
        if (token.movementAnimationPromise && !origins.has(token)) origins.set(token, { ...token.document.movement.origin });
        const origin: Waypoint = { ...source, ...origins.get(token), action: preview?.action ?? source.action };
        const position = { ...source, ...preview };
        const center = token.document.getCenterPoint(position as Parameters<typeof token.document.getCenterPoint>[0]);
        const speed = (token.actor?.system as { movement?: { speeds?: { land?: { value: number } } } })?.movement?.speeds?.land?.value ?? 0;
        // A full Speed plus two spaces exposes hazards beyond the remaining-movement ring.
        const radius = Math.max(speed * canvas.dimensions!.distancePixels, canvas.grid!.size * 2) + canvas.grid!.size * 2;
        const zoom = canvas.stage!.scale.x;
        const style = game.settings!.get(MODULE_ID, "movementHazardStyle");
        const intent = forcedIntent(forcedMovementHeld());
        const originCenter = token.document.getCenterPoint(origin as Parameters<typeof token.document.getCenterPoint>[0]);
        const originCell = canvas.grid!.isGridless ? hexAt(originCenter, canvas.grid!.size) : canvas.grid!.getOffset(originCenter);
        const searchRadius = Math.max(speed * 1.5, 50, canvas.dimensions!.distance * 10);
        const nextRouteKey = JSON.stringify([document.uuid, token.actor?.uuid, originCell, origin.width, origin.height,
            origin.depth, origin.shape, origin.elevation, origin.level, origin.action, searchRadius, revision, intent]);
        if (nextRouteKey !== routeKey) {
            clearInterval(routeTimer); routeTimer = undefined;
            routeJob?.cancel(); routeStatuses = null; routeKey = nextRouteKey;
            if (intent.kind === "voluntary") {
                const job = routeJob = completedField?.key === nextRouteKey ? completedField.job
                    : findGridMovementStatuses(token as unknown as GridRoutingToken, origin, searchRadius, revision);
                routeStatuses = job.statuses;
                let count = job.statuses.size;
                routeTimer = setInterval(() => {
                    if (job.statuses.size === count) return;
                    count = job.statuses.size; cacheKey = ""; refresh();
                }, 100);
                job.promise.then(result => {
                    if (!result || routeJob !== job) return;
                    completedField = { key: nextRouteKey, job };
                    clearInterval(routeTimer); routeTimer = undefined;
                    routeStatuses = result; cacheKey = ""; refresh();
                });
            } else routeJob = undefined;
        }
        const key = JSON.stringify([token.id, token.actor?.uuid, source, origin, position, radius, zoom, revision, intent, style, game.user!.isGM]);
        if (key === cacheKey) return;
        cacheKey = key;
        if (!container) {
            container = canvas.interface!.addChild(new PIXI.Container());
            container.eventMode = "none";
            container.zIndex = 2;
            graphics = container.addChild(new PIXI.Graphics());
            graphics.name = "codex-movement-hazards";
            const style = { fontSize: 14, fill: 0xffffff, stroke: 0x000000, strokeThickness: 4, align: "center" as const };
            tooltip = container.addChild(new PIXI.Text("", style));
            tooltip.anchor.set(0.5, 1);
            canvas.stage!.on("pointermove", hover);
        }
        graphics.clear();
        tooltip.visible = false;
        graphics.filters = !game.user!.isGM && canvas.visibility.tokenVision
            ? graphics.filters ?? [foundry.canvas.rendering.filters.VisionMaskFilter.create()] : null;
        const occupied = [source, position].flatMap(point => canvas.grid!.isGridless
            ? [hexCentre(hexAt(token.document.getCenterPoint(point as Parameters<typeof token.document.getCenterPoint>[0]),
                canvas.grid!.size), canvas.grid!.size)]
            : token.document.getOccupiedGridSpaceOffsets(point as Parameters<typeof token.document.getOccupiedGridSpaceOffsets>[0])
                .map(offset => canvas.grid!.getCenterPoint(offset)));
        cells = nearbyCells(center, radius).filter(cell =>
            !occupied.some(point => point.x === cell.center.x && point.y === cell.center.y)
            && [cell.center, ...cell.vertices].every(isKnownMovementPoint));
        const pivot = { x: originCenter.x - origin.x, y: originCenter.y - origin.y };
        const thickness = CONFIG.Canvas.objectBorderThickness * (canvas.dimensions as unknown as { uiScale: number }).uiScale;
        for (const cell of cells) {
            const destination = { ...origin, x: cell.center.x - pivot.x, y: cell.center.y - pivot.y };
            const offset = canvas.grid!.isGridless ? (() => { const h = hexAt(cell.center, canvas.grid!.size); return {i: h.r, j: h.q}; })()
                : canvas.grid!.getOffset(cell.center);
            const routed = routeStatuses?.get(`${offset.i}:${offset.j}`);
            const [, blocked] = routed ? [[], false] : token.constrainMovementPath(
                [origin, destination] as unknown as Parameters<PreviewToken["constrainMovementPath"]>[0],
                { preview: true, ignoreCost: true, ignoreWalls: false, history: false });
            if (blocked) {
                cell.status = { kind: "blocked", label: "Blocked", hint: "", reaction: false, paused: false };
                continue;
            }
            cell.routed = !!routed;
            cell.status = routed ?? routeJob?.directStatus(destination) ?? movementCellStatus(document, origin, destination, intent);
            const color = COLORS[cell.status.kind];
            if (style === "plus") {
                const arm = 6 / zoom;
                for (const [width, stroke] of [[4 / zoom, 0x000000], [2 / zoom, color]]) {
                    graphics.lineStyle(width, stroke, 1)
                        .moveTo(cell.center.x - arm, cell.center.y).lineTo(cell.center.x + arm, cell.center.y)
                        .moveTo(cell.center.x, cell.center.y - arm).lineTo(cell.center.x, cell.center.y + arm);
                }
                continue;
            }
            const [a, b] = cell.vertices;
            const apothem = Math.abs((b.x - a.x) * (cell.center.y - a.y) - (b.y - a.y) * (cell.center.x - a.x))
                / Math.hypot(b.x - a.x, b.y - a.y);
            // Keep the outside of the native token border two screen pixels inside the cell.
            const insetScale = Math.max(0, 1 - (2 / zoom + thickness / 2) / apothem);
            const polygon = new PIXI.Polygon(cell.vertices.flatMap(point => [cell.center.x + (point.x - cell.center.x) * insetScale,
                cell.center.y + (point.y - cell.center.y) * insetScale]));
            borders.drawBorder(graphics, polygon, { color, clear: false, alignment: 0.5 });
        }
    }

    const prototype = CONFIG.Token.rulerClass.prototype as unknown as Ruler;
    const originalRefresh = prototype.refresh, originalClear = prototype.clear;
    prototype.refresh = function (data): void {
        originalRefresh.call(this, data);
        const end = data.pendingWaypoints.at(-1) ?? (this.token.isDragged ? dragPaths.get(this.token)?.at(-1) : undefined)
            ?? data.plannedMovement[game.user!.id]?.foundPath.at(-1);
        if (end && !origins.has(this.token)) {
            const start = data.plannedMovement[game.user!.id]?.foundPath[0]
                ?? (this.token.isDragged ? dragPaths.get(this.token)?.[0] : undefined)
                ?? (this.token.movementAnimationPromise ? this.token.document.movement.origin : this.token.document._source);
            origins.set(this.token, { ...start } as Waypoint);
        }
        if (end) previews.set(this.token, end as Waypoint); else previews.delete(this.token);
        refresh();
    };
    prototype.clear = function (): void {
        originalClear.call(this);
        previews.delete(this.token);
        origins.delete(this.token);
        refresh();
    };
    const hooks = Hooks as unknown as { on(name: string, callback: (...args: never[]) => unknown): void };
    for (const hook of ["controlToken", "refreshToken", "canvasPan", "canvasReady", "codexMovementPreviewChanged"]) hooks.on(hook, refresh);
    for (const hook of ["createWall", "updateWall", "deleteWall", "createRegion", "updateRegion", "deleteRegion",
        "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior", "updateScene", "updateActor",
        "createItem", "updateItem", "deleteItem", "updateCombat", "deleteCombat"]) {
        hooks.on(hook, () => { revision++; refresh(); });
    }
    hooks.on("visibilityRefresh", () => {
        if (!game.user!.isGM && canvas?.visibility.tokenVision) { revision++; refresh(); }
    });
    hooks.on("updateSetting", (setting: {key: string}) => {
        const own = setting.key.startsWith(`${MODULE_ID}.`)
            && !["movementHazardStyle", "gridPathfinding"].some(key => setting.key === `${MODULE_ID}.${key}`);
        if (own || setting.key.startsWith(`${game.system!.id}.`)) { revision++; refresh(); }
    });
    hooks.on("destroyToken", (token: PreviewToken) => { previews.delete(token); origins.delete(token); refresh(); });
    hooks.on("canvasTearDown", () => { completedField = undefined; clear(); });
}

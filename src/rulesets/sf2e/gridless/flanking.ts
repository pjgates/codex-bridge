import { MODULE_ID } from "../../../constants.js";
import type { Point } from "./geometry.js";
import { isGridlessActive, movementLatticeMode } from "./settings.js";
import type { SystemToken } from "./tokens.js";
import { hexCentre, hexCorners, hexRange } from "./hex.js";
import { clearSegment } from "./clearance.js";
import { getMovementFootprint, isKnownMovementPoint } from "./routing.js";

/** Directional wedges: the outer arc uses native flanking checks, not every filled interior point. */
export function sampleFlankingSectors(
    center: Point, limit: number,
    inReach: (x: number, y: number) => boolean,
    valid: (x: number, y: number) => boolean,
): number[][] {
    if (!inReach(center.x, center.y)) return [];
    const boundary = (angle: number): { points: number[]; valid: boolean } => {
        const x = Math.cos(angle), y = Math.sin(angle);
        let low = 0, high = limit;
        for (let i = 0; i < 16; i++) {
            const radius = (low + high) / 2;
            if (inReach(center.x + x * radius, center.y + y * radius)) low = radius;
            else high = radius;
        }
        const points = [center.x + x * low, center.y + y * low];
        return { points, valid: valid(points[0], points[1]) };
    };
    const first = boundary(0);
    let previous = first;
    const sectors: number[][] = [];
    // ponytail: 5-degree visual sampling; outer endpoints and their midpoint must pass the native predicate.
    for (let i = 1; i <= 72; i++) {
        const current = i === 72 ? first : boundary(i * Math.PI / 36);
        const a = previous.points, b = current.points;
        if (previous.valid && current.valid && valid((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) {
            sectors.push([center.x, center.y, a[0], a[1], b[0], b[1]]);
        }
        previous = current;
    }
    return sectors;
}

export function getFlankingPolygons(attacker: SystemToken, target: SystemToken): number[][] {
    if (attacker === target || !attacker.actor?.isOfType("creature") || !target.actor?.isOfType("creature")) return [];
    const allies: Pick<SystemToken, "id" | "actor" | "document" | "mechanicalBounds" | "canFlank" | "isAdjacentTo">[] = [];
    for (const token of attacker.layer.placeables) {
        const ally = token as SystemToken;
        if (!(ally.actor?.isAllyOf(attacker.actor) || (attacker.document.isLinked && ally.actor === attacker.actor && ally.id !== attacker.id))) continue;
        const eligible = ally.canFlank(target);
        if (!eligible) continue;
        // Buddy eligibility is constant during one draw; only the proposed attacker position changes.
        allies.push({
            id: ally.id, actor: ally.actor, document: ally.document, mechanicalBounds: ally.mechanicalBounds,
            canFlank: () => eligible, isAdjacentTo: ally.isAdjacentTo.bind(ally),
        });
    }
    if (!allies.length) return [];
    const reach = attacker.actor.getReach({ action: "attack" });
    const original = attacker.mechanicalBounds;
    const bounds = new PIXI.Rectangle(original.x, original.y, original.width, original.height);
    const center = { ...attacker.center };
    const document = { x: attacker.document.x, y: attacker.document.y, hidden: attacker.document.hidden,
        elevation: attacker.document.elevation, isLinked: attacker.document.isLinked };
    // These native predicates use this position-only view. Never clone or mutate a world token.
    const view = {
        id: attacker.id, actor: attacker.actor, document, mechanicalBounds: bounds, center, layer: { placeables: allies },
        distanceTo: attacker.distanceTo, canFlank: attacker.canFlank, isAdjacentTo: attacker.isAdjacentTo,
        onOppositeSides: attacker.onOppositeSides, checkCollision: attacker.checkCollision.bind(attacker),
    } as unknown as SystemToken;
    const moveView = (x: number, y: number): void => {
        const dx = x - attacker.center.x, dy = y - attacker.center.y;
        center.x = x; center.y = y;
        document.x = attacker.document.x + dx; document.y = attacker.document.y + dy;
        bounds.x = original.x + dx; bounds.y = original.y + dy;
    };
    const range = reach * canvas!.dimensions!.distancePixels;
    const limit = range + Math.hypot(original.width + target.mechanicalBounds.width, original.height + target.mechanicalBounds.height) / 2;
    if (movementLatticeMode() === "hex") {
        const size = canvas!.grid!.size / 10;
        const range = hexRange({ x: target.center.x - limit, y: target.center.y - limit, width: 2 * limit, height: 2 * limit }, size);
        const footprint = getMovementFootprint(attacker);
        const offsets = hexCorners({ q: 0, r: 0 }, size).flatMap(point => [point.x, point.y]);
        const cells: number[][] = [];
        for (let q = range.qMin; q <= range.qMax; q++) {
            for (let r = range.rMin; r <= range.rMax; r++) {
                const point = hexCentre({ q, r }, size);
                if (!isKnownMovementPoint(point)) continue;
                moveView(point.x, point.y);
                if (!attacker.isFlanking.call(view, target, { reach }) || !clearSegment(footprint, point, point)) continue;
                cells.push(offsets.map((value, index) => value + (index % 2 ? point.y : point.x)));
            }
        }
        return cells;
    }
    return sampleFlankingSectors(target.center, limit,
        (x, y) => { moveView(x, y); return view.distanceTo(target, { reach }) <= reach; },
        (x, y) => { moveView(x, y); return attacker.isFlanking.call(view, target, { reach }); });
}

export function activateFlankingGuide(): void {
    let graphics: PIXI.Graphics | null = null;
    let frame = 0;
    const refresh = (): void => {
        frame = 0;
        graphics?.clear();
        if (!isGridlessActive() || canvas!.tokens!.controlled.length !== 1 || game.user!.targets.size !== 1) return;
        // Both supported systems install the same TokenPF2e public flanking methods.
        const attacker = canvas!.tokens!.controlled[0] as SystemToken;
        const target = [...game.user!.targets][0] as SystemToken;
        if (!target.isVisible) return;
        const polygons = getFlankingPolygons(attacker, target);
        if (!polygons.length) return;
        if (!graphics) {
            graphics = canvas!.interface!.addChild(new PIXI.Graphics());
            graphics.zIndex = 1;
            graphics.eventMode = "none";
        }
        const hex = movementLatticeMode() === "hex";
        graphics.lineStyle(hex ? 1 / canvas!.stage!.scale.x : 0, 0xff4444, 0.45).beginFill(0xff4444, hex ? 0.12 : 0.45);
        for (const polygon of polygons) graphics.drawPolygon(polygon);
        graphics.endFill();
    };
    const request = (): void => { if (!frame) frame = requestAnimationFrame(refresh); };
    for (const hook of ["controlToken", "updateToken", "createToken", "deleteToken", "updateActor", "createItem", "updateItem", "deleteItem",
        "createWall", "updateWall", "deleteWall", "canvasReady", "updateScene", "visibilityRefresh", "canvasPan"] as const) Hooks.on(hook, request);
    Hooks.on("targetToken", (user) => { if (user === game.user) request(); });
    Hooks.on("updateSetting", setting => { if (setting.key === `${MODULE_ID}.movementLattice`) request(); });
    // Foundry 14 supplies flags; fvtt-types still declares the older one-argument hook.
    Hooks.on("refreshToken", (_token: Token.Implementation, flags: Record<string, boolean> = {}) => {
        if (flags.refreshVisibility || flags.refreshPosition || flags.refreshSize || flags.refreshElevation) request();
    });
    Hooks.on("canvasTearDown", () => {
        cancelAnimationFrame(frame); frame = 0;
        graphics?.parent?.removeChild(graphics);
        graphics?.destroy(); graphics = null;
    });
    request();
}

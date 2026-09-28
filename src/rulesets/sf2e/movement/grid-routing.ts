import { MODULE_ID } from "../../../constants.js";
import { movementCellStatus, movementPlanStatus, type MovementCellStatus } from "./preview.js";
import { prepareTransition, type MovementToken, type Waypoint } from "./transitions.js";
import { hexAt, hexCentre, hexCorners, HEX_DIRECTIONS } from "../gridless/index.js";
import { prepareSurfaceQueries } from "../../../canvas/regions/index.js";

// Native v14 movement data is newer than fvtt-types.
type GridWaypoint = Waypoint & { width: number; height: number; depth: number; shape: number; intermediate?: boolean; terrain?: unknown; cost?: number };
interface Options {
    preview?: boolean; terrainOptions?: Record<string, unknown>; measureOptions?: Record<string, unknown>;
    constrainOptions?: { ignoreWalls?: boolean; ignoreCost?: boolean; history?: unknown; [key: string]: unknown };
}
interface Job { result?: GridWaypoint[] | null; promise: Promise<GridWaypoint[] | null>; cancel(): void }
export interface GridRoutingToken {
    document: MovementToken & { _source: GridWaypoint; movementHistory: GridWaypoint[];
        getCenterPoint(point: Partial<GridWaypoint>): { x: number; y: number } };
    scene: { dimensions: { rect: { x: number; y: number; width: number; height: number } } };
    createTerrainMovementPath(points: Partial<GridWaypoint>[], options?: object): GridWaypoint[];
    constrainMovementPath(points: GridWaypoint[], options?: object): [GridWaypoint[], boolean];
    measureMovementPath(points: GridWaypoint[], options?: object): { cost: number; diagonals: number };
}
interface Step { path: GridWaypoint[]; special: boolean; status: MovementCellStatus }
interface FieldEdge { step: Step; expanded: GridWaypoint[]; measured: { cost: number; diagonals: number }; oddCost?: number }
const fieldContexts = new WeakMap<GridRoutingToken, { key: string; evaluator: MovementToken;
    edges: Map<string, FieldEdge | null> }>();

/** Continue beyond a required check for planning only; execution still uses the real transition owner. */
function evaluateStep(token: MovementToken, from: GridWaypoint, to: GridWaypoint): Step | null {
    const plan = prepareTransition(token, { id: "grid-route", origin: from,
        passed: { waypoints: [to] }, pending: { waypoints: [] } }, { kind: "voluntary" });
    const status = movementPlanStatus(token, plan), { kind } = status;
    if (["fall", "unknown", "ruling", "blocked"].includes(kind)) return null;
    const transition = plan.transition;
    if (!transition) return { path: plan.waypoints as GridWaypoint[], special: kind === "climb" || kind === "swim", status };
    const path = plan.waypoints.slice(0, plan.waypoints.indexOf(transition.safe) + 1) as GridWaypoint[];
    let after = { ...transition.after } as GridWaypoint;
    if (transition.reason === "climb" && transition.landing.kind === "surface") {
        const { elevation } = transition.landing.support;
        const { level } = transition.landing;
        // Rise beside the face before crossing its upper edge, keeping native surface collisions enabled.
        path.push({ ...transition.safe, elevation, level, action: "climb", checkpoint: false } as GridWaypoint);
        after = { ...after, elevation, level, action: "climb" };
    } else after.action = "swim";
    path.push(after);
    const destination = { ...to, elevation: after.elevation, level: after.level };
    if (Math.hypot(after.x - to.x, after.y - to.y) > 0.001) {
        const tail = evaluateStep(token, after, destination);
        if (!tail) return null;
        path.push(...tail.path);
    }
    return { path, special: true, status };
}

/** One shared search supplies route statuses for all cells, without a movement-budget limit. */
export function findGridMovementStatuses(token: GridRoutingToken, origin: Waypoint, radius = Infinity, revision?: number): {
    statuses: Map<string, MovementCellStatus>; promise: Promise<Map<string, MovementCellStatus> | null>;
    directStatus(destination: Waypoint): MovementCellStatus; cancel(): void;
} {
    const began = performance.now();
    const native = canvas!.grid!, size = native.size;
    const isHex = !native.isGridless && !native.isSquare;
    const document = token.document;
    const contextKey = JSON.stringify([revision, origin.width, origin.height, origin.depth, origin.shape,
        origin.elevation, origin.level, origin.action, native.size, game.user!.isGM,
        !game.user!.isGM && canvas!.visibility.tokenVision]);
    let context = revision === undefined ? undefined : fieldContexts.get(token);
    if (context?.key !== contextKey || context.evaluator.actor !== document.actor) context = { key: contextKey, edges: new Map(), evaluator: {
        uuid: document.uuid, name: document.name, actor: document.actor, _source: document._source,
        parent: prepareSurfaceQueries(document.parent!, size),
        getMovementOrigin: document.getMovementOrigin.bind(document) } as MovementToken };
    if (revision !== undefined) fieldContexts.set(token, context);
    const { evaluator, edges } = context;
    const grid = native.isGridless ? {
        getOffset: (point: { x: number; y: number }) => { const h = hexAt(point, size); return { i: h.r, j: h.q }; },
        getCenterPoint: ({ i, j }: { i: number; j: number }) => hexCentre({ q: j, r: i }, size),
        getVertices: ({ i, j }: { i: number; j: number }) => hexCorners({ q: j, r: i }, size),
        getAdjacentOffsets: ({ i, j }: { i: number; j: number }) => HEX_DIRECTIONS.map(h => ({ i: i + h.r, j: j + h.q })),
    } : native;
    const bounds = token.scene.dimensions.rect;
    const restricted = !game.user!.isGM && canvas!.visibility.tokenVision;
    const known = (point: { x: number; y: number }): boolean => !restricted
        || canvas!.fog.isPointExplored(point) || canvas!.visibility.testVisibility(point, { tolerance: 1 });
    const start = token.createTerrainMovementPath([origin], { preview: true })[0];
    const originCenter = token.document.getCenterPoint(start);
    const within = new Map<string, boolean>();
    const withinRadius = (id: string, center: {x: number; y: number}): boolean => {
        if (radius === Infinity) return true;
        let allowed = within.get(id);
        if (allowed === undefined) {
            const distance = native.isGridless ? Math.hypot(center.x - originCenter.x, center.y - originCenter.y)
                / canvas!.dimensions!.distancePixels : native.measurePath([
                    {x: originCenter.x, y: originCenter.y}, {x: center.x, y: center.y}], {}).cost;
            within.set(id, allowed = distance <= radius);
        }
        return allowed;
    };
    const pivot = token.document.getCenterPoint({ ...start, x: 0, y: 0 });
    const preferWalk = ["walk", "travel"].includes(start.action);
    interface Node { point: GridWaypoint; path: GridWaypoint[]; cost: number; diagonals: number; special: number; status: MovementCellStatus }
    const first: Node = { point: start, path: [start], cost: 0, diagonals: 0, special: 0,
        status: movementCellStatus(evaluator, start, start) };
    const walkCells = new Map<string, boolean>();
    const walksAt = (point: GridWaypoint): boolean => {
        const id = [point.x, point.y, point.elevation, point.level].join(":");
        let walk = walkCells.get(id);
        if (walk === undefined) walkCells.set(id, walk = movementCellStatus(evaluator, point, point).kind === "walk");
        return walk;
    };
    const offset = (node: Node) => grid.getOffset(token.document.getCenterPoint(node.point));
    const key = (node: Node): string => {
        const { i, j } = offset(node);
        return [i, j, node.point.elevation, node.point.level, node.point.action, node.diagonals % 2, node.special].join(":");
    };
    let cancelled = false;
    let workMs = 0, yields = 0, stateCount = 0, edgeCount = 0;
    const statuses = new Map<string, MovementCellStatus>();
    const promise = (async () => {
        const open = [first], best = new Map([[key(first), 0]]);
        let sliceBegan = performance.now(), deadline = sliceBegan + 6;
        while (open.length) {
            if (cancelled) return null;
            if (performance.now() >= deadline) {
                workMs += performance.now() - sliceBegan; yields++;
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                sliceBegan = performance.now(); deadline = sliceBegan + 6;
                if (cancelled) return null;
            }
            let index = 0;
            for (let i = 1; i < open.length; i++) if (open[i].special < open[index].special
                || (open[i].special === open[index].special && open[i].cost < open[index].cost)) index = i;
            const current = open.splice(index, 1)[0];
            if (current.cost !== best.get(key(current))) continue;
            const cell = offset(current), id = `${cell.i}:${cell.j}`;
            if (!statuses.has(id)) statuses.set(id, current.status);
            for (const neighbor of grid.getAdjacentOffsets({i: cell.i, j: cell.j})) {
                const center = grid.getCenterPoint(neighbor);
                if (center.x < bounds.x || center.y < bounds.y || center.x >= bounds.x + bounds.width
                    || center.y >= bounds.y + bounds.height || !withinRadius(`${neighbor.i}:${neighbor.j}`, center)
                    || ![center, ...grid.getVertices(neighbor)].every(known)) continue;
                const destination = { ...current.point, action: start.action, x: Math.round(center.x - pivot.x),
                    y: Math.round(center.y - pivot.y), explicit: false, checkpoint: false, snapped: !native.isGridless };
                const edgeKey = [current.point.x, current.point.y, current.point.elevation, current.point.level,
                    current.point.action, neighbor.i, neighbor.j].join(":");
                let edge = edges.get(edgeKey);
                if (edge === undefined) {
                    const unchangedWalk = start.action === "walk" && current.point.action === "walk"
                        && current.status.kind === "walk" && walksAt(current.point) && walksAt(destination)
                        && !evaluator.parent!.segmentParameters!(
                            evaluator.getMovementOrigin(current.point), evaluator.getMovementOrigin(destination)).length;
                    const step: Step | null = unchangedWalk ? { path: [destination], special: false, status: current.status }
                        : evaluateStep(evaluator, current.point, destination);
                    edge = null;
                    if (step) {
                        const expanded = token.createTerrainMovementPath([current.point, ...step.path], { preview: true });
                        const [, blocked] = token.constrainMovementPath(expanded,
                            { preview: true, ignoreCost: true, ignoreWalls: false, history: false });
                        if (!blocked) edge = { step, expanded, measured: token.measureMovementPath(expanded, { preview: true }) };
                    }
                    edges.set(edgeKey, edge);
                }
                if (!edge) continue;
                const { step, expanded } = edge;
                const path = isHex ? expanded : [...current.path, ...expanded.slice(1)];
                let measured: {cost: number; diagonals: number};
                if (isHex) {
                    let cost = edge.measured.cost;
                    if (current.diagonals % 2 && edge.measured.diagonals) {
                        if (edge.oddCost === undefined) {
                            const from = expanded[0], center = grid.getCenterPoint({i: cell.i, j: cell.j});
                            const adjacent = grid.getCenterPoint(grid.getAdjacentOffsets({i: cell.i, j: cell.j})[0]);
                            // A zero-cost native vertical diagonal seeds the incoming alternating parity.
                            edge.oddCost = token.measureMovementPath([
                                {...from, x: from.x + adjacent.x - center.x, y: from.y + adjacent.y - center.y,
                                    elevation: from.elevation + native.distance, action: "walk"},
                                {...from, action: "walk", cost: 0}, ...expanded.slice(1)], {preview: true}).cost;
                        }
                        cost = edge.oddCost;
                    }
                    measured = {cost: current.cost + cost, diagonals: current.diagonals + edge.measured.diagonals};
                } else measured = current.diagonals === 0 && edge.measured.diagonals === 0
                    ? { cost: current.cost + edge.measured.cost, diagonals: 0 }
                    : token.measureMovementPath(path, { preview: true });
                if (!Number.isFinite(measured.cost)) continue;
                const next: Node = { point: path.at(-1)!, path, cost: measured.cost, diagonals: measured.diagonals,
                    special: current.special || Number(preferWalk && step.special),
                    status: ["climb", "swim"].includes(current.status.kind) ? current.status : step.status };
                const state = key(next);
                if (next.cost >= (best.get(state) ?? Infinity)) continue;
                best.set(state, next.cost); open.push(next);
            }
        }
        workMs += performance.now() - sliceBegan; stateCount = best.size; edgeCount = edges.size;
        return statuses;
    })().then(result => {
        if (cancelled) return null;
        (Hooks as unknown as { callAll(name: string, data: object): void }).callAll("codexMovementFieldComputed",
            { tokenUuid: document.uuid, duration: performance.now() - began, cells: statuses.size,
                workMs, yields, states: stateCount, edges: edgeCount });
        return result;
    });
    return { statuses, promise, directStatus: destination => movementCellStatus(evaluator, start, destination),
        cancel: () => { cancelled = true; } };
}

/** Native square/hex neighbors, native costs and collisions, with walking preferred over required terrain modes. */
export function findGridMovementPath(token: GridRoutingToken, points: Partial<GridWaypoint>[], options: Options = {}): Job {
    const grid = canvas!.grid!;
    const explicit = token.createTerrainMovementPath(points, { ...options.terrainOptions, preview: options.preview })
        .filter(point => !point.intermediate);
    const finish = (path: GridWaypoint[]): GridWaypoint[] => {
        const expanded = token.createTerrainMovementPath(path, { ...options.terrainOptions, preview: options.preview });
        const [constrained] = token.constrainMovementPath(expanded, { ...options.constrainOptions,
            measureOptions: options.measureOptions, preview: options.preview });
        return constrained.filter(point => !point.intermediate).map(point => {
            const clean = { ...point }; delete clean.terrain; delete clean.intermediate; return clean;
        });
    };
    if (!game.settings!.get(MODULE_ID, "gridPathfinding") || explicit.length < 2
        || options.constrainOptions?.ignoreWalls || options.constrainOptions?.ignoreCost) {
        const result = finish(explicit);
        return { result, promise: Promise.resolve(result), cancel() {} };
    }
    let cancelled = false;
    const job: Job = { promise: Promise.resolve(null), cancel: () => { cancelled = true; } };
    const bounds = token.scene.dimensions.rect;
    const restricted = !game.user!.isGM && canvas!.visibility.tokenVision;
    const known = (point: { x: number; y: number }): boolean => !restricted
        || canvas!.fog.isPointExplored(point) || canvas!.visibility.testVisibility(point, { tolerance: 1 });
    const history = Array.isArray(options.constrainOptions?.history) ? options.constrainOptions.history as GridWaypoint[]
        : options.constrainOptions?.history ? token.document.movementHistory : [];
    const measure = (path: GridWaypoint[]) => token.measureMovementPath([...history,
        ...token.createTerrainMovementPath(path, { ...options.terrainOptions, preview: options.preview })],
    { ...options.measureOptions, preview: options.preview });
    job.promise = (async () => {
        const routed = [explicit[0]];
        for (let leg = 1; leg < explicit.length; leg++) {
            const target = { ...explicit[leg] }, previous = explicit[leg - 1];
            const origin = routed.at(-1)!;
            if (previous.elevation !== target.elevation || previous.level !== target.level
                || !["walk", "travel", "climb", "swim", "fly", "crawl", "step"].includes(target.action)) {
                routed.push(target); continue;
            }
            target.elevation = origin.elevation; target.level = origin.level;
            const goal = grid.getOffset(token.document.getMovementOrigin(target));
            const pivot = token.document.getMovementOrigin({ ...target, x: 0, y: 0 });
            const preferWalk = target.action === "walk" || target.action === "travel";
            interface Node { point: GridWaypoint; path: GridWaypoint[]; cost: number; special: number; diagonals: number }
            const initial = measure(routed);
            const open: Node[] = [{ point: origin, path: routed, cost: initial.cost, diagonals: initial.diagonals, special: 0 }];
            const key = (node: Node): string => {
                const { i, j } = grid.getOffset(token.document.getMovementOrigin(node.point));
                return [i, j, node.point.elevation, node.point.level, node.point.action, node.diagonals % 2, node.special].join(":");
            };
            const best = new Map([[key(open[0]), open[0].cost]]);
            let found: Node | undefined, deadline = performance.now() + 6;
            while (open.length) {
                if (cancelled) return null;
                if (performance.now() >= deadline) {
                    await new Promise<void>(resolve => setTimeout(resolve, 0));
                    deadline = performance.now() + 6;
                    if (cancelled) return null;
                }
                let index = 0;
                for (let i = 1; i < open.length; i++) if (open[i].special < open[index].special
                    || (open[i].special === open[index].special && open[i].cost < open[index].cost)) index = i;
                const current = open.splice(index, 1)[0];
                if (current.cost !== best.get(key(current))) continue;
                const { i, j } = grid.getOffset(token.document.getMovementOrigin(current.point));
                if (i === goal.i && j === goal.j) {
                    if (current.point.x !== target.x || current.point.y !== target.y) {
                        const step = evaluateStep(token.document, current.point, target);
                        if (!step || !known(token.document.getMovementOrigin(target))) continue;
                        const expanded = token.createTerrainMovementPath([current.point, ...step.path],
                            { ...options.terrainOptions, preview: options.preview });
                        const [, blocked] = token.constrainMovementPath(expanded, { preview: options.preview,
                            ignoreCost: true, ignoreWalls: false, history: false });
                        if (blocked) continue;
                        current.path = [...current.path, ...step.path];
                    }
                    found = current; break;
                }
                for (const neighbor of grid.getAdjacentOffsets({ i, j })) {
                    const center = grid.getCenterPoint(neighbor);
                    if (center.x < bounds.x || center.y < bounds.y || center.x >= bounds.x + bounds.width
                        || center.y >= bounds.y + bounds.height || ![center, ...grid.getVertices(neighbor)].every(known)) continue;
                    const destination = { ...target, x: Math.round(center.x - pivot.x), y: Math.round(center.y - pivot.y),
                        elevation: current.point.elevation, level: current.point.level, explicit: false, checkpoint: false, snapped: true };
                    if (neighbor.i === goal.i && neighbor.j === goal.j) Object.assign(destination, { x: target.x, y: target.y });
                    const step = evaluateStep(token.document, current.point, destination);
                    if (!step) continue;
                    const expanded = token.createTerrainMovementPath([current.point, ...step.path],
                        { ...options.terrainOptions, preview: options.preview });
                    const [, blocked] = token.constrainMovementPath(expanded, { ...options.constrainOptions,
                        preview: options.preview, ignoreCost: true, history: false, ignoreWalls: false });
                    if (blocked) continue;
                    const path = [...current.path, ...step.path], measurement = measure(path);
                    if (!Number.isFinite(measurement.cost)) continue;
                    const next: Node = { point: path.at(-1)!, path, cost: measurement.cost, diagonals: measurement.diagonals,
                        special: current.special || Number(preferWalk && step.special) };
                    const id = key(next);
                    if (measurement.cost >= (best.get(id) ?? Infinity)) continue;
                    best.set(id, measurement.cost); open.push(next);
                }
            }
            if (!found) break;
            routed.splice(0, routed.length, ...found.path);
            Object.assign(routed.at(-1)!, { explicit: target.explicit, checkpoint: target.checkpoint, snapped: target.snapped });
        }
        return cancelled ? null : finish(routed);
    })().then(result => { job.result = cancelled ? null : result; return job.result; });
    return job;
}

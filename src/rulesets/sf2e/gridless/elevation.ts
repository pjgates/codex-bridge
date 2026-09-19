import type { Point } from "./geometry.js";

/**
 * Floor-height rules for map-workshop caves. Heights are in feet; one editor height unit is
 * 2.5 ft, so a one-step rise is a stair and anything higher is a ledge that needs a
 * climbing-capable action. Pure: no Foundry globals.
 */
export const STEP_FEET = 2.5;
export const CLIMB_ACTIONS: ReadonlySet<string> = new Set(["climb", "fly", "blink", "displace"]);
/** A path that merely clips the corner of a neighbouring hex for less than this many pixels has not entered it. */
export const MIN_TRAVERSE = 25;
const EPSILON = 1e-6;

export type ElevationDecision = "none" | "move" | "block";

export function decideElevation(from: number, to: number, action: string | undefined): ElevationDecision {
    const rise = to - from;
    if (Math.abs(rise) < EPSILON) return "none";
    if (rise <= STEP_FEET + EPSILON) return "move";
    return action !== undefined && CLIMB_ACTIONS.has(action) ? "move" : "block";
}

/** Distance along a polyline to a point lying on it (within one pixel), or null. */
export function pathParam(points: readonly Point[], point: Point): number | null {
    let along = 0;
    let best: { d: number; s: number } | null = null;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        if (length < EPSILON) continue;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (length * length)));
        const d = Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
        if (d <= 1 && (best === null || d < best.d)) best = { d, s: along + t * length };
        along += length;
    }
    return best ? best.s : null;
}

export interface FloorCrossing {
    floor: number;
    /** Just outside the floor region, where the rise happens. */
    from: Point;
    /** Just inside the floor region. */
    to: Point;
    /** Where the path leaves the region again, when it does; lets brief corner clips be dropped. */
    exit?: Point;
}

export interface ElevationWaypoint extends Point {
    elevation: number;
    action: string;
    snapped: boolean;
    explicit: boolean;
    checkpoint: boolean;
}

export interface ElevationPlan {
    waypoints: ElevationWaypoint[];
    blocked: { floor: number; rise: number } | null;
}

/**
 * Rewrite a movement path so the token takes each floor's height where it enters the floor's
 * footprint. Returns null when nothing changes. A refused climb truncates the path at the
 * entry and is reported in `blocked`. `start.elevation` is the floor the token really stands
 * on; `tokenElevation` is what its record says, and a mismatch settles the token onto its floor.
 * `enforceClimb: false` makes every rise walkable; heights are still applied.
 */
export function planElevationPath(options: {
    start: Point & { elevation: number };
    waypoints: readonly ElevationWaypoint[];
    crossings: readonly FloorCrossing[];
    tokenElevation?: number;
    enforceClimb?: boolean;
}): ElevationPlan | null {
    const { start, waypoints, crossings, tokenElevation = start.elevation, enforceClimb = true } = options;
    const polyline = [start, ...waypoints];
    const events = crossings.map(crossing => {
        const s = pathParam(polyline, crossing.to) ?? pathParam(polyline, crossing.from);
        const exit = crossing.exit ? pathParam(polyline, crossing.exit) : null;
        return { ...crossing, s, brief: s !== null && exit !== null && exit - s < MIN_TRAVERSE };
    }).filter((event): event is typeof event & { s: number } => event.s !== null && !event.brief)
        .sort((a, b) => a.s - b.s);
    const settling = Math.abs(tokenElevation - start.elevation) > EPSILON;
    if (!events.length && !settling) return null;

    const out: ElevationWaypoint[] = [];
    let elevation = start.elevation, previousElevation = tokenElevation, along = 0, changed = settling, index = 0;
    const strip = ({ x, y, action, snapped, explicit, checkpoint }: ElevationWaypoint) => ({ x, y, action, snapped, explicit, checkpoint });
    for (const waypoint of waypoints) {
        const previous = out.length ? out[out.length - 1] : start;
        const segmentEnd = along + Math.hypot(waypoint.x - previous.x, waypoint.y - previous.y);
        // The user changed height on purpose.
        if (waypoint.elevation !== previousElevation) elevation = waypoint.elevation;
        previousElevation = waypoint.elevation;
        while (index < events.length && events[index].s <= segmentEnd + EPSILON) {
            const crossing = events[index++];
            let decision = decideElevation(elevation, crossing.floor, waypoint.action);
            if (decision === "block" && !enforceClimb) decision = "move";
            if (decision === "none") continue;
            if (decision === "block") {
                out.push({ ...strip(waypoint), x: crossing.from.x, y: crossing.from.y, elevation, explicit: false, checkpoint: false });
                return { waypoints: out, blocked: { floor: crossing.floor, rise: crossing.floor - elevation } };
            }
            out.push({ ...strip(waypoint), x: crossing.from.x, y: crossing.from.y, elevation: crossing.floor, explicit: false, checkpoint: false });
            elevation = crossing.floor;
            changed = true;
        }
        out.push({ ...strip(waypoint), elevation });
        along = segmentEnd;
    }
    return changed ? { waypoints: out, blocked: null } : null;
}

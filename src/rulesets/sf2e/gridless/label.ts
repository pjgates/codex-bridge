import { MODULE_ID } from "../../../constants.js";
import { isGridlessActive } from "./settings.js";
import { movementBudget, ownTurn } from "./movement.js";
import { climbsEnforced, floorRegions, plannedElevations } from "./floors.js";
import { isSqueezedLeg } from "./routing.js";
import type { ElevationWaypoint } from "./elevation.js";

const TEMPLATE = `modules/${MODULE_ID}/dist/templates/gridless/waypoint-label.hbs`;

// Foundry 14 ruler shapes not yet represented by fvtt-types.
interface RulerWaypoint extends ElevationWaypoint {
    previous?: RulerWaypoint; next?: RulerWaypoint;
    width: number; height: number; shape: number; level: string; depth: number;
    cost: number;
    measurement: { distance: number; cost: number; backward?: { distance: number } };
}
interface LabelContext {
    cssClass: string;
    units: string;
    cost: { total: string; units: string; delta?: string; additional?: { total: number; delta: number } };
    elevation?: { total: string; icon: string; hidden: boolean; delta?: string };
    actionCost?: { actions: number; overage: boolean };
    remaining?: string;
    climbRefused?: boolean;
    climbIcon?: string;
    climbImg?: string;
    squeezed?: boolean;
}
interface LabelState { codexSqueezed?: Set<RulerWaypoint>; codexFloors?: { elevations: number[]; refusedFrom: number | null; chain: RulerWaypoint[] } | null }
interface RulerLike { token: Token.Implementation & { document: { parent: unknown; level: string; movementHistory: unknown[] } } }
type LabelContextFn = (this: RulerLike, waypoint: RulerWaypoint, state: LabelState) => LabelContext | undefined;
interface RulerClass { WAYPOINT_LABEL_TEMPLATE: string; prototype: { _getWaypointLabelContext: LabelContextFn } }

const round = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places;
const signed = (value: number): string => (value > 0 ? "+" : "") + String(value);

function chainFrom(waypoint: RulerWaypoint): RulerWaypoint[] {
    let head = waypoint;
    while (head.previous) head = head.previous;
    const chain: RulerWaypoint[] = [];
    for (let current: RulerWaypoint | undefined = head; current; current = current.next) chain.push(current);
    return chain;
}

/** Floor heights along the whole drag, planned once per refresh and cached on the ruler's state. */
function floorsFor(ruler: RulerLike, waypoint: RulerWaypoint, state: LabelState): LabelState["codexFloors"] {
    if (state.codexFloors !== undefined) return state.codexFloors;
    const document = ruler.token.document;
    const floors = floorRegions(document.parent as Parameters<typeof floorRegions>[0], document.level);
    if (!floors.length) return state.codexFloors = null;
    const chain = chainFrom(waypoint);
    const plan = plannedElevations(document as unknown as Parameters<typeof plannedElevations>[0], floors, chain, climbsEnforced());
    return state.codexFloors = { ...plan, chain };
}

function squeezedUpTo(ruler: RulerLike, waypoint: RulerWaypoint, state: LabelState): boolean {
    if (!state.codexSqueezed) {
        state.codexSqueezed = new Set();
        let squeezed = false;
        for (const current of chainFrom(waypoint)) {
            if (current.previous && isSqueezedLeg(ruler.token, current.previous as never, current as never)) squeezed = true;
            if (squeezed) state.codexSqueezed.add(current);
        }
    }
    return state.codexSqueezed.has(waypoint);
}

export function decorateWaypointLabel(ruler: RulerLike, waypoint: RulerWaypoint, state: LabelState, context: LabelContext): void {
    const { distance, cost } = waypoint.measurement;
    const surcharge = cost - distance;
    if (Number.isFinite(surcharge) && surcharge > 0.005) {
        context.cost.additional = { total: round(surcharge, 2), delta: round(Math.max(0, waypoint.cost - (waypoint.measurement.backward?.distance ?? 0)), 2) };
    }
    // Intermediate waypoints carry no label, so a squeeze anywhere up to this point marks this label.
    if (Number.isFinite(cost) && squeezedUpTo(ruler, waypoint, state)) context.squeezed = true;
    const floors = floorsFor(ruler, waypoint, state);
    if (floors) {
        const index = floors.chain.indexOf(waypoint);
        if (index >= 0) {
            const base = (canvas as unknown as { level?: { elevation?: { base?: number } } }).level?.elevation?.base ?? 0;
            const elevation = round(floors.elevations[index] - base, 2);
            const previous = index > 0 ? round(floors.elevations[index - 1] - base, 2) : elevation;
            context.elevation = { total: signed(elevation), icon: "fa-solid fa-arrows-up-down", hidden: elevation === 0 && previous === 0 };
            if (elevation !== previous) context.elevation.delta = signed(round(elevation - previous, 2));
            if (floors.refusedFrom !== null && index >= floors.refusedFrom) {
                context.climbRefused = true;
                const climb = (CONFIG.Token.movement.actions as Record<string, { icon?: string; img?: string }>).climb;
                context.climbIcon = climb?.icon ?? "fa-solid fa-person-through-window";
                context.climbImg = climb?.img;
                context.cssClass = `${context.cssClass} unreachable`.trim();
            }
        }
    }
    if (waypoint.next || !Number.isFinite(cost)) return;
    const system = ruler.token.actor?.system as { movement?: { speeds?: { land?: { value: number } } } } | undefined;
    const speed = system?.movement?.speeds?.land?.value ?? 0;
    if (!(speed > 0)) return;
    const history = ownTurn(ruler.token) ? ruler.token.measureMovementPath(ruler.token.document.movementHistory as never).cost : 0;
    const budget = movementBudget(speed, history + cost);
    context.actionCost = { actions: Math.min(3, budget.actions), overage: budget.actions > 3 };
    context.remaining = game.i18n!.format("codex-foundry.gridless.movementRemaining", {
        distance: String(round(budget.remaining, 1)), units: context.units,
    });
}

/** One ruler label on gridless scenes: native distance and elevation plus surcharge, action glyph, remaining budget and planned floors. */
export function activateMovementLabel(): void {
    const rulerClass = CONFIG.Token.rulerClass as unknown as RulerClass;
    const nativeTemplate = rulerClass.WAYPOINT_LABEL_TEMPLATE;
    Object.defineProperty(rulerClass, "WAYPOINT_LABEL_TEMPLATE", {
        configurable: true, get: () => isGridlessActive() ? TEMPLATE : nativeTemplate,
    });
    const original = rulerClass.prototype._getWaypointLabelContext;
    rulerClass.prototype._getWaypointLabelContext = function (waypoint, state) {
        const context = original.call(this, waypoint, state);
        if (context && isGridlessActive()) decorateWaypointLabel(this, waypoint, state, context);
        return context;
    };
}

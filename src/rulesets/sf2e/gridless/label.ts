import { MODULE_ID } from "../../../constants.js";
import { isGridlessActive } from "./settings.js";
import { ownTurn } from "./movement.js";
import {movementBudgetCost, terrainChecksRequired, previewSummary, routeBudget, type MovementPlan, type PreviewSummary, type BudgetLeg} from "../movement/index.js";
import {activatePauseMarker} from "../movement/index.js";
import { previewElevations, forcedIntent, forcedMovementHeld } from "../movement/index.js";
import { isSqueezedLeg } from "./routing.js";
import type { ElevationWaypoint } from "./elevation.js";

const TEMPLATE = `modules/${MODULE_ID}/dist/templates/gridless/waypoint-label.hbs`;

// Foundry 14 ruler shapes not yet represented by fvtt-types.
interface RulerWaypoint extends ElevationWaypoint {
    stage?: string;
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
    terrain?: PreviewSummary;
    budgetLabel?: string;
    budgetDescription?: string;
    budgetKnown?: boolean;
    hideBudget?: boolean;
    movementLabel?: string;
    distanceSegments?: number[];
    warningLabel?: string;
}
interface LabelState { codexSqueezed?: Set<RulerWaypoint>; codexFloors?: { elevations: number[]; refusedFrom: number | null; plan?:MovementPlan; chain: RulerWaypoint[] } | null }
interface RulerLike { token: Token.Implementation & { createTerrainMovementPath(points:never,options:{preview:boolean}):unknown[]; document: { parent: unknown; level: string; movementHistory: unknown[] } } }
type LabelContextFn = (this: RulerLike, waypoint: RulerWaypoint, state: LabelState) => LabelContext | undefined;
interface RulerClass { WAYPOINT_LABEL_TEMPLATE: string; prototype: { _getWaypointLabelContext: LabelContextFn } }

const round = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places;
const signed = (value: number): string => (value > 0 ? "+" : "") + String(value);

function chainFrom(waypoint: RulerWaypoint): RulerWaypoint[] {
    let head = waypoint;
    while (head.previous) head = head.previous;
    const chain: RulerWaypoint[] = [];
    for (let current: RulerWaypoint | undefined = head; current; current = current.next) chain.push(current);
    const planned=chain.findIndex(w=>w.stage==="planned");
    return planned>=0?chain.slice(planned):chain;
}

/** Floor heights along the whole drag, planned once per refresh and cached on the ruler's state. */
function floorsFor(ruler: RulerLike, waypoint: RulerWaypoint, state: LabelState): LabelState["codexFloors"] {
    if (state.codexFloors !== undefined) return state.codexFloors;
    const document = ruler.token.document;
    const chain = chainFrom(waypoint);
    const plan = previewElevations(document as unknown as Parameters<typeof previewElevations>[0], chain, forcedIntent(forcedMovementHeld()));
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
    if(waypoint.stage && waypoint.stage!=="planned")return;
    const { distance, cost } = waypoint.measurement;
    const surcharge = cost - distance;
    if (Number.isFinite(surcharge) && surcharge > 0.005) {
        context.cost.additional = { total: round(surcharge, 2), delta: round(Math.max(0, waypoint.cost - (waypoint.measurement.backward?.distance ?? 0)), 2) };
    }
    // Intermediate waypoints carry no label, so a squeeze anywhere up to this point marks this label.
    if (isGridlessActive() && Number.isFinite(cost) && squeezedUpTo(ruler, waypoint, state)) context.squeezed = true;
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
                context.cssClass = `${context.cssClass} codex-paused-route`.trim();
                if(floors.plan)context.terrain=previewSummary(ruler.token.document as unknown as Parameters<typeof previewSummary>[0],floors.plan);
            }
        }
    }
    if(context.terrain?.paused) context.warningLabel=context.terrain.label.replace(/^(Climb|Swim)\s*(?:·\s*)?/, "");
    if (waypoint.next || !Number.isFinite(cost)) return;
    const actor=ruler.token.actor as unknown as (Parameters<typeof routeBudget>[0]&{isOwner:boolean;alliance?:string})|null;
    if(!actor || (!actor.isOwner && actor.alliance!=="party")) {delete context.actionCost;return;}
    const plan=floors?.plan;
    if(plan && !context.terrain)context.terrain=previewSummary(ruler.token.document as unknown as Parameters<typeof previewSummary>[0],plan);
    const chain=floors?.chain??chainFrom(waypoint);
    let path=plan?.waypoints??chain.slice(1);
    if(plan?.transition) {
        const t=plan.transition,stop=path.indexOf(t.safe);
        path=path.slice(0,stop+1);
        if(t.reason==="climb" && t.landing.kind==="surface") path.push({...t.safe,elevation:t.landing.support.elevation,action:"climb"});
        if(t.reason==="swim")path.push({...t.after,action:"swim"});
    }
    // Regenerate terrain for generated transition points, then measure with history so
    // alternating square-grid diagonals retain their parity across the current position.
    const clean=[chain[0],...path].map(p=>{const point={...p} as Record<string,unknown>;delete point.cost;delete point.terrain;return point;});
    const expanded=ruler.token.createTerrainMovementPath(clean as never,{preview:true}) as unknown as typeof path;
    const history=ownTurn(ruler.token)?ruler.token.document.movementHistory as typeof path:[];
    const recorded=history.map(p=>{if(!["climb","crawl"].includes(p.action))return p;const point={...p} as typeof p&{cost?:number};delete point.cost;return point;});
    const points=[...recorded,...expanded.map((p,i)=>i===0?{...p,action:"displace",cost:0}:p)];
    const measured=ruler.token.document.measureMovementPath(points as never,{cost:movementBudgetCost(ruler.token.document)} as never) as unknown as {waypoints:{cost:number;distance:number}[]};
    const legs:BudgetLeg[]=points.slice(1).map((p,i)=>({action:p.action,cost:Math.max(0,measured.waypoints[i+1].cost-measured.waypoints[i].cost),
        check:i+1>=history.length && !!plan?.transition && ["climb","swim"].includes(p.action)}));
    const segments:{action:string;distance:number;estimated:boolean}[]=[];
    // Only the current planned path supplies the displayed segments; turn history
    // still contributes to the action budget below. Distances exclude terrain cost.
    for(let i=history.length+1;i<points.length;i++) {
        const distance=measured.waypoints[i].distance-measured.waypoints[i-1].distance;
        if(distance<=0)continue;
        const action=points[i].action==="travel"?"walk":points[i].action;
        const checks=action!=="climb" && action!=="swim" || terrainChecksRequired(ruler.token.document as never,action==="climb"?"climbing":"swimming");
        const estimated=checks && (routeBudget(actor,[legs[i-1]])?.estimated??false);
        const previous=segments.at(-1);
        if(previous?.action===action) {previous.distance+=distance;previous.estimated ||= estimated;}
        else segments.push({action,distance,estimated});
    }
    const names:Record<string,string>={walk:"Walk",climb:"Climb",swim:"Swim",fly:"Fly",crawl:"Crawl",step:"Step","codex-forced":"Forced","codex-fall":"Fall"};
    context.movementLabel=segments.map(s=>`${names[s.action]??s.action}${s.estimated?"*":""}`).join(" → ");
    // Mixed distances follow the displayed modes, through the first transition when paused.
    if(segments.length>1)context.distanceSegments=segments.map(s=>round(s.distance,2));
    if(context.distanceSegments || (!plan?.transition && segments.some(p=>["climb","crawl"].includes(p.action)))) {
        const end=measured.waypoints.at(-1)!,previous=measured.waypoints.at(-2)!;
        const start=measured.waypoints[history.length];
        const additional=Math.max(0,end.cost-end.distance-(context.distanceSegments?start.cost-start.distance:0));
        const delta=Math.max(0,(end.cost-previous.cost)-(end.distance-previous.distance));
        context.cost.additional=additional>0.005?{total:round(additional,2),delta:round(delta,2)}:undefined;
    }
    const terrainModes=segments.filter(s=>s.action==="climb" || s.action==="swim");
    const unchecked=terrainModes.length?terrainModes.every(s=>!terrainChecksRequired(ruler.token.document as never,s.action==="climb"?"climbing":"swimming")):
        !terrainChecksRequired(ruler.token.document as never,"climbing") && !terrainChecksRequired(ruler.token.document as never,"swimming");
    if(!plan?.transition && unchecked) {context.hideBudget=true;delete context.actionCost;delete context.remaining;return;}
    const budget=routeBudget(actor,legs);
    if(!budget) {delete context.actionCost;context.budgetLabel="GM ruling";return;}
    context.budgetKnown=true;
    context.actionCost=budget.actions?{actions:Math.min(3,budget.actions),overage:budget.actions>3}:undefined;
    context.budgetDescription=`${budget.estimated?"Estimated on success: ":""}${budget.actions} movement action${budget.actions===1?"":"s"}${plan?.transition?" through the first transition":""}`;
    context.remaining=!plan?.transition && budget.actions>0?`${round(budget.remaining,1)} ${context.units} left`:undefined;
}

/** One ruler label across grid types: native distance and elevation plus surcharge, action glyph, remaining budget and planned floors. */
export function activateMovementLabel(): void {
    const rulerClass = CONFIG.Token.rulerClass as unknown as RulerClass;
    const nativeTemplate = rulerClass.WAYPOINT_LABEL_TEMPLATE;
    Object.defineProperty(rulerClass, "WAYPOINT_LABEL_TEMPLATE", {
        configurable: true, get: () => game.settings!.get(MODULE_ID,"enableCustomRules") ? TEMPLATE : nativeTemplate,
    });
    activatePauseMarker();
    const original = rulerClass.prototype._getWaypointLabelContext;
    rulerClass.prototype._getWaypointLabelContext = function (waypoint, state) {
        if(waypoint.next && game.settings!.get(MODULE_ID,"enableCustomRules"))return undefined;
        const context = original.call(this, waypoint, state);
        if (context && game.settings!.get(MODULE_ID,"enableCustomRules")) decorateWaypointLabel(this, waypoint, state, context);
        return context;
    };
}

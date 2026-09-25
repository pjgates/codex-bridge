import { afterEach, describe, expect, it, vi } from "vitest";
import { activateMovementLabel } from "../../../src/rulesets/sf2e/gridless/label.js";

let squeezedLegs: boolean[] = [];
vi.mock("../../../src/rulesets/sf2e/gridless/routing.js", () => ({ isSqueezedLeg: () => squeezedLegs.shift() ?? false }));

afterEach(() => vi.unstubAllGlobals());

type Waypoint = Record<string, any>;

function setup(options: { gridless?: boolean; floors?: boolean; enforceClimb?: boolean; speed?: number; history?: number } = {}) {
    const { gridless = true, floors = false, enforceClimb = true, speed = 25, history = 0 } = options;
    class Ruler {
        static WAYPOINT_LABEL_TEMPLATE = "systems/pf2e/waypoint-label.hbs";
        token: any;
        constructor(token: any) { this.token = token; }
        _getWaypointLabelContext(waypoint: Waypoint, _state: object): Record<string, any> | undefined {
            if (!waypoint.previous && !waypoint.next) return undefined;
            return { cssClass: "", units: "ft", cost: { total: String(waypoint.measurement.cost), units: "ft" },
                elevation: { total: "+0", icon: "fa-solid fa-arrows-up-down", hidden: true } };
        }
    }
    // Floors along x: 0 ft below 100, 2.5 ft to 300, 7.5 ft beyond; centres are +50.
    const floor = (elevation: number, minX: number, maxX: number) => ({
        id:`floor-${elevation}`, levels: new Set(["floor"]), minX, polygonTree: { polygon: { points: [Math.max(-100000,minX),-100000,Math.min(100000,maxX),-100000,Math.min(100000,maxX),100000,Math.max(-100000,minX),100000] }, testPoint: (p: { x: number }) => p.x >= minX && p.x < maxX },
        behaviors: [{ type: "map-workshop-importer.setElevation", disabled: false, system: { elevation } }, {type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null,blocksSight:true,blocksLight:true}}],
    });
    const scene = { regions: floors ? [floor(0, -Infinity, 100), floor(2.5, 100, 300), floor(7.5, 300, Infinity)] : [] };
    const token = {
        actor: { isOwner:true, system: { movement: { speeds: { land: { value: speed } } } } },
        document: { _source:{x:0,y:0,elevation:0,level:"floor",action:"walk"}, parent: scene, level: "floor", movementHistory: history?[{x:0,y:0,elevation:0,action:"walk"},{x:history*20,y:0,elevation:0,action:"walk"}]:[],
            getMovementOrigin: (p: { x: number; y: number }) => ({ x: p.x + 50, y: p.y + 50 }) },
        createTerrainMovementPath: (points: any[]) => points,
        measureMovementPath: (points: any[]) => {let cost=0;return {waypoints:points.map((p,i)=>{if(i&&p.action!=="displace")cost+=Math.hypot((p.x-points[i-1].x)/20,(p.y-points[i-1].y)/20,p.elevation-points[i-1].elevation);return {cost,distance:cost};})};},
    };
    (token.document as any).measureMovementPath=(points:any[])=>token.measureMovementPath(points);
    vi.stubGlobal("CONFIG", { Token: { rulerClass: Ruler, movement: { TerrainData:{getMovementCostFunction:()=>()=>0},actions: { climb: { icon: "fa-solid fa-person-through-window" } } } } });
    vi.stubGlobal("CONST", { REGION_MOVEMENT_SEGMENTS: { ENTER: 1, MOVE: 0, EXIT: -1 } });
    vi.stubGlobal("game", { system: { id: "pf2e" }, combat: { started: true, combatant: { token: token.document } },
        settings: { get: (_ns: string, key: string) => key === "enforceClimb" ? enforceClimb : true },
        i18n: { format: (_key: string, data: { distance: string; units: string }) => `${data.distance} ${data.units} left` } });
    vi.stubGlobal("canvas", { ready: true, grid: { isGridless: gridless }, level: { elevation: { base: 0 } } });
    activateMovementLabel();
    const ruler = new Ruler(token);
    /** Build a linked chain of ruler waypoints from top-left positions with cumulative measurements. */
    const chain = (points: { x: number; distance?: number; cost?: number; action?: string }[]): Waypoint[] => {
        const waypoints: Waypoint[] = points.map((p, index) => ({ x: p.x, y: 0, elevation: 0, action: p.action ?? "walk", snapped: false,
            explicit: false, checkpoint: false, cost: p.cost ?? 0,
            measurement: { distance: p.distance ?? 0, cost: p.cost ?? p.distance ?? 0, backward: { distance: index ? (p.distance ?? 0) - (points[index - 1].distance ?? 0) : 0 } } }));
        waypoints.forEach((w, i) => { w.previous = waypoints[i - 1]; w.next = waypoints[i + 1]; });
        return waypoints;
    };
    const labels = (waypoints: Waypoint[]) => { const state = {}; return waypoints.map(w => ruler._getWaypointLabelContext(w, state)); };
    return { Ruler, ruler, chain, labels };
}

describe("merged ruler label", () => {
    it("swaps in the module template on every grid type while rules are active", () => {
        expect(setup().Ruler.WAYPOINT_LABEL_TEMPLATE).toBe("modules/codex-foundry/dist/templates/gridless/waypoint-label.hbs");
        vi.unstubAllGlobals();
        expect(setup({ gridless: false }).Ruler.WAYPOINT_LABEL_TEMPLATE).toBe("modules/codex-foundry/dist/templates/gridless/waypoint-label.hbs");
    });

    it("adds the action glyph and remaining budget to the last waypoint only", () => {
        const { chain, labels } = setup({ speed: 25, history: 10 });
        const [, middle, last] = labels(chain([{ x: 0 }, { x: 200, distance: 10 }, { x: 400, distance: 20 }]));
        expect(middle).toBeUndefined();
        expect(last!.actionCost).toEqual({ actions: 2, overage: false });
        expect(last!.remaining).toBe("20 ft left");
    });

    it("shows the cramped or terrain surcharge as an additional cost", () => {
        const { chain, labels } = setup();
        const [, last] = labels(chain([{ x: 0 }, { x: 200, distance: 16.98, cost: 19.12 }]));
        expect(last!.cost.additional).toEqual({ total: 2.14, delta: 2.14 });
        const [, plain] = labels(chain([{ x: 0 }, { x: 200, distance: 10, cost: 10 }]));
        expect(plain!.cost.additional).toBeUndefined();
    });

    it("also shows budgets and terrain surcharge on gridded scenes", () => {
        const { chain, labels } = setup({ gridless: false });
        const [, last] = labels(chain([{ x: 0 }, { x: 200, distance: 10, cost: 12 }]));
        expect(last!.actionCost).toEqual({actions:1,overage:false});
        expect(last!.cost.additional).toEqual({total:2,delta:2});
    });

    it("previews the planned floor height on the final label", () => {
        const { chain, labels } = setup({ floors: true });
        const [, step, further] = labels(chain([{ x: 0 }, { x: 150, distance: 7.5 }, { x: 250, distance: 12.5 }]));
        expect(step).toBeUndefined();
        expect(further!.elevation).toEqual({ total: "+2.5", icon: "fa-solid fa-arrows-up-down", hidden: false });
    });

    it("marks unresolved ledges and the retired enforceClimb preference cannot bypass a check", () => {
        const enforced = setup({ floors: true });
        const [, onStep, pastLedge] = enforced.labels(enforced.chain([{ x: 0 }, { x: 150, distance: 7.5 }, { x: 400, distance: 20 }]));
        expect(onStep).toBeUndefined();
        expect(pastLedge!.terrain).toMatchObject({label:"Climb ↑ 5 ft",paused:true});
        expect(pastLedge!.cssClass).toContain("codex-paused-route");
        expect(pastLedge!.terrain.reaction).toBe(false);
        expect(pastLedge!.elevation!.total).toBe("+2.5");
        vi.unstubAllGlobals();
        const relaxed = setup({ floors: true, enforceClimb: false });
        const [, , walked] = relaxed.labels(relaxed.chain([{ x: 0 }, { x: 150, distance: 7.5 }, { x: 400, distance: 20 }]));
        expect(walked!.terrain.paused).toBe(true);
        expect(walked!.elevation!.total).toBe("+2.5");
    });

    it("shows a squeeze anywhere in the route on the single final label", () => {
        const { chain, labels } = setup();
        // The mocked leg check reports only the second leg as squeezed.
        squeezedLegs = [false, true, false];
        const [, before, squeezedLeg, after] = labels(chain([{ x: 0 }, { x: 100, distance: 5 }, { x: 200, distance: 10, cost: 20 }, { x: 300, distance: 15, cost: 25 }]));
        expect(before).toBeUndefined();
        expect(squeezedLeg).toBeUndefined();
        expect(after!.squeezed).toBe(true);
    });
});

it('preserves flight altitude in the preview instead of snapping to ground',()=>{
 const {ruler,chain,labels}=setup({floors:true});
 ruler.token.document.actor={items:[{type:'effect',system:{slug:'codex-flying'}}]};
 const path=chain([{x:0,action:'fly'},{x:400,action:'fly'}]);path.forEach(p=>p.elevation=50);
 expect(labels(path)[1]?.elevation.total).toBe('+50');
 expect(labels(path)[1]?.climbRefused).toBeUndefined();
});

 it('counts recorded history once when native previous pointers include it',()=>{
   const {chain,labels}=setup({speed:25,history:25});
   const path=chain([{x:-500,distance:0},{x:0,distance:25},{x:0,distance:25},{x:200,distance:35}]);
   path.forEach((p,i)=>p.stage=i<2?'passed':'planned');
   const last=labels(path).at(-1)!;
   expect(last.actionCost).toEqual({actions:2,overage:false});
   expect(last.remaining).toBe('15 ft left');
 });
 it('uses fly and swim Speeds on gridded scenes',()=>{
   const {ruler,chain,labels}=setup({gridless:false});
   ruler.token.actor.system.movement.speeds.fly={value:40};
   ruler.token.actor.system.movement.speeds.swim={value:20};
   const fly=labels(chain([{x:0,action:'fly'},{x:600,action:'fly',distance:30}])).at(-1)!;
   expect(fly.actionCost).toEqual({actions:1,overage:false});
   expect(fly.remaining).toBe('10 ft left');
   const swim=labels(chain([{x:0,action:'swim'},{x:600,action:'swim',distance:30}])).at(-1)!;
   expect(swim.actionCost).toEqual({actions:2,overage:false});
 });

it('rebuilds difficult terrain before pricing generated preview legs',()=>{
 const {ruler,chain,labels}=setup({speed:25});
 ruler.token.createTerrainMovementPath=(points:any[])=>points.map(p=>({...p,terrain:{difficulty:2}}));
 ruler.token.measureMovementPath=(points:any[])=>{let cost=0;return {waypoints:points.map((p,i)=>{if(i&&p.action!=='displace')cost+=Math.abs(p.x-points[i-1].x)/20*(p.terrain?.difficulty??1);return {cost,distance:cost};})};};
 const last=labels(chain([{x:0},{x:400,distance:20,cost:40}])).at(-1)!;
 expect(last.actionCost).toEqual({actions:2,overage:false});
 expect(last.remaining).toBe('10 ft left');
});

it('does not reveal an unowned nonparty actor Speed through the budget',()=>{
 const {ruler,chain,labels}=setup();ruler.token.actor.isOwner=false;
 const last=labels(chain([{x:0},{x:300,distance:15}])).at(-1)!;
 expect(last.actionCost).toBeUndefined();expect(last.remaining).toBeUndefined();
});

it('shows ordered physical distances per mode without merging repeated modes or including history',()=>{
 const {ruler,chain,labels}=setup({history:10});
 ruler.token.actor.system.movement.speeds.climb={value:20};
 const last=labels(chain([{x:0},{x:100,action:'walk',distance:5},{x:200,action:'climb',distance:10},
   {x:300,action:'climb',distance:15},{x:400,action:'walk',distance:20,cost:30}])).at(-1)!;
 expect(last.movementLabel).toBe('Walk → Climb → Walk');
 expect(last.distanceSegments).toEqual([5,10,5]);
 expect(last.actionCost).toEqual({actions:3,overage:false});
 expect(last.cost.additional).toBeUndefined(); // Native Climb's generic multiplier is not extra terrain.
});

it('marks estimated climb progress on the mode name and keeps the check in a separate warning',()=>{
 const {chain,labels}=setup({floors:true});
 const last=labels(chain([{x:0},{x:400,distance:20}])).at(-1)!;
 expect(last.movementLabel).toContain('Climb*');
 expect(last.distanceSegments).toHaveLength(last.movementLabel.split(' → ').length);
 expect(last.budgetDescription).toContain('Estimated on success');
 expect(last.warningLabel).toBe('↑ 5 ft');
 expect(last.budgetKnown).toBe(true);
});

it('shows unchecked climb distances without estimates or an action budget',()=>{
 const {chain,labels}=setup({floors:true});
 vi.stubGlobal('game',{system:{id:'sf2e'},settings:{get:(_n:string,k:string)=>k==='terrainCheckOverride'?'':!['climbOutsideCombat','swimOutsideCombat'].includes(k)}});
 const last=labels(chain([{x:0},{x:400,distance:20}])).at(-1)!;
 expect(last.movementLabel).toBe('Walk → Climb → Walk');
 expect(last.distanceSegments[1]).toBe(5);
 expect(last.actionCost).toBeUndefined();expect(last.remaining).toBeUndefined();
 expect(last.hideBudget).toBe(true);
});

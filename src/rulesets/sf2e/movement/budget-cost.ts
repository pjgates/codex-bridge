interface Segment {action:string;actionConfig:{getCostFunction(token:unknown,options:object):(cost:number,from:unknown,to:unknown,distance:number,segment:Segment)=>number}}
type Cost=(from:unknown,to:unknown,distance:number,segment:Segment)=>number;
/** PF2e action allowances already account for slow Climb/Crawl progress. Core's generic
 * multiplier would count it twice. Terrain and other action costs still use native rules. */
export function movementBudgetCost(token:unknown):Cost {
    const terrain=(CONFIG.Token.movement.TerrainData as unknown as {getMovementCostFunction(token:unknown,options:object):Cost}).getMovementCostFunction(token,{preview:true});
    const actions=new Map<string,ReturnType<Segment["actionConfig"]["getCostFunction"]>>();
    return (from,to,distance,segment)=>{
        const cost=terrain(from,to,distance,segment);
        if(segment.action==="climb" || segment.action==="crawl")return cost;
        let action=actions.get(segment.action);
        if(!action) {action=segment.actionConfig.getCostFunction(token,{preview:true});actions.set(segment.action,action);}
        return action(cost,from,to,distance,segment);
    };
}

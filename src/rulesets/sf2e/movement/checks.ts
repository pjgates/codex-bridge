export type Degree = 0|1|2|3;
interface ActionResult { outcome?:string|null; message?:{uuid:string} }
interface SystemAction {use(options:{actors:object[];statistic:string;difficultyClass:{value:number};rollOptions?:string[]}):Promise<ActionResult[]>}
const outcomes:Record<string,Degree>={criticalFailure:0,failure:1,success:2,criticalSuccess:3};
export async function movementCheck(actor:object,slug:string,statistic:string,dc:number,marker?:string):Promise<ActionResult|null> {
    const action=(game as unknown as {pf2e:{actions:{get(slug:string):SystemAction|undefined}}}).pf2e.actions.get(slug);
    if(!action) throw new Error(`System action unavailable: ${slug}`);
    const [result]=await action.use({actors:[actor],statistic,difficultyClass:{value:dc},...(marker?{rollOptions:[marker]}:{})});
    return result??null;
}
export async function rollMovementCheck(actor:object,slug:string,statistic:string,dc:number):Promise<Degree|null> {
    const result=await movementCheck(actor,slug,statistic,dc);
    return result?.outcome ? outcomes[result.outcome]??null : null;
}
interface CheckMessage {
    author:{id:string}|null;speaker:{actor?:string};
    flags:Record<string,{context?:{type?:string;options?:string[];dc?:{value:number};outcome?:string}}>;
}
export function verifiedDegree(message:CheckMessage|null,expected:{userId:string;actorId:string;marker:string;dc:number;system:string;action:string;statistic:string}):Degree|null {
    const context=message?.flags[expected.system]?.context;
    if(message?.author?.id!==expected.userId || message?.speaker.actor!==expected.actorId ||
        !["skill-check","saving-throw"].includes(context?.type??"") || context?.dc?.value!==expected.dc || !context.options?.includes(expected.marker) ||
        !context.options.includes(`action:${expected.action}`) || !context.options.includes(`check:statistic:${expected.statistic}`)) return null;
    return outcomes[context.outcome??""]??null;
}

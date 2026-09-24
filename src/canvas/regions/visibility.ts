import {floorTop,readSurfaceGeometry} from './geometry.js';
import {isGeometryType} from './types.js';
import type {SurfaceRegion} from './support.js';

const MODULE='codex-foundry';
export interface VisibilityRequest {regionUuids:readonly string[];adoptBehaviorUuids?:readonly string[];apply?:boolean;fading?:'inherit'|'on'|'off'}
export interface VisibilityChange {ownerKey:string;documentUuid?:string;operation:'create'|'update'|'delete';data:Record<string,unknown>}
type Failure={ok:false;error:{code:'unauthorized'|'invalid-argument'|'operation-failed';message:string}};
type Flags=Record<string,Record<string,unknown>>;
interface Behavior {id:string;uuid:string;type:string;disabled:boolean;system:Record<string,unknown>;flags:Flags;parent:Region;update(data:object,options?:object):Promise<unknown>}
interface Region extends Omit<SurfaceRegion,'behaviors'> {
    documentName:string;uuid:string;name:string;flags:Flags;behaviors:Iterable<Behavior>;parent:Scene;
    bounds:{left:number;top:number;right:number;bottom:number};
    toObject():{shapes:unknown[]};update(data:object,options?:object):Promise<unknown>;delete():Promise<unknown>;
}
interface Scene {regions:Iterable<Region>;createEmbeddedDocuments(type:string,data:object[]):Promise<unknown>}
const busy=new Set<string>();
const dirty=new Set<string>();
const flag=(doc:{flags:Flags},key:string)=>doc.flags?.[MODULE]?.[key];
const owned=(region:Region,key:string)=>[...region.parent.regions].filter(r=>(flag(r,'surfaceSource')===region.uuid||flag(r,'surfaceSourceKey')===key)&&flag(r,'surfaceOwner')===key);

/** Pure document diff. Only explicit ownership/adoption can change a native blocker. */
export function visibilityChanges(region:Region,adopt:readonly string[]=[],fadingOverride?:VisibilityRequest['fading']):{changes:VisibilityChange[];conflicts:string[]} {
    const definitions=[...region.behaviors].filter(b=>isGeometryType(b.type));
    const key=String(region.flags?.['map-workshop']?.surfaceKey??flag(region,'surfaceVisibility')??definitions[0]?.uuid);
    const geometry=readSurfaceGeometry(region),top=floorTop(region);
    const active=geometry.extent!=='unknown'&&top!==null;
    const companionBehavior=owned(region,key).flatMap(r=>[...r.behaviors]).find(b=>b.type==='defineSurface');
    const override=fadingOverride??(companionBehavior&&flag(companionBehavior,'surfaceOcclusion'));
    const fading=override==='on'||(override!=='off'&&geometry.extent==='finite'&&game.settings?.get(MODULE,'surfaceFading')===true);
    const changes:VisibilityChange[]=[],conflicts:string[]=[];
    const add=(doc:{uuid:string}|undefined,data:Record<string,unknown>,operation:VisibilityChange['operation']='update')=>changes.push({ownerKey:key,documentUuid:doc?.uuid,operation,data});
    for(const b of region.behaviors) {
        if(b.type!=='defineSurface')continue;
        if(flag(b,'surfaceOwner')!==key&&!adopt.includes(b.uuid)) {
            if(!b.disabled&&(b.system.sight||b.system.light))conflicts.push(`Unmanaged blocker ${b.uuid} remains unchanged.`);
            continue;
        }
        const update:Record<string,unknown>={};
        // The source band may differ from the floor height. Only the companion owns these restrictions.
        for(const [field,value] of Object.entries({sight:false,light:false,occlusion:false})) {
            if(b.system[field]!==value)update[`system.${field}`]=value;
        }
        if(flag(b,'surfaceOwner')!==key)update[`flags.${MODULE}.surfaceOwner`]=key;
        if(Object.keys(update).length)add(b,update);
    }
    if(active&&(!geometry.blocksSight||!geometry.blocksLight))for(const other of region.parent.regions) {
        if(other===region||owned(region,key).includes(other))continue;
        const a=region.bounds,b=other.bounds;
        if(a.right<b.left||b.right<a.left||a.bottom<b.top||b.bottom<a.top)continue;
        for(const behavior of other.behaviors)if(!behavior.disabled&&behavior.type==='defineSurface'&&
            ((!geometry.blocksSight&&behavior.system.sight)||(!geometry.blocksLight&&behavior.system.light))) {
            conflicts.push(`Potential overlapping blocker ${behavior.uuid} remains unchanged; check its footprint and elevation.`);
        }
    }
    const companions=owned(region,key);
    if(!active){for(const r of companions)add(r,{},'delete');return {changes,conflicts};}
    const data={name:`Surface visibility: ${region.name??region.id}`,shapes:region.toObject().shapes,levels:[],elevation:{bottom:top,top},
        flags:{[MODULE]:{surfaceSource:region.uuid,surfaceOwner:key}},behaviors:[{type:'defineSurface',flags:{[MODULE]:{surfaceOcclusion:override??'inherit'}},system:{placement:'bottom',move:false,sight:geometry.blocksSight,light:geometry.blocksLight,sound:false,occlusion:fading,exposure:false,culling:false}}]};
    if(!companions.length)add(undefined,data,'create');
    else {
        const r=companions[0],update:Record<string,unknown>={};
        if(JSON.stringify(r.toObject().shapes)!==JSON.stringify(data.shapes))update.shapes=data.shapes;
        if(r.elevation?.bottom!==top||r.elevation?.top!==top)update.elevation=data.elevation;
        if([...r.levels].length)update.levels=[];
        if(Object.keys(update).length)add(r,update);
        const b=[...r.behaviors].find(b=>b.type==='defineSurface');
        if(b){const patch:Record<string,unknown>={};for(const[field,value]of Object.entries(data.behaviors[0].system)) {
            if(field!=='sound'&&b.system[field]!==value)patch[`system.${field}`]=value;
        }if(fadingOverride!==undefined&&flag(b,'surfaceOcclusion')!==fadingOverride)patch[`flags.${MODULE}.surfaceOcclusion`]=fadingOverride;if(b.disabled)patch.disabled=false;if(Object.keys(patch).length)add(b,patch);}
        else {add(r,{},'delete');add(undefined,data,'create');}
        for(const duplicate of companions.slice(1))add(duplicate,{},'delete');
    }
    return {changes,conflicts};
}

export async function configureSurfaceVisibility(request:VisibilityRequest):Promise<Failure|{ok:true;changes:VisibilityChange[];conflicts:string[];applied:boolean}> {
    const fail=(code:Failure['error']['code'],message:string):Failure=>({ok:false,error:{code,message}});
    if(!game.user?.isGM)return fail('unauthorized','Only a GM can configure surface visibility.');
    if(!request||!Array.isArray(request.regionUuids)||request.regionUuids.length>1000||
        request.regionUuids.some(u=>typeof u!=='string'||!/^Scene\.[\w-]+\.Region\.[\w-]+$/.test(u))||
        (request.adoptBehaviorUuids!==undefined&&(!Array.isArray(request.adoptBehaviorUuids)||request.adoptBehaviorUuids.some(u=>typeof u!=='string')))||
        (request.apply!==undefined&&typeof request.apply!=='boolean')||(request.fading!==undefined&&!['inherit','on','off'].includes(request.fading)))return fail('invalid-argument','Supply regionUuids, optional adoptBehaviorUuids and boolean apply.');
    const regions=request.regionUuids.map(u=>fromUuidSync(u) as unknown as Region);
    if(regions.some(r=>r?.documentName!=='Region'))return fail('invalid-argument','A requested region was not found.');
    const adopt=request.adoptBehaviorUuids??[];
    if(adopt.some(u=>!regions.some(r=>[...r.behaviors].some(b=>b.uuid===u&&b.type==='defineSurface'))))return fail('invalid-argument','Adopt only native behaviours on the selected regions.');
    const changes:VisibilityChange[]=[],conflicts:string[]=[];
    for(const region of regions) {
        if(busy.has(region.uuid))return fail('operation-failed','Surface visibility is already being updated.');
        busy.add(region.uuid);
        try {
            const plan=visibilityChanges(region,adopt,request.fading);changes.push(...plan.changes);conflicts.push(...plan.conflicts);
            if(!request.apply)continue;
            const key=region.flags?.['map-workshop']?.surfaceKey??flag(region,'surfaceVisibility')??[...region.behaviors].find(b=>isGeometryType(b.type))?.uuid;
            if(!key)continue;
            if(flag(region,'surfaceVisibility')!==key)await region.update({[`flags.${MODULE}.surfaceVisibility`]:key});
            for(const change of plan.changes) {
                if(change.operation==='create')await region.parent.createEmbeddedDocuments('Region',[change.data]);
                else {
                    const doc=fromUuidSync(change.documentUuid!) as unknown as Region;
                    if(change.operation==='delete')await doc.delete();else await doc.update(change.data,{codexSurfaceVisibility:true});
                }
            }
        }catch(error){return fail('operation-failed',(error as Error).message);}
        finally{
            busy.delete(region.uuid);
            if(dirty.delete(region.uuid)&&game.user?.id===game.users?.activeGM?.id) {
                await configureSurfaceVisibility({regionUuids:[region.uuid],apply:true});
            }
        }
    }
    return {ok:true,changes,conflicts,applied:request.apply===true};
}

export function activateSurfaceVisibility():void {
    const active=()=>game.user?.id===game.users?.activeGM?.id;
    const reconcile=async(region:Region)=>{
        if(!active()||flag(region,'surfaceSource')||flag(region,'surfaceSourceKey'))return;
        if(busy.has(region.uuid)){dirty.add(region.uuid);return;}
        const exported=[...region.behaviors].some(b=>flag(b,'surfaceOwner'));
        if(flag(region,'surfaceVisibility')||exported)await configureSurfaceVisibility({regionUuids:[region.uuid],apply:true});
    };
    Hooks.on('updateRegion',r=>reconcile(r as unknown as Region));
    Hooks.on('createRegion',r=>reconcile(r as unknown as Region));
    for(const event of ['createRegionBehavior','deleteRegionBehavior'] as const)Hooks.on(event,(b:RegionBehavior)=>reconcile(b.parent as unknown as Region));
    Hooks.on('preUpdateRegionBehavior',(behavior,changes,options)=>{
        const b=behavior as unknown as Behavior;
        const value=(changes as Record<string,unknown>)['system.occlusion'] ?? (changes as {system?:{occlusion?:boolean}}).system?.occlusion;
        if(b.type==='defineSurface'&&typeof value==='boolean'&&flag(b.parent,'surfaceOwner')&&
            !(options as {codexSurfaceVisibility?:boolean}).codexSurfaceVisibility) {
            // Persist the manual choice atomically with the native checkbox, on its authoring client.
            (changes as Record<string,unknown>)[`flags.${MODULE}.surfaceOcclusion`]=value?'on':'off';
        }
    });
    Hooks.on('updateRegionBehavior',b=>reconcile(b.parent as unknown as Region));
    Hooks.on('deleteRegion',async r=>{if(!active()||flag(r as unknown as Region,'surfaceSource')||flag(r as unknown as Region,'surfaceSourceKey'))return;
        const source=r as unknown as Region,key=String(source.flags?.['map-workshop']?.surfaceKey??flag(source,'surfaceVisibility'));
        for(const companion of owned(source,key))await companion.delete();});
    for(const scene of game.scenes??[])for(const region of scene.regions)void reconcile(region as unknown as Region);
}

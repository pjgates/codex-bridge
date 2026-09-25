import { afterEach, expect, it, vi } from 'vitest';
import { legacyTypeUpdate, migrateLegacy } from '../../../src/canvas/regions/migration.js';
afterEach(()=>vi.unstubAllGlobals());
it('replaces only legacy types while retaining embedded identity',()=>{
    expect(legacyTypeUpdate({_id:'kept',type:'map-workshop-importer.water'})).toEqual({_id:'kept',type:'codex-foundry.water'});
    expect(legacyTypeUpdate({_id:'kept',type:'codex-foundry.water'})).toBeNull();
});
it('previews without writes, applies once, and rejects non-GMs',async()=>{
    class Replacement {constructor(public value:object){}}
    vi.stubGlobal('foundry',{data:{operators:{ForcedReplacement:Replacement}}});
    const behavior={toObject:()=>({system:{depth:12}}),id:'kept',type:'map-workshop-importer.water',uuid:'Scene.s.Region.r.RegionBehavior.kept'};
    const update=vi.fn(async (_type:string,changes:{type:string}[])=>{behavior.type=changes[0].type;});
    const scene={documentName:'Scene',regions:[{behaviors:[behavior],updateEmbeddedDocuments:update}]};
    vi.stubGlobal('game',{user:{isGM:true}}); vi.stubGlobal('fromUuidSync',()=>scene);
    expect((await migrateLegacy({sceneUuids:['Scene.s']})).ok).toBe(true); expect(update).not.toHaveBeenCalled();
    await migrateLegacy({sceneUuids:['Scene.s'],apply:true}); expect(update.mock.calls[0][1][0]).toMatchObject({system:new Replacement({depth:12})}); await migrateLegacy({sceneUuids:['Scene.s'],apply:true}); expect(update).toHaveBeenCalledTimes(1);
    (game.user as unknown as {isGM:boolean}).isGM=false;
    expect(await migrateLegacy({sceneUuids:['Scene.s'],apply:true})).toMatchObject({ok:false,error:{code:'unauthorized'}});
});
it('reports per-scene failures without claiming complete migration',async()=>{
    vi.stubGlobal('game',{user:{isGM:true}}); vi.stubGlobal('fromUuidSync',()=>null);
    expect(await migrateLegacy({sceneUuids:['Scene.missing'],apply:true})).toMatchObject({ok:true,scenes:[{sceneUuid:'Scene.missing',error:expect.any(String)}]});
});

it('reports a silently ignored Foundry update instead of claiming migration',async()=>{
 const behavior={id:'kept',type:'map-workshop-importer.water',uuid:'Scene.s.Region.r.RegionBehavior.kept',toObject:()=>({system:{}})};
 vi.stubGlobal('foundry',{data:{operators:{ForcedReplacement:class{constructor(public value:object){}}}}});
 vi.stubGlobal('game',{user:{isGM:true}});vi.stubGlobal('fromUuidSync',()=>({documentName:'Scene',regions:[{behaviors:[behavior],updateEmbeddedDocuments:async()=>[]}]}));
 expect(await migrateLegacy({sceneUuids:['Scene.s'],apply:true})).toMatchObject({ok:true,scenes:[{changed:[],error:expect.stringContaining('not applied')}]});
});

it('migrates the geometry subtype while retaining its embedded document identity',()=>{
 expect(legacyTypeUpdate({_id:'geometry',type:'map-workshop-importer.surfaceGeometry'})).toEqual({_id:'geometry',type:'codex-foundry.surfaceGeometry'});
});

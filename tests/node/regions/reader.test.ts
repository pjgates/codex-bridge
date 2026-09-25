import { expect, it } from 'vitest';
import { isFloorType, isWaterType } from '../../../src/canvas/regions/index.js';
import { allFloors, allWater } from '../../../src/rulesets/sf2e/gridless/floors.js';
it('accepts only the canonical and legacy namespaces',()=>{
    expect(['codex-foundry.setElevation','map-workshop-importer.setElevation'].every(isFloorType)).toBe(true);
    expect(['codex-foundry.water','map-workshop-importer.water'].every(isWaterType)).toBe(true);
    expect(isFloorType('terrainmapper.setElevation')).toBe(false);
});
it('reads one floor per region and ignores disabled markers',()=>{
    const behavior=(type:string,disabled=false)=>({type,disabled,system:{elevation:10}});
    const region={levels:new Set(['one']),polygonTree:{testPoint:()=>true},elevation:{bottom:0,top:10},behaviors:[behavior('codex-foundry.setElevation'),behavior('map-workshop-importer.setElevation'),behavior('codex-foundry.water')]};
    expect(allFloors({regions:[region]})).toEqual([{region,floor:10}]);
    expect(allWater({regions:[region]})).toEqual([{region,surface:10,bed:0}]);
    expect(allFloors({regions:[{...region,behaviors:[behavior('codex-foundry.setElevation',true)]}]})).toEqual([]);
});

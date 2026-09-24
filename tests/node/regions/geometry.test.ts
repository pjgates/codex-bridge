import { expect, it } from 'vitest';
import { geometryPreset, readSurfaceGeometry, validateGeometry } from '../../../src/canvas/regions/geometry.js';
import type { SurfaceRegion } from '../../../src/canvas/regions/support.js';
const floor={type:'codex-foundry.setElevation',disabled:false,system:{elevation:20}};
const shape=(system:object,disabled=false)=>({type:'codex-foundry.surfaceGeometry',disabled,system});
const region=(...behaviors:ReturnType<typeof shape>[]):SurfaceRegion=>({id:'geometry-test',levels:new Set(),polygonTree:{testPoint:()=>true},behaviors:[floor,...behaviors]});
it('leaves missing, disabled, duplicated and invalid persisted geometry unresolved',()=>{
 for(const r of [region(),region(shape({extent:'solid'},true)),region(shape({extent:'solid'}),shape({extent:'solid'})),region(shape({extent:'finite',underside:21,blocksSight:true,blocksLight:true}))]) {
  expect(readSurfaceGeometry(r).extent).toBe('unknown');
 }
});
it('preserves fractional undersides and independent visibility choices',()=>{
 expect(readSurfaceGeometry(region(shape({extent:'finite',underside:17.5,blocksSight:false,blocksLight:true})))).toEqual({extent:'finite',underside:17.5,blocksSight:false,blocksLight:true});
});
it('presets require an authored underside for suspended material',()=>{
 expect(geometryPreset('catwalk',3)).toEqual({extent:'finite',underside:3,blocksSight:false,blocksLight:false});
 expect(geometryPreset('solid',null)).toEqual({extent:'solid',underside:null,blocksSight:true,blocksLight:true});
 expect(()=>geometryPreset('deck',null)).toThrow();
 expect(()=>validateGeometry(geometryPreset('deck',20),20)).toThrow();
});

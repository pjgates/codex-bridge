import { expect,it } from 'vitest';
import {regionDC} from '../../../src/canvas/regions/config.js';
it('uses an explicit edge DC, then climb DC, and preserves a zero DC',()=>{
 expect(regionDC({climbDC:20},'grab-an-edge')).toBe(20);
 expect(regionDC({climbDC:20,grabEdgeDC:15},'grab-an-edge')).toBe(15);
 expect(regionDC({climbDC:0},'climb')).toBe(0);
 expect(regionDC({},'climb')).toBeNull();
 expect(regionDC({climbDC:-2},'climb')).toBeNull();
 expect(regionDC({climbDC:'20'},'climb')).toBeNull();
});
it('reads behaviour DCs and terrain presets before legacy region values',async()=>{
 const {terrainDC}=await import('../../../src/canvas/regions/config.js');
 const floor={flags:{'codex-foundry':{climbDC:17,grabEdgeDC:19}},behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{climbPreset:'expert',climbDC:null,grabEdgeDC:null}}]};
 expect(terrainDC(floor as never,'climb')).toBe(20);expect(terrainDC(floor as never,'grab-an-edge')).toBe(20);
 floor.behaviors[0].system.climbDC=23 as never;expect(terrainDC(floor as never,'climb')).toBe(23);
 floor.behaviors[0].system.climbDC=null;floor.behaviors[0].system.climbPreset='legacy';expect(terrainDC(floor as never,'climb')).toBe(17);
 expect(terrainDC({behaviors:[{type:'codex-foundry.water',disabled:false,system:{swimPreset:'stormy'}}]} as never,'swim')).toBe(30);
 expect(terrainDC({behaviors:[]} as never,'swim')).toBeNull();
});

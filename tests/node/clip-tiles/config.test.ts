// @vitest-environment happy-dom
import {afterEach, expect, it, vi} from 'vitest';
import {clipRegionField} from '../../../src/canvas/clip-tiles/config.js';
afterEach(()=>vi.unstubAllGlobals());
it('shows legacy selections, multiple exclusions and removable missing regions',()=>{
 vi.stubGlobal('game',{i18n:{localize:(key:string)=>key}});
 const field=clipRegionField({id:'tile',flags:{'codex-foundry':{clipRegion:'a',excludeRegions:['b','deleted']}},parent:{regions:{contents:[{id:'a',name:'Island'},{id:'b',name:'Bridge'}]}}} as never);
 const selected=(name:string)=>[...field.querySelectorAll<HTMLOptionElement>(`multi-select[name="flags.codex-foundry.${name}"] option`)].filter(o=>o.selected).map(o=>o.value);
 expect(selected('clipRegions')).toEqual(['a']);
 expect(selected('excludeRegions')).toEqual(['b','deleted']);
 expect(field.textContent).toContain('Missing region (deleted)');
});

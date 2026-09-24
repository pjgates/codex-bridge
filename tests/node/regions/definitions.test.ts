import { afterEach, expect, it, vi } from 'vitest';
import { registerRegionBehaviors } from '../../../src/canvas/regions/index.js';
afterEach(()=>vi.unstubAllGlobals());
it('registers independently owned inert floor and water definitions', () => {
    class Field { constructor(public options:object) {} }
    vi.stubGlobal('foundry',{data:{regionBehaviors:{RegionBehaviorType:class{}},fields:{NumberField:Field,StringField:Field,BooleanField:Field}}});
    const registry={dataModels:{} as Record<string,{defineSchema:()=>object;events:object}>,typeIcons:{}};
    vi.stubGlobal('CONFIG',{RegionBehavior:registry}); registerRegionBehaviors();
    expect(Object.keys(registry.dataModels)).toEqual(['codex-foundry.setElevation','codex-foundry.water','codex-foundry.surfaceGeometry']);
    expect(registry.dataModels['codex-foundry.setElevation'].defineSchema()).toMatchObject({elevation:new Field({required:true,nullable:false,initial:0})});
    expect(registry.dataModels['codex-foundry.water'].defineSchema()).toHaveProperty('swimDC');
    expect(registry.dataModels['codex-foundry.setElevation'].events).toEqual({});
});

import { afterEach, expect, it, vi } from "vitest";
import { movementFeatureEnabled, movementOutcomeMode, registerMovementSettings } from "../../../src/rulesets/sf2e/movement/settings.js";
afterEach(() => vi.unstubAllGlobals());
it('defaults to advisory and disables every feature when rules are off', () => {
    const values: Record<string, unknown> = {enableCustomRules:true};
    vi.stubGlobal('game',{settings:{register:(_module:string,key:string,data:{default:unknown})=>{values[key]=data.default;},get:(_module:string,key:string)=>values[key]}});
    registerMovementSettings();
    expect(movementOutcomeMode()).toBe('advisory'); expect(movementFeatureEnabled('flightUpkeep')).toBe(false);
    expect(movementFeatureEnabled('falling')).toBe(true);
    values.enableFlightUpkeep=true; values.enableFalling=false;
    expect(movementFeatureEnabled('flightUpkeep')).toBe(false);
    values.enableCustomRules=false;
    for(const feature of ['climbing','falling','forcedMovement','flightUpkeep'] as const) expect(movementFeatureEnabled(feature)).toBe(false);
});

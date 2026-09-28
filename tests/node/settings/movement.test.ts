import { afterEach, expect, it, vi } from "vitest";
import { movementFeatureEnabled, movementOutcomeMode, registerMovementSettings } from "../../../src/rulesets/sf2e/movement/settings.js";
afterEach(() => vi.unstubAllGlobals());
it('defaults to advisory and disables every feature when rules are off', () => {
    const values: Record<string, unknown> = {enableCustomRules:true};
    vi.stubGlobal('game',{settings:{register:(_module:string,key:string,data:{default:unknown})=>{values[key]=data.default;},get:(_module:string,key:string)=>values[key]}});
    vi.stubGlobal('Hooks',{on() {}});
    registerMovementSettings();
    expect(values.movementHazardStyle).toBe('plus');
    expect(movementOutcomeMode()).toBe('advisory'); expect(movementFeatureEnabled('flightUpkeep')).toBe(false);
    expect(movementFeatureEnabled('falling')).toBe(true);
    values.enableFlightUpkeep=true; values.enableFalling=false;
    expect(movementFeatureEnabled('flightUpkeep')).toBe(false);
    values.enableCustomRules=false;
    for(const feature of ['climbing','falling','forcedMovement','flightUpkeep'] as const) expect(movementFeatureEnabled(feature)).toBe(false);
});

it('lets the Codex Pathfinding control switch between automatic and direct grid movement', async () => {
    const values: Record<string, unknown> = { enableCustomRules: true };
    const callbacks: Record<string, (nextControls: typeof controls) => void> = {};
    const controls = { tokens: { tools: {} as Record<string, { active: boolean; onChange(event: Event, active: boolean): Promise<unknown> }> } };
    vi.stubGlobal('canvas', { grid: { isGridless: false } });
    vi.stubGlobal('game', { settings: {
        register: (_module: string, key: string, data: { default: unknown }) => { values[key] = data.default; },
        get: (_module: string, key: string) => values[key],
        set: async (_module: string, key: string, value: unknown) => { values[key] = value; },
    } });
    vi.stubGlobal('Hooks', { on: (name: string, callback: typeof callbacks[string]) => { callbacks[name] = callback; } });
    registerMovementSettings();
    callbacks.getSceneControlButtons?.(controls);
    expect(controls.tokens.tools.pathfinding?.active).toBe(true);
    await controls.tokens.tools.pathfinding.onChange({} as Event, false);
    callbacks.getSceneControlButtons(controls);
    expect(controls.tokens.tools.pathfinding.active).toBe(false);
});

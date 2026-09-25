import { afterEach, expect, it, vi } from "vitest";
import { migrateSettings, utilityEnabled, utilityUpgrade } from "../../../src/settings/migration.js";
afterEach(() => vi.unstubAllGlobals());
function setup(master = false) {
    const values: Record<string, unknown> = {enableCustomRules: master, enableCodexSync:true, enableStatblockImporter:true, settingsVersion:0, enforceClimb:true, promptMovementChecks:true};
    const settings = {storage:new Map([["world",new Map()]]), get: (_module: string, key: string) => values[key], set: vi.fn(async (_module: string, key: string, value: unknown) => { values[key] = value; })};
    const user = {id:'gm',isGM:true};
    vi.stubGlobal('game', {user, users:{activeGM:user}, settings});
    return {values,settings};
}
it('preserves effective preferences when separating utilities', () => {
    expect(utilityUpgrade(false,true,true)).toEqual({enableCodexSync:false,enableStatblockImporter:false});
    expect(utilityUpgrade(true,false,true)).toEqual({enableCodexSync:false,enableStatblockImporter:true});
});
it('is idempotent and never reads or writes the client passphrase', async () => {
    const {values,settings}=setup(); await migrateSettings(); await migrateSettings();
    expect(values.enableCodexSync).toBe(false); expect(values.enableStatblockImporter).toBe(false);
    expect(settings.set.mock.calls.map(call => call[1])).toEqual(['enableCodexSync','enableStatblockImporter','enableClimbing','settingsVersion']);
});
it('does not complete a partially failed migration and safely retries', async () => {
    const {values,settings}=setup(); settings.set.mockImplementationOnce(async (_module,key,value) => {values[key]=value;}).mockRejectedValueOnce(new Error('offline'));
    await expect(migrateSettings()).rejects.toThrow('offline'); expect(values.settingsVersion).toBe(0);
    await migrateSettings(); expect(values.enableCodexSync).toBe(false); expect(values.enableStatblockImporter).toBe(false);
});
it('keeps old effective gates until the active GM completes migration', async () => {
    const {values,settings}=setup(); (game as unknown as {user:object}).user={id:'player',isGM:false};
    await migrateSettings(); expect(settings.set).not.toHaveBeenCalled(); expect(utilityEnabled('enableCodexSync')).toBe(false);
    values.settingsVersion=1; expect(utilityEnabled('enableCodexSync')).toBe(true);
});
it('seeds climbing from legacy preferences but preserves an explicit new preference', async () => {
    const {values}=setup(true);
    values.settingsVersion=1; values.enforceClimb=false; values.promptMovementChecks=false;
    const stored = new Map();
    (game.settings as unknown as {storage:Map<string,unknown>}).storage=new Map([['world',stored]]);
    await migrateSettings(); expect(values.enableClimbing).toBe(false);
    values.settingsVersion=1; values.enableClimbing=true;
    stored.set('codex-foundry.enableClimbing',{});
    await migrateSettings(); expect(values.enableClimbing).toBe(true);
});

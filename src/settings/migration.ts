import { MODULE_ID } from "../constants.js";

type Utility = "enableCodexSync" | "enableStatblockImporter";
export function utilityUpgrade(master: boolean, sync: boolean, importer: boolean): Record<Utility, boolean> {
    return { enableCodexSync: master && sync, enableStatblockImporter: master && importer };
}

export function registerSettingsMigration(): void {
    game.settings!.register(MODULE_ID, "settingsVersion", { scope: "world", config: false, type: Number, default: 0 });
}

/** Before migration, retain the old master gate on every client. */
export function utilityEnabled(key: Utility): boolean {
    return Boolean(game.settings!.get(MODULE_ID, key)) &&
        (game.settings!.get(MODULE_ID, "settingsVersion") >= 1 || Boolean(game.settings!.get(MODULE_ID, "enableCustomRules")));
}

export async function migrateSettings(): Promise<void> {
    if (game.users?.activeGM?.id !== game.user?.id || !game.user?.isGM) return;
    if (game.settings!.get(MODULE_ID, "settingsVersion") >= 2) return;
    if (game.settings!.get(MODULE_ID, "settingsVersion") < 1) {
    const values = utilityUpgrade(game.settings!.get(MODULE_ID, "enableCustomRules"),
        game.settings!.get(MODULE_ID, "enableCodexSync"), game.settings!.get(MODULE_ID, "enableStatblockImporter"));
    for (const key of ["enableCodexSync", "enableStatblockImporter"] as const) {
        if (game.settings!.get(MODULE_ID, key) !== values[key]) await game.settings!.set(MODULE_ID, key, values[key]);
    }
    }
    if (!game.settings!.storage.get("world")!.has(`${MODULE_ID}.enableClimbing`)) {
        await game.settings!.set(MODULE_ID, "enableClimbing", game.settings!.get(MODULE_ID, "enforceClimb") || game.settings!.get(MODULE_ID, "promptMovementChecks"));
    }
    await game.settings!.set(MODULE_ID, "settingsVersion", 2);
}

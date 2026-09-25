import { MODULE_ID } from "../../../constants.js";
const keys = { climbing: "enableClimbing", swimming: "enableSwimming", falling: "enableFalling", flightUpkeep: "enableFlightUpkeep", forcedMovement: "enableForcedMovement" } as const;
export type MovementFeature = keyof typeof keys;
export function registerMovementSettings(): void {
    game.settings!.register(MODULE_ID,"explorationMovementNotices",{
        name:`${MODULE_ID}.settings.explorationMovementNotices.name`,hint:`${MODULE_ID}.settings.explorationMovementNotices.hint`,
        scope:"world",config:true,type:Boolean,default:true,
    });
    for (const [feature, key] of Object.entries(keys)) {
        game.settings!.register(MODULE_ID, key, {
            name: `${MODULE_ID}.settings.${key}.name`, hint: `${MODULE_ID}.settings.${key}.hint`,
            scope: "world", config: true, type: Boolean, default: feature !== "flightUpkeep", requiresReload: true,
        });
    }
    game.settings!.register(MODULE_ID, "movementOutcomeMode", {
        name: `${MODULE_ID}.settings.movementOutcomeMode.name`, hint: `${MODULE_ID}.settings.movementOutcomeMode.hint`,
        scope: "world", config: true, type: String, default: "advisory",
        choices: { advisory: `${MODULE_ID}.movement.advisory`, apply: `${MODULE_ID}.movement.apply` },
    });
}
export function movementFeatureEnabled(feature: MovementFeature): boolean {
    return Boolean(game.settings!.get(MODULE_ID, "enableCustomRules")) && Boolean(game.settings!.get(MODULE_ID, keys[feature])) &&
        (feature !== "flightUpkeep" || Boolean(game.settings!.get(MODULE_ID, "enableFalling")));
}
export function movementOutcomeMode(): "advisory" | "apply" {
    return game.settings!.get(MODULE_ID, "movementOutcomeMode") === "apply" ? "apply" : "advisory";
}

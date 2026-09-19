import { activateTokenGeometry } from "./tokens.js";
import { activateCover } from "./cover.js";
import { activateAreaTargeting } from "./areas.js";
import { activateMovementRings } from "./movement.js";
import { activateFlankingGuide } from "./flanking.js";
import { activateGridlessRouting } from "./routing.js";
import { activateMovementLabel } from "./label.js";

export { registerGridlessSetting } from "./settings.js";
export { registerMovementPreviewKeybind } from "./movement.js";
export { activateFloorElevation, registerFloorSetting } from "./floors.js";
export { activateMovementChecks, registerMovementCheckSetting } from "./checks.js";

export function activateGridlessCombat(): void {
    if (!["pf2e", "sf2e"].includes(game.system!.id)) return;
    activateTokenGeometry();
    activateCover();
    activateAreaTargeting();
    activateGridlessRouting();
    activateMovementRings();
    activateMovementLabel();
    activateFlankingGuide();
}

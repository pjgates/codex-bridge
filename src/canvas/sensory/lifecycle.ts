import { lookupWorldDefinition } from "./definition.js";
import { detectGlows, nativeSensoryWallBlocks } from "./frame.js";
import { collectEmitters, type SensoryScene } from "./geometry.js";
import { clearSensoryGlows, renderSensoryGlows } from "./glow.js";
import { selectedObservers } from "./observers.js";
import type { SensoryTokenDocument, SensoryUser } from "./types.js";
let registered: typeof Hooks | null = null;
let frame: number | null = null;
let generation = 0;
export function refreshSensoryGlows(): void {
    if (!canvas?.ready || !canvas.scene || !game.user) { clearSensoryGlows(); return; }
    const selected = canvas.tokens!.controlled.map(token => token.document) as unknown as SensoryTokenDocument[];
    const viewers = selectedObservers(selected, game.user as SensoryUser, lookupWorldDefinition);
    renderSensoryGlows(detectGlows(viewers, collectEmitters(canvas.scene as unknown as SensoryScene, lookupWorldDefinition),
        canvas.dimensions!.distancePixels, nativeSensoryWallBlocks));
}
function schedule(): void {
    if (frame !== null) return;
    const current = generation;
    frame = requestAnimationFrame(() => { frame = null; if (current === generation) refreshSensoryGlows(); });
}
export function activateSensoryCanvas(): void {
    if (registered === Hooks) return;
    registered = Hooks;
    const hooks = Hooks as unknown as { on(event: string, callback: (...args: never[]) => void): unknown };
    for (const event of ["canvasReady", "controlToken", "createToken", "updateToken", "deleteToken", "createItem", "updateItem", "deleteItem",
        "updateActor", "deleteActor", "updateUser", "createTile", "updateTile", "deleteTile", "createRegion", "updateRegion", "deleteRegion",
        "createLevel", "updateLevel", "deleteLevel", "updateWorldTime", "updateCombat", "updateScene", "createWall", "updateWall", "deleteWall"]) hooks.on(event, schedule);
    Hooks.on("refreshToken", (_token: Token.Implementation, flags: Record<string, boolean> = {}) => {
        if (flags.refreshPosition || flags.refreshElevation || flags.refreshSize) schedule();
    });
    Hooks.on("canvasTearDown", () => {
        generation++; if (frame !== null) cancelAnimationFrame(frame); frame = null; clearSensoryGlows();
    });
    schedule();
}

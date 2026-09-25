import type { MovementToken, Waypoint } from "./transitions.js";

/** Recheck across every awaited write; a different move or placement invalidates this outcome. */
export function assertMovementUnchanged(token:MovementToken,id:string,position:Pick<Waypoint,"x"|"y"|"elevation"|"level">,state="paused"):void {
    if((token.movement.id!==id && !token.movement.chain?.includes(id)) || token.movement.state!==state || (["x","y","elevation","level"] as const).some(key=>token._source[key]!==position[key])) {
        throw new Error("Movement changed while resolving this request. Inspect the token before continuing.");
    }
}

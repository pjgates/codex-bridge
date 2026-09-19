import { MODULE_ID } from "../../../constants.js";
import { STEP_FEET } from "./elevation.js";
import { isGridlessActive } from "./settings.js";
import { isSqueezedLeg } from "./routing.js";

export const SETTING_PROMPT_CHECKS = "promptMovementChecks";
const EPSILON = 1e-6;

interface CheckWaypoint { x: number; y: number; elevation: number; action: string; level?: string; width: number; height: number; shape: number; depth?: number }
interface CheckMovement { origin: CheckWaypoint; passed: { waypoints: CheckWaypoint[] } }
interface CheckToken { actor: object | null; object: Token.Implementation | null; _source: { level: string } }
interface SystemAction { use(options: { actors: object[] }): Promise<unknown> }

function systemAction(slug: string): SystemAction | undefined {
    const system = (game as unknown as { pf2e?: { actions?: { get(slug: string): SystemAction | undefined } } }).pf2e;
    return system?.actions?.get(slug);
}

/** Which system actions a move calls for: Climb for any ledge taken up or down, Squeeze for a squeezed gap. */
export function movementChecks(legs: { from: CheckWaypoint; to: CheckWaypoint; squeezed: boolean }[]): Set<"climb" | "squeeze"> {
    const checks = new Set<"climb" | "squeeze">();
    for (const { from, to, squeezed } of legs) {
        const actionConfig = (CONFIG.Token.movement.actions as Record<string, { teleport?: boolean } | undefined>)[to.action];
        if (actionConfig?.teleport || to.action === "fly" || to.action === "blink" || to.action === "displace") continue;
        if (Math.abs(to.elevation - from.elevation) > STEP_FEET + EPSILON) checks.add("climb");
        if (squeezed) checks.add("squeeze");
    }
    return checks;
}

/**
 * Post the system's own Climb or Squeeze action roll when a move takes a ledge or a squeeze gap.
 * Prompt only: the move proceeds and the GM reads the result. Runs after the floor rewrite, so it
 * sees exactly the path that executes.
 */
function onPreMoveToken(token: CheckToken, movement: CheckMovement): boolean {
    if (!token.actor || !game.settings!.get(MODULE_ID, SETTING_PROMPT_CHECKS)) return true;
    const path = [movement.origin, ...movement.passed.waypoints];
    const gridless = isGridlessActive() && !!token.object;
    const legs = path.slice(1).map((to, index) => {
        const from = path[index];
        const squeezed = gridless && (from.level ?? token._source.level) === (to.level ?? token._source.level)
            && isSqueezedLeg(token.object!, from as never, to as never);
        return { from, to, squeezed };
    });
    for (const slug of movementChecks(legs)) void systemAction(slug)?.use({ actors: [token.actor] });
    return true;
}

export function registerMovementCheckSetting(): void {
    game.settings!.register(MODULE_ID, SETTING_PROMPT_CHECKS, {
        name: "codex-foundry.settings.promptMovementChecks.name",
        hint: "codex-foundry.settings.promptMovementChecks.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
    });
}

/** Register after the floor rewrite so the hook only sees moves that will actually happen. */
export function activateMovementChecks(): void {
    const hooks = Hooks as unknown as { on(name: string, callback: (...args: never[]) => unknown): void };
    hooks.on("preMoveToken", onPreMoveToken);
}

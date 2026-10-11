import { runtimeDependenciesFromWindow, startRuntime, warn } from "./runtime.js";
import {
    COMMAND_EVENT,
    OBSERVATION_EVENT,
    parsePageCommand,
    type Observation,
    type PageCommand,
} from "../shared/protocol.js";
import { decodeDetail, encodeDetail } from "../shared/wire.js";

interface ReadinessGlobals {
    Hooks?: unknown;
    game?: unknown;
}

function isFoundryReady(globals: ReadinessGlobals): boolean {
    const game = globals.game;
    return typeof game === "object" && game !== null && (game as Record<string, unknown>).ready === true;
}

export function installPageAdapter(target: Window): () => void {
    const globals = target as Window & ReadinessGlobals;
    let stopRuntime: (() => void) | null = null;
    let wanted = false;
    let waitingForReady = false;

    const emit = (observation: Observation): void => {
        target.dispatchEvent(new CustomEvent(OBSERVATION_EVENT, { detail: encodeDetail(observation) }));
    };

    const start = (): void => {
        if (!wanted || stopRuntime) return;
        try {
            stopRuntime = startRuntime(emit, runtimeDependenciesFromWindow(target));
        } catch (error) {
            warn("activation", error);
        }
    };

    const activate = (): void => {
        wanted = true;
        if (isFoundryReady(globals)) {
            start();
            return;
        }
        if (waitingForReady) return;
        const hooks = globals.Hooks;
        const once = typeof hooks === "object" && hooks !== null
            ? (hooks as Record<string, unknown>).once
            : undefined;
        if (typeof once !== "function") return;
        try {
            once.call(hooks, "ready", () => {
                waitingForReady = false;
                start();
            });
            waitingForReady = true;
        } catch (error) {
            warn("waiting for Foundry ready", error);
        }
    };

    const teardown = (): void => {
        wanted = false;
        const stop = stopRuntime;
        stopRuntime = null;
        stop?.();
    };

    const handle = (command: PageCommand): void => {
        switch (command.type) {
            case "activate":
                activate();
                break;
            case "render-overlay":
            case "clear-overlay":
                break;
            case "teardown":
                teardown();
                break;
            default: {
                const exhaustive: never = command;
                return exhaustive;
            }
        }
    };

    const listener = (event: Event): void => {
        try {
            const command = parsePageCommand(decodeDetail((event as CustomEvent<unknown>).detail));
            if (command) handle(command);
        } catch (error) {
            warn("command", error);
        }
    };

    target.addEventListener(COMMAND_EVENT, listener);
    return () => {
        target.removeEventListener(COMMAND_EVENT, listener);
        teardown();
    };
}

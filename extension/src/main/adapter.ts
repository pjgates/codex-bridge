import { createOverlay, overlayDependenciesFromWindow, type Overlay, type OverlayView } from "./overlay.js";
import { runtimeDependenciesFromWindow, startRuntime, warn, type RuntimeDependencies } from "./runtime.js";
import {
    COMMAND_EVENT,
    OBSERVATION_EVENT,
    parsePageCommand,
    type Observation,
    type PageCommand,
} from "../shared/protocol.js";
import { decodeDetail, encodeDetail } from "../shared/wire.js";

const OVERLAY_REFRESH_HOOKS = ["canvasPan", "updateToken", "refreshToken"] as const;

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
    let overlay: Overlay | null = null;
    let stopOverlayHooks: (() => void) | null = null;

    const emit = (observation: Observation): void => {
        target.dispatchEvent(new CustomEvent(OBSERVATION_EVENT, { detail: encodeDetail(observation) }));
    };

    const withOverlay = (context: string, action: (current: Overlay) => void): void => {
        const current = overlay;
        if (current === null) return;
        try {
            action(current);
        } catch (error) {
            warn(`overlay ${context}`, error);
            try {
                current.clear();
            } catch {
                return;
            }
        }
    };

    const registerOverlayHooks = (hooks: RuntimeDependencies["hooks"]): (() => void) => {
        const registrations: { name: string; id: number }[] = [];
        const register = (name: string, action: (current: Overlay) => void): void => {
            registrations.push({ name, id: hooks.on(name, () => withOverlay(name, action)) });
        };
        try {
            for (const name of OVERLAY_REFRESH_HOOKS) register(name, (current) => current.refresh());
            register("canvasTearDown", (current) => current.clear());
        } catch (error) {
            warn("overlay hooks", error);
        }
        return () => {
            for (const { name, id } of registrations.splice(0)) {
                try {
                    hooks.off(name, id);
                } catch (error) {
                    warn(`unregistering ${name}`, error);
                }
            }
        };
    };

    const start = (): void => {
        if (!wanted || stopRuntime) return;
        try {
            const dependencies = runtimeDependenciesFromWindow(target);
            stopRuntime = startRuntime(emit, dependencies);
            stopOverlayHooks = registerOverlayHooks(dependencies.hooks);
        } catch (error) {
            warn("activation", error);
        }
    };

    const renderOverlay = (view: OverlayView): void => {
        if (!stopRuntime) return;
        if (overlay === null) {
            try {
                const dependencies = overlayDependenciesFromWindow(target);
                if (dependencies === null) return;
                overlay = createOverlay(dependencies);
            } catch (error) {
                warn("overlay creation", error);
                return;
            }
        }
        withOverlay("render", (current) => current.render(view));
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
        const stopHooks = stopOverlayHooks;
        stopOverlayHooks = null;
        stopHooks?.();
        withOverlay("teardown", (current) => current.destroy());
        overlay = null;
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
                renderOverlay(command.payload);
                break;
            case "clear-overlay":
                withOverlay("clear", (current) => current.clear());
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

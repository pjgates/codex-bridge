import { createOverlay, field, overlayDependenciesFromWindow, type Overlay, type OverlayView } from "./overlay.js";
import { nextEventId } from "./extract.js";
import { runtimeDependenciesFromWindow, startRuntime, warn, type RuntimeDependencies } from "./runtime.js";
import {
    COMMAND_EVENT,
    OBSERVATION_EVENT,
    parseObservation,
    parsePageCommand,
    PROTOCOL_VERSION,
    type Observation,
    type PageCommand,
} from "../shared/protocol.js";
import { decodeDetail, encodeDetail } from "../shared/wire.js";

interface ReadinessGlobals {
    Hooks?: unknown;
    game?: unknown;
}

type HandshakePayload = Extract<Observation, { type: "handshake" }>["payload"];

const RETRY_INITIAL_MS = 250;
const RETRY_MAX_MS = 4_000;
const RETRY_WINDOW_MS = 30_000;
const UNKNOWN = "unknown";
const UNAVAILABLE_REASON = "Foundry runtime was unavailable; reading rendered chat cards only.";
const FAILED_REASON = "Foundry adapter failed; reading rendered chat cards only.";

function isFoundryReady(globals: ReadinessGlobals): boolean {
    const game = globals.game;
    return typeof game === "object" && game !== null && (game as Record<string, unknown>).ready === true;
}

function hasRuntimeShape(globals: ReadinessGlobals): boolean {
    return ["on", "off", "once"].every((name) => typeof field(globals.Hooks, name) === "function")
        && typeof globals.game === "object" && globals.game !== null;
}

export function installPageAdapter(target: Window): () => void {
    const globals = target as Window & ReadinessGlobals;
    let stopRuntime: (() => void) | null = null;
    let wanted = false;
    let waitingForReady = false;
    let overlay: Overlay | null = null;
    let stopOverlayHooks: (() => void) | null = null;
    let overlayEnabled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = RETRY_INITIAL_MS;
    let retryElapsed = 0;
    let fellBack = false;
    let lastHandshake: HandshakePayload | null = null;

    const emit = (observation: Observation): void => {
        if (observation.type === "handshake") lastHandshake = observation.payload;
        target.dispatchEvent(new CustomEvent(OBSERVATION_EVENT, { detail: encodeDetail(observation) }));
    };

    const fallBack = (reason: string): void => {
        if (fellBack) return;
        fellBack = true;
        const known = lastHandshake;
        const observation = parseObservation({
            protocol: PROTOCOL_VERSION,
            eventId: nextEventId("handshake"),
            timestamp: Date.now(),
            type: "handshake",
            payload: {
                status: "fallback",
                foundry: known?.foundry ?? UNKNOWN,
                system: known?.system ?? UNKNOWN,
                systemVersion: known?.systemVersion ?? UNKNOWN,
                worldId: known?.worldId ?? UNKNOWN,
                userId: known?.userId ?? UNKNOWN,
                reason,
            },
        });
        if (observation) emit(observation);
    };

    const cancelRetry = (): void => {
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = null;
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
            } catch (clearError) {
                warn(`overlay ${context} fallback clear`, clearError);
            }
        }
    };

    const registerOverlayHooks = (hooks: RuntimeDependencies["hooks"]): (() => void) => {
        const registrations: { name: string; id: number }[] = [];
        const register = (name: string, action: (current: Overlay, subject: unknown) => void): void => {
            registrations.push({
                name,
                id: hooks.on(name, (subject: unknown) => withOverlay(name, (current) => action(current, subject))),
            });
        };
        const refreshIfCurrent = (current: Overlay, uuid: unknown): void => {
            if (uuid !== null && uuid === current.currentTokenUuid()) current.refresh();
        };
        try {
            register("canvasPan", (current) => current.refresh());
            register("refreshToken", (current, token) => refreshIfCurrent(current, field(field(token, "document"), "uuid")));
            register("updateToken", (current, document) => refreshIfCurrent(current, field(document, "uuid")));
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
        if (!wanted || stopRuntime || fellBack) return;
        try {
            const dependencies = runtimeDependenciesFromWindow(target);
            const runtime = startRuntime(emit, dependencies);
            if (runtime.failed && runtime.supported) {
                runtime.stop();
                fallBack(FAILED_REASON);
                return;
            }
            stopRuntime = runtime.stop;
            if (runtime.supported) {
                overlayEnabled = true;
                stopOverlayHooks = registerOverlayHooks(dependencies.hooks);
            }
        } catch (error) {
            warn("activation", error);
            fallBack(FAILED_REASON);
        }
    };

    const renderOverlay = (view: OverlayView): void => {
        if (!overlayEnabled) return;
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

    const scheduleRetry = (): void => {
        if (retryElapsed >= RETRY_WINDOW_MS) {
            fallBack(UNAVAILABLE_REASON);
            return;
        }
        const delay = Math.min(retryDelay, RETRY_WINDOW_MS - retryElapsed);
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        retryElapsed += delay;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            attempt();
        }, delay);
    };

    const attempt = (): void => {
        if (!wanted || stopRuntime || waitingForReady || fellBack) return;
        cancelRetry();
        if (!hasRuntimeShape(globals)) {
            scheduleRetry();
            return;
        }
        if (isFoundryReady(globals)) {
            start();
            return;
        }
        const hooks = globals.Hooks;
        try {
            (field(hooks, "once") as (...args: unknown[]) => unknown).call(hooks, "ready", () => {
                waitingForReady = false;
                start();
            });
            waitingForReady = true;
        } catch (error) {
            warn("waiting for Foundry ready", error);
            scheduleRetry();
        }
    };

    const activate = (): void => {
        wanted = true;
        attempt();
    };

    const teardown = (): void => {
        wanted = false;
        cancelRetry();
        retryDelay = RETRY_INITIAL_MS;
        retryElapsed = 0;
        fellBack = false;
        lastHandshake = null;
        overlayEnabled = false;
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

import { parseObservation, PROTOCOL_VERSION, type Observation } from "../shared/protocol.js";
import { compatibilityOf, extractCheck, nextEventId, snapshotToken, type RuntimeIdentity } from "./extract.js";

export interface RuntimeDependencies {
    hooks: {
        on(name: string, callback: (...args: unknown[]) => void): number;
        off(name: string, id: number): void;
    };
    identity(): RuntimeIdentity & { worldId: string; userId: string };
    scope(): { sceneId: string; combatId: string | null };
    currentTargets(): unknown[];
}

const WARNING_PREFIX = "PF2e Combat Notebook:";
const WARNING_MAX_LENGTH = 200;
const UNKNOWN = "unknown";
const SCOPE_HOOKS = ["combatStart", "updateCombat", "deleteCombat"] as const;

export function warn(context: string, error: unknown): void {
    try {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`${WARNING_PREFIX} ${context} failed: ${detail}`.slice(0, WARNING_MAX_LENGTH));
    } catch {
        return;
    }
}

function idOrUnknown(value: unknown): string {
    return typeof value === "string" && value.length > 0 ? value.slice(0, 512) : UNKNOWN;
}

function uuidOf(token: unknown): string | null {
    if (typeof token !== "object" || token === null) return null;
    const document = (token as Record<string, unknown>).document;
    if (typeof document !== "object" || document === null) return null;
    const uuid = (document as Record<string, unknown>).uuid;
    return typeof uuid === "string" && uuid.length > 0 ? uuid : null;
}

function idOf(value: unknown): unknown {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>).id : undefined;
}

interface FoundryGlobals {
    Hooks?: unknown;
    game?: unknown;
    canvas?: unknown;
}

function field(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function requiredString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0) throw new Error(`${path} is unavailable`);
    return value;
}

function optionalString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function isIterable(value: unknown): value is Iterable<unknown> {
    return typeof value === "object" && value !== null
        && typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function";
}

export function runtimeDependenciesFromWindow(source: object): RuntimeDependencies {
    const globals = source as FoundryGlobals;
    const hooks = globals.Hooks;
    const on = field(hooks, "on");
    const off = field(hooks, "off");
    if (typeof on !== "function" || typeof off !== "function") {
        throw new Error("Foundry Hooks are unavailable");
    }
    const game = (): unknown => {
        const value = globals.game;
        if (typeof value !== "object" || value === null) throw new Error("game is unavailable");
        return value;
    };
    const user = (): unknown => {
        const value = field(game(), "user");
        if (typeof value !== "object" || value === null) throw new Error("game.user is unavailable");
        return value;
    };
    return {
        hooks: {
            on: (name, callback) => {
                const id: unknown = on.call(hooks, name, callback);
                if (typeof id !== "number") throw new Error("Hooks.on returned no id");
                return id;
            },
            off: (name, id) => {
                off.call(hooks, name, id);
            },
        },
        identity: () => {
            const current = game();
            const generation = field(field(current, "release"), "generation");
            if (typeof generation !== "number") throw new Error("game.release.generation is unavailable");
            const system = field(current, "system");
            return {
                foundryGeneration: generation,
                systemId: requiredString(field(system, "id"), "game.system.id"),
                systemVersion: requiredString(field(system, "version"), "game.system.version"),
                worldId: requiredString(field(field(current, "world"), "id"), "game.world.id"),
                userId: requiredString(field(user(), "id"), "game.user.id"),
            };
        },
        scope: () => {
            const current = game();
            const sceneId = optionalString(field(field(globals.canvas, "scene"), "id"))
                ?? optionalString(field(field(field(current, "scenes"), "viewed"), "id"));
            if (sceneId === null) throw new Error("scene id is unavailable");
            return { sceneId, combatId: optionalString(field(field(current, "combat"), "id")) };
        },
        currentTargets: () => {
            const targets = field(user(), "targets");
            return isIterable(targets) ? Array.from(targets) : [];
        },
    };
}

export interface RuntimeHandle {
    stop(): void;
    supported: boolean;
}

export function startRuntime(
    emit: (observation: Observation) => void,
    dependencies: RuntimeDependencies,
): RuntimeHandle {
    let active = true;
    let supported = false;
    let currentTarget: string | null = null;
    const registrations: { name: string; id: number }[] = [];

    const send = (observation: Observation | null): void => {
        if (!active || observation === null) return;
        const valid = parseObservation(observation);
        if (valid !== null) emit(valid);
    };

    const envelope = <T extends Observation["type"]>(
        type: T,
        payload: Extract<Observation, { type: T }>["payload"],
    ): Observation => ({
        protocol: PROTOCOL_VERSION,
        eventId: nextEventId(type),
        timestamp: Date.now(),
        type,
        payload,
    } as Observation);

    const emitScope = (): void => {
        const { sceneId, combatId } = dependencies.scope();
        send(envelope("scope", { sceneId, combatId }));
    };

    const emitTarget = (): void => {
        const targets = dependencies.currentTargets();
        currentTarget = targets.length === 1 ? uuidOf(targets[0]) : null;
        send(envelope("target", { tokenUuid: currentTarget }));
    };

    const bootstrapTargets = (): void => {
        for (const token of dependencies.currentTargets()) send(snapshotToken(token));
        emitTarget();
    };

    const register = (name: string, handler: (...args: unknown[]) => void): void => {
        const id = dependencies.hooks.on(name, (...args: unknown[]) => {
            if (!active) return;
            try {
                handler(...args);
            } catch (error) {
                warn(name, error);
            }
        });
        registrations.push({ name, id });
    };

    const teardown = (): void => {
        if (!active) return;
        active = false;
        for (const { name, id } of registrations.splice(0)) {
            try {
                dependencies.hooks.off(name, id);
            } catch (error) {
                warn(`unregistering ${name}`, error);
            }
        }
    };

    try {
        const identity = dependencies.identity();
        const compatibility = compatibilityOf(identity);
        send(envelope("handshake", {
            status: compatibility.status,
            foundry: idOrUnknown(String(identity.foundryGeneration)),
            system: idOrUnknown(identity.systemId),
            systemVersion: idOrUnknown(identity.systemVersion),
            worldId: idOrUnknown(identity.worldId),
            userId: idOrUnknown(identity.userId),
            ...(compatibility.reason === undefined ? {} : { reason: compatibility.reason }),
        }));
        if (compatibility.status === "unsupported") {
            active = false;
            return { stop: () => undefined, supported: false };
        }
        supported = true;

        register("createChatMessage", (message) => send(extractCheck(message)));
        register("targetToken", (user, token) => {
            if (idOf(user) !== dependencies.identity().userId) return;
            send(snapshotToken(token));
            emitTarget();
        });
        register("canvasReady", () => {
            emitScope();
            bootstrapTargets();
        });
        register("deleteToken", (document) => {
            const uuid = typeof document === "object" && document !== null
                ? (document as Record<string, unknown>).uuid
                : undefined;
            if (currentTarget === null || uuid !== currentTarget) return;
            currentTarget = null;
            send(envelope("target", { tokenUuid: null }));
        });
        for (const name of SCOPE_HOOKS) register(name, emitScope);

        emitScope();
        bootstrapTargets();
    } catch (error) {
        warn("startup", error);
    }
    return { stop: teardown, supported };
}

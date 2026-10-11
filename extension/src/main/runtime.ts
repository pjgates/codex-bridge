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

function warn(context: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`${WARNING_PREFIX} ${context} failed: ${detail}`.slice(0, WARNING_MAX_LENGTH));
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

export function startRuntime(
    emit: (observation: Observation) => void,
    dependencies: RuntimeDependencies,
): () => void {
    let active = true;
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
            return () => undefined;
        }

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
    return teardown;
}

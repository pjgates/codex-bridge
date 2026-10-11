import {
    applyObservation,
    currentOverlay,
    emptyNotebook,
    parseNotebookState,
    STORED_STATE_INVALID_DIAGNOSTIC,
    withDiagnostic,
} from "../core/reducer.js";
import type { NotebookState } from "../core/types.js";
import { notebookKey } from "../shared/notebook-key.js";
import { PROTOCOL_VERSION, type Observation, type PageCommand } from "../shared/protocol.js";

export const LOAD_FAILED_DIAGNOSTIC = "Stored encounter data could not be loaded.";
export const SAVE_FAILED_DIAGNOSTIC = "Encounter checkpoint could not be saved.";
export const RENDER_FAILED_DIAGNOSTIC = "The notebook sidebar could not be updated.";
export const OVERLAY_FAILED_DIAGNOSTIC = "The token overlay could not be updated.";
export const BUFFER_OVERFLOW_DIAGNOSTIC = "Some encounter observations were dropped while storage was unavailable.";
export const UPDATE_FAILED_DIAGNOSTIC = "An encounter update could not be applied.";
export const MAX_UNLOADED_OBSERVATIONS = 200;

export interface ControllerDependencies {
    origin: string;
    load(key: string): Promise<unknown>;
    save(key: string, state: NotebookState): Promise<void>;
    renderSidebar(state: NotebookState): void;
    sendCommand(command: PageCommand): void;
}

export interface NotebookController {
    // accept and clear never reject; failures are recorded as notebook diagnostics.
    accept(observation: Observation): Promise<void>;
    clear(): Promise<void>;
    flush(): Promise<void>;
    state(): NotebookState;
}

function withDiagnosticOnce(state: NotebookState, message: string): NotebookState {
    return state.diagnostics.at(-1) === message ? state : withDiagnostic(state, message);
}

function emptyScope(source: NotebookState): NotebookState {
    return {
        ...emptyNotebook(),
        compatibility: source.compatibility,
        compatibilityReason: source.compatibilityReason,
        worldId: source.worldId,
        userId: source.userId,
        sceneId: source.sceneId,
        combatId: source.combatId,
        scopeId: source.scopeId,
    };
}

function sameIdentity(left: NotebookState, right: NotebookState): boolean {
    return left.worldId === right.worldId && left.userId === right.userId && left.scopeId === right.scopeId;
}

export async function createNotebookController(
    dependencies: ControllerDependencies,
): Promise<NotebookController> {
    let state = emptyNotebook();
    let pending: Promise<void> = Promise.resolve();

    let activeKey: string | null = null;
    let loaded = false;
    let loadFailureNoted = false;
    let overflowNoted = false;
    let unloaded: Observation[] = [];

    const pendingSaves = new Map<string, NotebookState>();
    let inFlightSave: Promise<void> | null = null;

    const storageKey = (candidate: NotebookState): string | null => {
        if (!candidate.worldId || !candidate.userId || !candidate.scopeId) return null;
        return notebookKey({
            origin: dependencies.origin,
            worldId: candidate.worldId,
            userId: candidate.userId,
            scopeId: candidate.scopeId,
        });
    };

    const enqueue = (task: () => Promise<void>): Promise<void> => {
        const run = pending.then(task).catch(() => {
            state = withDiagnosticOnce(state, UPDATE_FAILED_DIAGNOSTIC);
        });
        pending = run;
        return run;
    };

    const guarded = (action: () => void, diagnostic: string): void => {
        try {
            action();
        } catch {
            state = withDiagnosticOnce(state, diagnostic);
        }
    };

    const render = (): void => {
        guarded(() => dependencies.renderSidebar(state), RENDER_FAILED_DIAGNOSTIC);
    };

    const drainSaves = async (): Promise<void> => {
        let next = pendingSaves.entries().next();
        while (!next.done) {
            const [key, snapshot] = next.value;
            pendingSaves.delete(key);
            try {
                await dependencies.save(key, snapshot);
            } catch {
                const noted = withDiagnosticOnce(state, SAVE_FAILED_DIAGNOSTIC);
                if (noted !== state) {
                    state = noted;
                    render();
                }
            }
            next = pendingSaves.entries().next();
        }
        inFlightSave = null;
    };

    const scheduleSave = (key: string, snapshot: NotebookState): void => {
        pendingSaves.set(key, snapshot);
        inFlightSave ??= drainSaves();
    };

    const publish = (): void => {
        render();
        const overlay = currentOverlay(state);
        guarded(() => dependencies.sendCommand(overlay
            ? { protocol: PROTOCOL_VERSION, type: "render-overlay", payload: overlay }
            : { protocol: PROTOCOL_VERSION, type: "clear-overlay", payload: {} }), OVERLAY_FAILED_DIAGNOSTIC);
        if (activeKey && loaded) scheduleSave(activeKey, state);
    };

    const switchKey = (key: string): void => {
        activeKey = key;
        loaded = false;
        loadFailureNoted = false;
        overflowNoted = false;
        unloaded = [];
    };

    const bufferUnloaded = (observation: Observation, current: NotebookState): NotebookState => {
        unloaded.push(observation);
        if (unloaded.length <= MAX_UNLOADED_OBSERVATIONS) return current;
        unloaded = unloaded.slice(unloaded.length - MAX_UNLOADED_OBSERVATIONS);
        if (overflowNoted) return current;
        overflowNoted = true;
        return withDiagnostic(current, BUFFER_OVERFLOW_DIAGNOSTIC);
    };

    const attemptLoad = async (key: string, current: NotebookState): Promise<NotebookState> => {
        let stored: unknown;
        try {
            stored = await dependencies.load(key);
        } catch {
            if (loadFailureNoted) return current;
            loadFailureNoted = true;
            return withDiagnostic(current, LOAD_FAILED_DIAGNOSTIC);
        }
        loaded = true;
        const replay = unloaded;
        unloaded = [];
        if (stored === null || stored === undefined) return current;
        const restored = parseNotebookState(stored);
        const base = restored === null || !sameIdentity(restored, current)
            ? withDiagnostic(emptyScope(current), STORED_STATE_INVALID_DIAGNOSTIC)
            : restored;
        const identity = {
            compatibility: current.compatibility,
            compatibilityReason: current.compatibilityReason,
            worldId: current.worldId,
            userId: current.userId,
        };
        const replayed: NotebookState = {
            ...replay.reduce(applyObservation, { ...base, ...identity }),
            ...identity,
        };
        return overflowNoted && !replayed.diagnostics.includes(BUFFER_OVERFLOW_DIAGNOSTIC)
            ? withDiagnostic(replayed, BUFFER_OVERFLOW_DIAGNOSTIC)
            : replayed;
    };

    render();

    return {
        accept(observation) {
            return enqueue(async () => {
                const reduced = applyObservation(state, observation);
                const nextKey = storageKey(reduced);
                if (nextKey && nextKey !== activeKey) switchKey(nextKey);
                if (activeKey && !loaded) {
                    state = await attemptLoad(activeKey, bufferUnloaded(observation, reduced));
                } else {
                    state = reduced;
                }
                publish();
            });
        },
        clear() {
            return enqueue(async () => {
                state = emptyScope(state);
                if (activeKey) {
                    loaded = true;
                    unloaded = [];
                }
                publish();
            });
        },
        async flush() {
            await pending;
            while (inFlightSave) await inFlightSave;
        },
        state: () => state,
    };
}

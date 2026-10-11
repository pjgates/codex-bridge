import {
    applyObservation,
    currentOverlay,
    emptyNotebook,
    parseNotebookState,
    STORED_STATE_INVALID_DIAGNOSTIC,
    withDiagnostic,
} from "../core/reducer.js";
import type { NotebookState } from "../core/types.js";
import { PROTOCOL_VERSION, type Observation, type PageCommand } from "../shared/protocol.js";

export const LOAD_FAILED_DIAGNOSTIC = "Stored encounter data could not be loaded.";
export const SAVE_FAILED_DIAGNOSTIC = "Encounter checkpoint could not be saved.";

export interface ControllerDependencies {
    origin: string;
    load(key: string): Promise<unknown>;
    save(key: string, state: NotebookState): Promise<void>;
    renderSidebar(state: NotebookState): void;
    sendCommand(command: PageCommand): void;
}

export interface NotebookController {
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
    let activeKey: string | null = null;
    let pending: Promise<void> = Promise.resolve();

    const storageKey = (candidate: NotebookState): string | null => {
        if (!candidate.worldId || !candidate.userId || !candidate.scopeId) return null;
        return `notebook:${dependencies.origin}:${candidate.worldId}:${candidate.userId}:${candidate.scopeId}`;
    };

    const enqueue = (task: () => Promise<void>): Promise<void> => {
        const run = pending.then(task);
        pending = run.catch(() => undefined);
        return run;
    };

    const restore = async (
        reduced: NotebookState,
        observation: Observation,
        key: string,
    ): Promise<NotebookState> => {
        let stored: unknown;
        try {
            stored = await dependencies.load(key);
        } catch {
            return withDiagnosticOnce(reduced, LOAD_FAILED_DIAGNOSTIC);
        }
        if (stored === null || stored === undefined) return reduced;
        const restored = parseNotebookState(stored);
        if (restored === null || !sameIdentity(restored, reduced)) {
            return withDiagnostic(emptyScope(reduced), STORED_STATE_INVALID_DIAGNOSTIC);
        }
        return {
            ...applyObservation(restored, observation),
            compatibility: reduced.compatibility,
            compatibilityReason: reduced.compatibilityReason,
            worldId: reduced.worldId,
            userId: reduced.userId,
        };
    };

    const publish = async (): Promise<void> => {
        dependencies.renderSidebar(state);
        const overlay = currentOverlay(state);
        dependencies.sendCommand(overlay
            ? { protocol: PROTOCOL_VERSION, type: "render-overlay", payload: overlay }
            : { protocol: PROTOCOL_VERSION, type: "clear-overlay", payload: {} });
        if (!activeKey) return;
        try {
            await dependencies.save(activeKey, state);
        } catch {
            const noted = withDiagnosticOnce(state, SAVE_FAILED_DIAGNOSTIC);
            if (noted === state) return;
            state = noted;
            dependencies.renderSidebar(state);
        }
    };

    dependencies.renderSidebar(state);

    return {
        accept(observation) {
            return enqueue(async () => {
                const reduced = applyObservation(state, observation);
                const nextKey = storageKey(reduced);
                if (nextKey && nextKey !== activeKey) {
                    state = await restore(reduced, observation, nextKey);
                    activeKey = nextKey;
                } else {
                    state = reduced;
                }
                await publish();
            });
        },
        clear() {
            return enqueue(async () => {
                state = emptyScope(state);
                await publish();
            });
        },
        async flush() {
            await pending;
        },
        state: () => state,
    };
}

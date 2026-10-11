import { describe, expect, it, vi } from "vitest";
import {
    createNotebookController,
    LOAD_FAILED_DIAGNOSTIC,
    RENDER_FAILED_DIAGNOSTIC,
    SAVE_FAILED_DIAGNOSTIC,
    type ControllerDependencies,
} from "../../src/content/controller.js";
import {
    applyObservation,
    emptyNotebook,
    STORED_STATE_INVALID_DIAGNOSTIC,
} from "../../src/core/reducer.js";
import type { NotebookState } from "../../src/core/types.js";
import type { Observation } from "../../src/shared/protocol.js";

const ORIGIN = "https://foundry.example.test";
const KEY = "notebook:https%3A%2F%2Ffoundry.example.test:world:user:scene%3Acombat";
const TOKEN = "Scene.s.Token.t";

const handshake: Observation = {
    protocol: 1,
    eventId: "handshake",
    timestamp: 0,
    type: "handshake",
    payload: {
        status: "active",
        foundry: "14",
        system: "pf2e",
        systemVersion: "8.5.3",
        worldId: "world",
        userId: "user",
    },
};

const scope: Observation = {
    protocol: 1,
    eventId: "scope",
    timestamp: 0,
    type: "scope",
    payload: { sceneId: "scene", combatId: "combat" },
};

const snapshot: Observation = {
    protocol: 1,
    eventId: "snapshot",
    timestamp: 1,
    type: "token-snapshot",
    payload: {
        tokenUuid: TOKEN,
        actorUuid: null,
        name: "Graveknight",
        defenses: { ac: 28 },
    },
};

const target = (tokenUuid: string | null, eventId = "target"): Observation => ({
    protocol: 1,
    eventId,
    timestamp: 2,
    type: "target",
    payload: { tokenUuid },
});

type Mock = ReturnType<typeof vi.fn>;
type Harness = ControllerDependencies & { save: Mock; renderSidebar: Mock; sendCommand: Mock };

function harness(overrides: Partial<ControllerDependencies> = {}): Harness {
    return {
        origin: ORIGIN,
        load: async () => null,
        save: vi.fn().mockResolvedValue(undefined),
        renderSidebar: vi.fn(),
        sendCommand: vi.fn(),
        ...overrides,
    } as Harness;
}

const otherSnapshot: Observation = {
    protocol: 1,
    eventId: "snapshot-other",
    timestamp: 3,
    type: "token-snapshot",
    payload: { tokenUuid: "Scene.s.Token.o", actorUuid: null, name: "Ghoul", defenses: { ac: 16 } },
};

function count(list: readonly string[], entry: string): number {
    return list.filter((item) => item === entry).length;
}

function storedScope(): NotebookState {
    return [handshake, scope, snapshot].reduce(applyObservation, emptyNotebook());
}

describe("content controller", () => {
    it("restores, reduces, checkpoints, and renders an overlay", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const renderSidebar = vi.fn();
        const sendCommand = vi.fn();
        const controller = await createNotebookController({
            origin: "https://foundry.example.test",
            load: async () => null,
            save,
            renderSidebar,
            sendCommand,
        });
        await controller.accept({
            protocol: 1,
            eventId: "handshake",
            timestamp: 0,
            type: "handshake",
            payload: {
                status: "active",
                foundry: "14",
                system: "pf2e",
                systemVersion: "8.5.3",
                worldId: "world",
                userId: "user",
            },
        });
        await controller.accept({
            protocol: 1,
            eventId: "scope",
            timestamp: 0,
            type: "scope",
            payload: { sceneId: "scene", combatId: "combat" },
        });
        await controller.accept({
            protocol: 1,
            eventId: "snapshot",
            timestamp: 1,
            type: "token-snapshot",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                actorUuid: null,
                name: "Graveknight",
                defenses: { ac: 28 },
            },
        });
        await controller.accept({
            protocol: 1,
            eventId: "target",
            timestamp: 2,
            type: "target",
            payload: { tokenUuid: "Scene.s.Token.t" },
        });
        await controller.flush();
        expect(save).toHaveBeenCalledWith(
            KEY,
            expect.anything(),
        );
        expect(renderSidebar).toHaveBeenLastCalledWith(
            expect.objectContaining({ selectedTokenUuid: "Scene.s.Token.t" }),
        );
        expect(sendCommand).toHaveBeenLastCalledWith({
            protocol: 1,
            type: "render-overlay",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                name: "Graveknight",
                ac: "28",
                provenance: "exact-client",
            },
        });
    });

    it("renders the empty notebook before any observation and does not save without a key", async () => {
        const dependencies = harness();
        const controller = await createNotebookController(dependencies);
        expect(dependencies.renderSidebar).toHaveBeenCalledWith(emptyNotebook());
        await controller.accept(handshake);
        expect(dependencies.save).not.toHaveBeenCalled();
    });

    it("restores a previously saved scope from storage", async () => {
        const stored = JSON.parse(JSON.stringify(storedScope())) as unknown;
        const load = vi.fn().mockResolvedValue(stored);
        const dependencies = harness({ load });
        const controller = await createNotebookController(dependencies);
        await controller.accept({ ...handshake, eventId: "handshake-2" });
        await controller.accept({ ...scope, eventId: "scope-2" });
        await controller.accept(target(TOKEN, "target-2"));
        expect(load).toHaveBeenCalledOnce();
        expect(load).toHaveBeenCalledWith(KEY);
        const state = controller.state();
        expect(state.creatures[TOKEN]?.name).toBe("Graveknight");
        expect(state.creatures[TOKEN]?.defenses.ac?.display).toBe("28");
        expect(state.compatibility).toBe("active");
        expect(dependencies.sendCommand).toHaveBeenLastCalledWith({
            protocol: 1,
            type: "render-overlay",
            payload: { tokenUuid: TOKEN, name: "Graveknight", ac: "28", provenance: "exact-client" },
        });
    });

    it("resets to an empty scope with a diagnostic when stored data is invalid", async () => {
        const dependencies = harness({ load: async () => ({ creatures: "<script>" }) });
        const controller = await createNotebookController(dependencies);
        await controller.accept(handshake);
        await controller.accept(scope);
        await controller.flush();
        const state = controller.state();
        expect(state.creatures).toEqual({});
        expect(state.scopeId).toBe("scene:combat");
        expect(state.worldId).toBe("world");
        expect(state.diagnostics).toEqual([STORED_STATE_INVALID_DIAGNOSTIC]);
        expect(dependencies.save).toHaveBeenLastCalledWith(KEY, state);
    });

    it("treats stored data for a different scope as invalid", async () => {
        const otherScope = [handshake, { ...scope, payload: { sceneId: "other", combatId: null } }, snapshot]
            .reduce(applyObservation, emptyNotebook());
        const dependencies = harness({ load: async () => otherScope });
        const controller = await createNotebookController(dependencies);
        await controller.accept(handshake);
        await controller.accept(scope);
        expect(controller.state().creatures).toEqual({});
        expect(controller.state().diagnostics).toEqual([STORED_STATE_INVALID_DIAGNOSTIC]);
    });

    it("keeps accepting observations without saving when a load rejects", async () => {
        const dependencies = harness({ load: async () => Promise.reject(new Error("worker gone")) });
        const controller = await createNotebookController(dependencies);
        await controller.accept(handshake);
        await controller.accept(scope);
        await controller.accept(snapshot);
        await controller.flush();
        const state = controller.state();
        expect(state.creatures[TOKEN]?.name).toBe("Graveknight");
        expect(count(state.diagnostics, LOAD_FAILED_DIAGNOSTIC)).toBe(1);
        expect(dependencies.save).not.toHaveBeenCalled();
    });

    it("retries a failed load and replays buffered observations onto the stored scope", async () => {
        const stored = JSON.parse(JSON.stringify(storedScope())) as unknown;
        const load = vi.fn()
            .mockRejectedValueOnce(new Error("worker gone"))
            .mockRejectedValueOnce(new Error("still gone"))
            .mockResolvedValue(stored);
        const dependencies = harness({ load });
        const controller = await createNotebookController(dependencies);
        await controller.accept({ ...handshake, eventId: "handshake-2" });
        await controller.accept({ ...scope, eventId: "scope-2" });
        await controller.accept(otherSnapshot);
        expect(count(controller.state().diagnostics, LOAD_FAILED_DIAGNOSTIC)).toBe(1);
        expect(dependencies.save).not.toHaveBeenCalled();
        await controller.accept(target("Scene.s.Token.o", "target-o"));
        await controller.flush();
        expect(load).toHaveBeenCalledTimes(3);
        const state = controller.state();
        expect(state.creatures[TOKEN]?.name).toBe("Graveknight");
        expect(state.creatures["Scene.s.Token.o"]?.name).toBe("Ghoul");
        expect(state.selectedTokenUuid).toBe("Scene.s.Token.o");
        expect(state.compatibility).toBe("active");
        expect(dependencies.save).toHaveBeenLastCalledWith(KEY, state);
    });

    it("replays buffered observations under the current compatibility, not the stored one", async () => {
        const stored = JSON.parse(JSON.stringify({ ...storedScope(), compatibility: "fallback" })) as unknown;
        const load = vi.fn().mockRejectedValueOnce(new Error("worker gone")).mockResolvedValue(stored);
        const controller = await createNotebookController(harness({ load }));
        await controller.accept(handshake);
        await controller.accept(scope);
        await controller.accept(otherSnapshot);
        await controller.accept(target("Scene.s.Token.o", "target-o"));
        await controller.flush();
        expect(controller.state().compatibility).toBe("active");
        expect(controller.state().creatures["Scene.s.Token.o"]?.name).toBe("Ghoul");
    });

    it("keeps only the newest buffered observations while unloaded and notes the overflow once", async () => {
        const load = vi.fn().mockRejectedValue(new Error("worker gone"));
        const controller = await createNotebookController(harness({ load }));
        await controller.accept(handshake);
        await controller.accept(scope);
        for (let index = 0; index < 205; index += 1) {
            await controller.accept(target(index % 2 === 0 ? TOKEN : null, `target-${index}`));
        }
        load.mockResolvedValue(null);
        await controller.accept(snapshot);
        await controller.flush();
        const diagnostics = controller.state().diagnostics;
        expect(count(diagnostics, "Some encounter observations were dropped while storage was unavailable.")).toBe(1);
        expect(controller.state().creatures[TOKEN]?.name).toBe("Graveknight");
    });

    it("keeps accepting observations after a save rejects", async () => {
        const save = vi.fn()
            .mockRejectedValueOnce(new Error("quota"))
            .mockResolvedValue(undefined);
        const dependencies = harness({ save });
        const controller = await createNotebookController(dependencies);
        await controller.accept(handshake);
        await controller.accept(scope);
        await controller.accept(snapshot);
        await controller.accept(target(TOKEN));
        await controller.flush();
        const state = controller.state();
        expect(state.selectedTokenUuid).toBe(TOKEN);
        expect(count(state.diagnostics, SAVE_FAILED_DIAGNOSTIC)).toBe(1);
        expect(save).toHaveBeenLastCalledWith(KEY, expect.objectContaining({ selectedTokenUuid: TOKEN }));
        expect(dependencies.renderSidebar).toHaveBeenLastCalledWith(state);
    });

    it("does not repeat the same storage diagnostic on consecutive failures", async () => {
        const save = vi.fn().mockRejectedValue(new Error("quota"));
        const controller = await createNotebookController(harness({ save }));
        await controller.accept(handshake);
        await controller.accept(scope);
        await controller.accept(snapshot);
        await controller.flush();
        expect(controller.state().diagnostics).toEqual([SAVE_FAILED_DIAGNOSTIC]);
    });

    it("coalesces saves to one in flight plus the latest pending state", async () => {
        const releases: (() => void)[] = [];
        const save = vi.fn(() => new Promise<void>((resolve) => {
            releases.push(resolve);
        }));
        const dependencies = harness({ save });
        const controller = await createNotebookController(dependencies);
        await controller.accept(handshake);
        await controller.accept(scope);
        await controller.accept(snapshot);
        await controller.accept(target(TOKEN));
        expect(dependencies.renderSidebar).toHaveBeenLastCalledWith(
            expect.objectContaining({ selectedTokenUuid: TOKEN }),
        );
        expect(save).toHaveBeenCalledOnce();
        expect(save).toHaveBeenCalledWith(KEY, expect.objectContaining({ creatures: {} }));
        let flushed = false;
        const flushing = controller.flush().then(() => {
            flushed = true;
        });
        await Promise.resolve();
        expect(flushed).toBe(false);
        releases[0]?.();
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
        expect(save).toHaveBeenLastCalledWith(KEY, controller.state());
        expect(flushed).toBe(false);
        releases[1]?.();
        await flushing;
        expect(save).toHaveBeenCalledTimes(2);
    });

    it("clear discards an unloadable checkpoint and saves the empty scope", async () => {
        const load = vi.fn().mockRejectedValue(new Error("worker gone"));
        const dependencies = harness({ load });
        const controller = await createNotebookController(dependencies);
        await controller.accept(handshake);
        await controller.accept(scope);
        await controller.accept(snapshot);
        expect(load).toHaveBeenCalledTimes(2);
        await controller.clear();
        await controller.accept(target(TOKEN));
        await controller.flush();
        expect(load).toHaveBeenCalledTimes(2);
        expect(dependencies.save).toHaveBeenLastCalledWith(KEY, controller.state());
        expect(controller.state().creatures).toEqual({});
    });

    it("still checkpoints and resolves when the renderer throws", async () => {
        const renderSidebar = vi.fn()
            .mockImplementationOnce(() => undefined)
            .mockImplementation(() => {
                throw new Error("render");
            });
        const dependencies = harness({ renderSidebar });
        const controller = await createNotebookController(dependencies);
        await expect(controller.accept(handshake)).resolves.toBeUndefined();
        await controller.accept(scope);
        await expect(controller.clear()).resolves.toBeUndefined();
        await controller.flush();
        expect(controller.state().scopeId).toBe("scene:combat");
        expect(count(controller.state().diagnostics, RENDER_FAILED_DIAGNOSTIC)).toBe(1);
        expect(dependencies.save).toHaveBeenCalledWith(KEY, expect.anything());
    });

    it("serializes accepts so scope restoration precedes later observations", async () => {
        let release: (value: unknown) => void = () => undefined;
        const load = vi.fn(() => new Promise<unknown>((resolve) => {
            release = resolve;
        }));
        const controller = await createNotebookController(harness({ load }));
        const pending = [
            controller.accept(handshake),
            controller.accept(scope),
            controller.accept(snapshot),
        ];
        await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
        expect(controller.state().creatures).toEqual({});
        release(null);
        await Promise.all(pending);
        expect(controller.state().creatures[TOKEN]?.name).toBe("Graveknight");
    });

    it("clear keeps the scope identity and checkpoints the empty scope", async () => {
        const dependencies = harness();
        const controller = await createNotebookController(dependencies);
        for (const observation of [handshake, scope, snapshot, target(TOKEN)]) {
            await controller.accept(observation);
        }
        await controller.clear();
        await controller.flush();
        const state = controller.state();
        expect(state).toMatchObject({
            compatibility: "active",
            worldId: "world",
            userId: "user",
            sceneId: "scene",
            combatId: "combat",
            scopeId: "scene:combat",
            selectedTokenUuid: null,
            creatures: {},
        });
        expect(dependencies.save).toHaveBeenLastCalledWith(KEY, state);
        expect(dependencies.sendCommand).toHaveBeenLastCalledWith({
            protocol: 1,
            type: "clear-overlay",
            payload: {},
        });
    });

    it("sends clear-overlay when the target is cleared", async () => {
        const dependencies = harness();
        const controller = await createNotebookController(dependencies);
        for (const observation of [handshake, scope, snapshot, target(TOKEN)]) {
            await controller.accept(observation);
        }
        expect(dependencies.sendCommand).toHaveBeenLastCalledWith(
            expect.objectContaining({ type: "render-overlay" }),
        );
        await controller.accept(target(null, "untarget"));
        expect(dependencies.sendCommand).toHaveBeenLastCalledWith({
            protocol: 1,
            type: "clear-overlay",
            payload: {},
        });
    });

    it("re-sends the unchanged overlay after every scope and target observation", async () => {
        const dependencies = harness();
        const controller = await createNotebookController(dependencies);
        for (const observation of [handshake, scope, snapshot, target(TOKEN)]) {
            await controller.accept(observation);
        }
        dependencies.sendCommand.mockClear();
        await controller.accept({ ...scope, eventId: "scope-again" });
        await controller.accept(target(TOKEN, "target-again"));
        const overlay = { protocol: 1, type: "render-overlay", payload: { tokenUuid: TOKEN, name: "Graveknight", ac: "28", provenance: "exact-client" } };
        expect(dependencies.sendCommand.mock.calls).toEqual([[overlay], [overlay]]);

        await controller.accept(target(null, "untarget"));
        dependencies.sendCommand.mockClear();
        await controller.accept({ ...scope, eventId: "scope-third" });
        expect(dependencies.sendCommand).toHaveBeenCalledWith({ protocol: 1, type: "clear-overlay", payload: {} });
    });
});

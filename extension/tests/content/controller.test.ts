import { describe, expect, it, vi } from "vitest";
import { createNotebookController, type ControllerDependencies } from "../../src/content/controller.js";
import {
    applyObservation,
    emptyNotebook,
    STORED_STATE_INVALID_DIAGNOSTIC,
} from "../../src/core/reducer.js";
import type { NotebookState } from "../../src/core/types.js";
import type { Observation } from "../../src/shared/protocol.js";

const ORIGIN = "https://foundry.example.test";
const KEY = `notebook:${ORIGIN}:world:user:scene:combat`;
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

function harness(overrides: Partial<ControllerDependencies> = {}): ControllerDependencies & {
    save: ReturnType<typeof vi.fn>;
    renderSidebar: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
} {
    return {
        origin: ORIGIN,
        load: async () => null,
        save: vi.fn().mockResolvedValue(undefined),
        renderSidebar: vi.fn(),
        sendCommand: vi.fn(),
        ...overrides,
    } as ControllerDependencies & {
        save: ReturnType<typeof vi.fn>;
        renderSidebar: ReturnType<typeof vi.fn>;
        sendCommand: ReturnType<typeof vi.fn>;
    };
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
            "notebook:https://foundry.example.test:world:user:scene:combat",
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
            payload: { tokenUuid: TOKEN, name: "Graveknight", ac: "28" },
        });
    });

    it("resets to an empty scope with a diagnostic when stored data is invalid", async () => {
        const dependencies = harness({ load: async () => ({ creatures: "<script>" }) });
        const controller = await createNotebookController(dependencies);
        await controller.accept(handshake);
        await controller.accept(scope);
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

    it("keeps accepting observations when a load rejects", async () => {
        const dependencies = harness({ load: async () => Promise.reject(new Error("worker gone")) });
        const controller = await createNotebookController(dependencies);
        await controller.accept(handshake);
        await controller.accept(scope);
        await controller.accept(snapshot);
        const state = controller.state();
        expect(state.creatures[TOKEN]?.name).toBe("Graveknight");
        expect(state.diagnostics).toContain("Stored encounter data could not be loaded.");
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
        expect(save).toHaveBeenCalledTimes(3);
        const state = controller.state();
        expect(state.selectedTokenUuid).toBe(TOKEN);
        expect(state.diagnostics).toEqual(["Encounter checkpoint could not be saved."]);
        expect(dependencies.renderSidebar).toHaveBeenLastCalledWith(state);
    });

    it("does not repeat the same storage diagnostic on consecutive failures", async () => {
        const save = vi.fn().mockRejectedValue(new Error("quota"));
        const controller = await createNotebookController(harness({ save }));
        await controller.accept(handshake);
        await controller.accept(scope);
        await controller.accept(snapshot);
        expect(controller.state().diagnostics).toEqual(["Encounter checkpoint could not be saved."]);
    });

    it("keeps the queue alive when a renderer throws", async () => {
        const renderSidebar = vi.fn()
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
                throw new Error("render");
            });
        const controller = await createNotebookController(harness({ renderSidebar }));
        await expect(controller.accept(handshake)).rejects.toThrow("render");
        await controller.accept(scope);
        expect(controller.state().scopeId).toBe("scene:combat");
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
});

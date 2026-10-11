import { describe, expect, it, vi } from "vitest";
import { runtimeDependenciesFromWindow, startRuntime, type RuntimeDependencies } from "../../src/main/runtime.js";
import { parseObservation, type Observation } from "../../src/shared/protocol.js";

type Callback = (...args: unknown[]) => void;

class FakeHooks {
    private nextId = 1;
    readonly registrations = new Map<number, { name: string; callback: Callback }>();
    readonly off = vi.fn((name: string, id: number) => {
        const registration = this.registrations.get(id);
        if (registration?.name === name) this.registrations.delete(id);
    });

    on(name: string, callback: Callback): number {
        const id = this.nextId++;
        this.registrations.set(id, { name, callback });
        return id;
    }

    names(): string[] {
        return [...this.registrations.values()].map((registration) => registration.name).sort();
    }

    fire(name: string, ...args: unknown[]): void {
        for (const registration of [...this.registrations.values()]) {
            if (registration.name === name) registration.callback(...args);
        }
    }
}

function token(id: string, ac = 20): Record<string, unknown> {
    return {
        document: { uuid: `Scene.s.Token.${id}`, name: `Token ${id}` },
        actor: { uuid: `Actor.${id}`, armorClass: { value: ac }, getStatistic: () => undefined },
    };
}

interface Harness {
    hooks: FakeHooks;
    emitted: Observation[];
    targets: unknown[];
    scope: { sceneId: string; combatId: string | null };
    teardown: () => void;
    supported: boolean;
}

function start(overrides: Partial<{ systemVersion: string; targets: unknown[] }> = {}): Harness {
    const hooks = new FakeHooks();
    const emitted: Observation[] = [];
    const harness: Harness = {
        hooks,
        emitted,
        targets: overrides.targets ?? [token("a")],
        scope: { sceneId: "s", combatId: null },
        teardown: () => undefined,
        supported: false,
    };
    const dependencies: RuntimeDependencies = {
        hooks,
        identity: () => ({
            foundryGeneration: 14,
            systemId: "pf2e",
            systemVersion: overrides.systemVersion ?? "8.5.1",
            worldId: "world",
            userId: "me",
        }),
        scope: () => ({ ...harness.scope }),
        currentTargets: () => harness.targets,
    };
    const runtime = startRuntime((observation) => {
        expect(parseObservation(observation)).toEqual(observation);
        emitted.push(observation);
    }, dependencies);
    harness.teardown = runtime.stop;
    harness.supported = runtime.supported;
    return harness;
}

function types(observations: Observation[]): string[] {
    return observations.map((observation) => observation.type);
}

function lastTarget(observations: Observation[]): string | null | undefined {
    const target = [...observations].reverse().find((observation) => observation.type === "target");
    return target?.type === "target" ? target.payload.tokenUuid : undefined;
}

const ALL_HOOKS = [
    "canvasReady",
    "combatStart",
    "createChatMessage",
    "deleteCombat",
    "deleteToken",
    "targetToken",
    "updateCombat",
];

describe("main-world runtime lifecycle", () => {
    it("bootstraps handshake, scope, snapshots and target, then subscribes", () => {
        const harness = start();
        expect(types(harness.emitted)).toEqual(["handshake", "scope", "token-snapshot", "target"]);
        expect(harness.emitted[0]!.payload).toMatchObject({
            status: "active",
            foundry: "14",
            system: "pf2e",
            systemVersion: "8.5.1",
            worldId: "world",
            userId: "me",
        });
        expect(lastTarget(harness.emitted)).toBe("Scene.s.Token.a");
        expect(harness.hooks.names()).toEqual(ALL_HOOKS);
        expect(harness.supported).toBe(true);
    });

    it("emits one snapshot per target and a null target when several are selected", () => {
        const harness = start({ targets: [token("a"), token("b")] });
        expect(types(harness.emitted)).toEqual(["handshake", "scope", "token-snapshot", "token-snapshot", "target"]);
        expect(lastTarget(harness.emitted)).toBeNull();
    });

    it("emits only the handshake and registers no hooks when unsupported", () => {
        const harness = start({ systemVersion: "8.6.0" });
        expect(types(harness.emitted)).toEqual(["handshake"]);
        expect(harness.emitted[0]!.payload).toMatchObject({ status: "unsupported" });
        expect(harness.supported).toBe(false);
        expect(harness.hooks.registrations.size).toBe(0);
        expect(() => harness.teardown()).not.toThrow();
        expect(harness.hooks.off).not.toHaveBeenCalled();
    });

    it("unregisters every hook exactly once on teardown", () => {
        const harness = start();
        harness.teardown();
        harness.teardown();
        expect(harness.hooks.registrations.size).toBe(0);
        expect(harness.hooks.off).toHaveBeenCalledTimes(ALL_HOOKS.length);
    });

    it("emits extracted checks from new chat messages", () => {
        const harness = start();
        harness.emitted.length = 0;
        harness.hooks.fire("createChatMessage", {
            id: "m1",
            timestamp: 5,
            flags: { pf2e: { context: { type: "attack-roll", outcome: "success", target: { token: "Scene.s.Token.a" } } } },
            rolls: [{ total: 25, dice: [{ faces: 20, results: [{ result: 10 }] }] }],
        });
        harness.hooks.fire("createChatMessage", { id: "m2", flags: {} });
        expect(types(harness.emitted)).toEqual(["check-roll"]);
    });

    it("snapshots and retargets when the current user targets a token", () => {
        const harness = start({ targets: [] });
        harness.emitted.length = 0;
        const target = token("b", 24);
        harness.targets = [target];
        harness.hooks.fire("targetToken", { id: "me" }, target, true);
        expect(types(harness.emitted)).toEqual(["token-snapshot", "target"]);
        expect(lastTarget(harness.emitted)).toBe("Scene.s.Token.b");
    });

    it("ignores targeting by other users", () => {
        const harness = start({ targets: [] });
        harness.emitted.length = 0;
        harness.hooks.fire("targetToken", { id: "someone-else" }, token("b"), true);
        expect(harness.emitted).toEqual([]);
    });

    it("re-scopes and re-bootstraps on canvasReady", () => {
        const harness = start();
        harness.emitted.length = 0;
        harness.scope = { sceneId: "s2", combatId: null };
        harness.hooks.fire("canvasReady", {});
        expect(types(harness.emitted)).toEqual(["scope", "token-snapshot", "target"]);
        expect(harness.emitted[0]!.payload).toEqual({ sceneId: "s2", combatId: null });
    });

    it("emits a fresh scope on combat changes", () => {
        const harness = start();
        for (const name of ["combatStart", "updateCombat", "deleteCombat"]) {
            harness.emitted.length = 0;
            harness.scope = { sceneId: "s", combatId: name === "deleteCombat" ? null : "combat-1" };
            harness.hooks.fire(name, {});
            expect(types(harness.emitted)).toEqual(["scope"]);
            expect(harness.emitted[0]!.payload).toEqual(harness.scope);
        }
    });

    it("clears the target when the current target token is deleted", () => {
        const harness = start();
        harness.emitted.length = 0;
        harness.hooks.fire("deleteToken", { uuid: "Scene.s.Token.other" });
        expect(harness.emitted).toEqual([]);
        harness.targets = [];
        harness.hooks.fire("deleteToken", { uuid: "Scene.s.Token.a" });
        expect(types(harness.emitted)).toEqual(["target"]);
        expect(lastTarget(harness.emitted)).toBeNull();
    });

    it("swallows hook errors with a bounded warning", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const harness = start();
        harness.emitted.length = 0;
        harness.targets = [{
            get document(): never {
                throw new Error("x".repeat(500));
            },
        }];
        expect(() => harness.hooks.fire("canvasReady", {})).not.toThrow();
        expect(() => harness.hooks.fire("targetToken", { id: "me" }, harness.targets[0], true)).not.toThrow();
        expect(warn).toHaveBeenCalled();
        for (const [text] of warn.mock.calls) {
            expect(typeof text).toBe("string");
            expect(text as string).toMatch(/^PF2e Combat Notebook:/);
            expect((text as string).length).toBeLessThanOrEqual(200);
        }
    });

    it("reports startup failure separately from support and success", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(startRuntime(() => undefined, {
            hooks: new FakeHooks(),
            identity: () => {
                throw new Error("no game");
            },
            scope: () => ({ sceneId: "s", combatId: null }),
            currentTargets: () => [],
        })).toMatchObject({ supported: false, failed: true });
        expect(startRuntime(() => undefined, {
            hooks: new FakeHooks(),
            identity: () => ({
                foundryGeneration: 14, systemId: "pf2e", systemVersion: "8.5.1", worldId: "w", userId: "u",
            }),
            scope: () => {
                throw new Error("no scene");
            },
            currentTargets: () => [],
        })).toMatchObject({ supported: true, failed: true });
        const harness = start();
        harness.teardown();
        expect(startRuntime(() => undefined, {
            hooks: new FakeHooks(),
            identity: () => ({
                foundryGeneration: 14, systemId: "pf2e", systemVersion: "8.6.0", worldId: "w", userId: "u",
            }),
            scope: () => ({ sceneId: "s", combatId: null }),
            currentTargets: () => [],
        })).toMatchObject({ supported: false, failed: false });
    });

    it("does not emit after teardown even if a stale hook fires", () => {
        const harness = start();
        const stale = [...harness.hooks.registrations.values()].find((entry) => entry.name === "canvasReady")!;
        harness.teardown();
        harness.emitted.length = 0;
        stale.callback({});
        expect(harness.emitted).toEqual([]);
    });
});

function fakeWindow(): {
    Hooks: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> };
    game: Record<string, unknown>;
    canvas: Record<string, unknown>;
} {
    const targets = new Set([token("a"), token("b")]);
    return {
        Hooks: { on: vi.fn(() => 7), off: vi.fn() },
        game: {
            ready: true,
            release: { generation: 14 },
            system: { id: "pf2e", version: "8.5.1" },
            world: { id: "world" },
            user: { id: "me", targets },
            scenes: { viewed: { id: "viewed" } },
            combat: { id: "combat" },
        },
        canvas: { scene: { id: "canvas-scene" } },
    };
}

describe("runtimeDependenciesFromWindow", () => {
    it("adapts Foundry globals into runtime dependencies", () => {
        const source = fakeWindow();
        const dependencies = runtimeDependenciesFromWindow(source);
        const callback = (): void => undefined;
        expect(dependencies.hooks.on("createChatMessage", callback)).toBe(7);
        expect(source.Hooks.on).toHaveBeenCalledWith("createChatMessage", callback);
        dependencies.hooks.off("createChatMessage", 7);
        expect(source.Hooks.off).toHaveBeenCalledWith("createChatMessage", 7);
        expect(dependencies.identity()).toEqual({
            foundryGeneration: 14,
            systemId: "pf2e",
            systemVersion: "8.5.1",
            worldId: "world",
            userId: "me",
        });
        expect(dependencies.scope()).toEqual({ sceneId: "canvas-scene", combatId: "combat" });
        expect(dependencies.currentTargets()).toHaveLength(2);
    });

    it("reads globals lazily and falls back to the viewed scene and exploration", () => {
        const source = fakeWindow();
        const dependencies = runtimeDependenciesFromWindow(source);
        source.canvas.scene = null;
        source.game.combat = null;
        (source.game.user as Record<string, unknown>).targets = undefined;
        expect(dependencies.scope()).toEqual({ sceneId: "viewed", combatId: null });
        expect(dependencies.currentTargets()).toEqual([]);
    });

    it("throws clear errors when required globals are missing", () => {
        expect(() => runtimeDependenciesFromWindow({})).toThrow("Foundry Hooks are unavailable");
        const source = fakeWindow();
        const dependencies = runtimeDependenciesFromWindow(source);
        source.game.world = {};
        expect(() => dependencies.identity()).toThrow("game.world.id is unavailable");
        source.canvas.scene = undefined;
        source.game.scenes = undefined;
        expect(() => dependencies.scope()).toThrow("scene id is unavailable");
        source.game.user = undefined;
        expect(() => dependencies.currentTargets()).toThrow("game.user is unavailable");
    });

    it("drives startRuntime end to end from a fake window", () => {
        const emitted: Observation[] = [];
        const runtime = startRuntime((observation) => emitted.push(observation), runtimeDependenciesFromWindow(fakeWindow()));
        expect(types(emitted)).toEqual(["handshake", "scope", "token-snapshot", "token-snapshot", "target"]);
        expect(runtime.supported).toBe(true);
        runtime.stop();
        runtime.stop();
    });
});

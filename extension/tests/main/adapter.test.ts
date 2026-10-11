import { afterEach, describe, expect, it, vi } from "vitest";
import { installPageAdapter } from "../../src/main/adapter.js";
import { COMMAND_EVENT, OBSERVATION_EVENT, type PageCommand } from "../../src/shared/protocol.js";

type Callback = (...args: unknown[]) => void;

interface FakeGlobals {
    Hooks?: {
        on: ReturnType<typeof vi.fn>;
        off: ReturnType<typeof vi.fn>;
        once?: ReturnType<typeof vi.fn>;
    };
    game?: Record<string, unknown>;
    canvas?: Record<string, unknown>;
    PIXI?: Record<string, unknown>;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.useRealTimers();
});

function globals(ready: boolean): FakeGlobals {
    let nextId = 1;
    return {
        Hooks: {
            on: vi.fn(() => nextId++),
            off: vi.fn(),
            once: vi.fn(),
        },
        game: {
            ready,
            release: { generation: 14 },
            system: { id: "pf2e", version: "8.5.1" },
            world: { id: "world" },
            user: { id: "me", targets: new Set() },
            combat: null,
        },
        canvas: { scene: { id: "scene" } },
    };
}

function install(fake: FakeGlobals): { observations: unknown[] } {
    Object.assign(window, fake);
    const observations: unknown[] = [];
    const listener = (event: Event): void => {
        observations.push((event as CustomEvent<unknown>).detail);
    };
    window.addEventListener(OBSERVATION_EVENT, listener);
    const uninstall = installPageAdapter(window);
    cleanups.push(() => {
        uninstall();
        window.removeEventListener(OBSERVATION_EVENT, listener);
        const target = window as unknown as Record<string, unknown>;
        delete target.Hooks;
        delete target.game;
        delete target.canvas;
        delete target.PIXI;
    });
    return { observations };
}

function command(type: PageCommand["type"]): void {
    window.dispatchEvent(new CustomEvent(COMMAND_EVENT, {
        detail: JSON.stringify({ protocol: 1, type, payload: {} }),
    }));
}

function renderOverlay(tokenUuid = "Scene.s.Token.t"): void {
    window.dispatchEvent(new CustomEvent(COMMAND_EVENT, {
        detail: JSON.stringify({
            protocol: 1,
            type: "render-overlay",
            payload: { tokenUuid, name: "Graveknight", ac: "28", provenance: "observed" },
        }),
    }));
}

class FakeNode {
    eventMode = "auto";
    parent: FakeContainer | null = null;
    destroyed = false;
    position = { set: vi.fn() };
    scale = { set: vi.fn() };
    anchor = { set: vi.fn() };
    destroy = vi.fn(() => {
        this.destroyed = true;
        if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
        this.parent = null;
    });
}

class FakeContainer extends FakeNode {
    children: FakeNode[] = [];

    addChild(child: FakeNode): void {
        child.parent = this;
        this.children.push(child);
    }
}

class FakeText extends FakeNode {
    text: string;

    constructor(options: { text: string }) {
        super();
        this.text = options.text;
    }
}

function withCanvas(fake: FakeGlobals): { layer: FakeContainer; token: Record<string, unknown> } {
    const layer = new FakeContainer();
    const token = { document: { uuid: "Scene.s.Token.t" }, center: { x: 10, y: 20 }, y: 5 };
    fake.canvas = {
        scene: { id: "scene" },
        interface: layer,
        tokens: { placeables: [token] },
        stage: { scale: { x: 1 } },
    };
    fake.PIXI = { VERSION: "8.6.6", Container: FakeContainer, Text: FakeText };
    return { layer, token };
}

function hookCallback(fake: FakeGlobals, name: string): Callback {
    const call = fake.Hooks?.on.mock.calls.find((entry) => entry[0] === name);
    if (!call) throw new Error(`${name} not registered`);
    return call[1] as Callback;
}

function labelOf(layer: FakeContainer): FakeText | undefined {
    return (layer.children[0] as FakeContainer | undefined)?.children[0] as FakeText | undefined;
}

function parsedTypes(observations: unknown[]): string[] {
    return observations.map((detail) => (JSON.parse(detail as string) as { type: string }).type);
}

describe("main-world page adapter", () => {
    it("starts the runtime on activate when Foundry is ready and emits string details", () => {
        const fake = globals(true);
        const { observations } = install(fake);
        command("activate");
        expect(observations.every((detail) => typeof detail === "string")).toBe(true);
        expect(parsedTypes(observations)).toEqual(["handshake", "scope", "target"]);
    });

    it("starts the runtime only once for repeated activation", () => {
        const fake = globals(true);
        const { observations } = install(fake);
        command("activate");
        command("activate");
        expect(parsedTypes(observations).filter((type) => type === "handshake")).toHaveLength(1);
    });

    it("waits for the ready hook when Foundry is not ready yet", () => {
        const fake = globals(false);
        const { observations } = install(fake);
        command("activate");
        command("activate");
        expect(observations).toEqual([]);
        expect(fake.Hooks?.once).toHaveBeenCalledOnce();
        expect(fake.Hooks?.once).toHaveBeenCalledWith("ready", expect.any(Function));
        const ready = fake.Hooks?.once?.mock.calls[0]?.[1] as Callback;
        ready();
        expect(parsedTypes(observations)).toEqual(["handshake", "scope", "target"]);
    });

    it("does not start after teardown even if the ready hook fires later", () => {
        const fake = globals(false);
        const { observations } = install(fake);
        command("activate");
        command("teardown");
        const ready = fake.Hooks?.once?.mock.calls[0]?.[1] as Callback;
        ready();
        expect(observations).toEqual([]);
    });

    it("allows a later activation to wait again after Hooks.once throws", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fake = globals(false);
        fake.Hooks?.once?.mockImplementationOnce(() => {
            throw new Error("hooks broken");
        });
        const { observations } = install(fake);
        expect(() => command("activate")).not.toThrow();
        command("activate");
        expect(fake.Hooks?.once).toHaveBeenCalledTimes(2);
        const ready = fake.Hooks?.once?.mock.calls[1]?.[1] as Callback;
        ready();
        expect(parsedTypes(observations)).toEqual(["handshake", "scope", "target"]);
    });

    it("retries while Hooks.once is unavailable and falls back after the retry window", () => {
        vi.useFakeTimers();
        const fake = globals(false);
        delete fake.Hooks?.once;
        const { observations } = install(fake);
        expect(() => command("activate")).not.toThrow();
        vi.advanceTimersByTime(29_000);
        expect(observations).toEqual([]);
        vi.advanceTimersByTime(5_000);
        expect(parsedTypes(observations)).toEqual(["handshake"]);
        expect(JSON.parse(observations[0] as string)).toMatchObject({
            payload: { status: "fallback", foundry: "unknown", worldId: "unknown", reason: expect.any(String) },
        });
        vi.advanceTimersByTime(60_000);
        expect(observations).toHaveLength(1);
        vi.useRealTimers();
    });

    it("retries until Foundry globals appear at document_start, then waits for ready once", () => {
        vi.useFakeTimers();
        const fake = globals(false);
        const { observations } = install({});
        command("activate");
        vi.advanceTimersByTime(1_000);
        Object.assign(window, fake);
        vi.advanceTimersByTime(4_000);
        expect(fake.Hooks?.once).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(60_000);
        expect(fake.Hooks?.once).toHaveBeenCalledOnce();
        expect(observations).toEqual([]);
        (fake.game as { ready: boolean }).ready = true;
        (fake.Hooks?.once?.mock.calls[0]?.[1] as Callback)();
        expect(parsedTypes(observations)).toEqual(["handshake", "scope", "target"]);
        expect(JSON.parse(observations[0] as string)).toMatchObject({ payload: { status: "active" } });
        vi.useRealTimers();
    });

    it("cancels pending retries on teardown", () => {
        vi.useFakeTimers();
        const { observations } = install({});
        command("activate");
        vi.advanceTimersByTime(1_000);
        command("teardown");
        Object.assign(window, globals(true));
        vi.advanceTimersByTime(60_000);
        expect(observations).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        vi.useRealTimers();
    });

    it("stays active without fallback when no scene is available at startup", () => {
        vi.useFakeTimers();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fake = globals(true);
        delete fake.canvas;
        const { observations } = install(fake);
        command("activate");
        vi.advanceTimersByTime(60_000);
        expect(parsedTypes(observations)).toEqual(["handshake", "target"]);
        expect(JSON.parse(observations[0] as string)).toMatchObject({ payload: { status: "active" } });
        fake.canvas = { scene: { id: "scene" } };
        Object.assign(window, { canvas: fake.canvas });
        hookCallback(fake, "canvasReady")();
        expect(parsedTypes(observations)).toEqual(["handshake", "target", "scope", "target"]);
        vi.useRealTimers();
    });

    it("switches to fallback with the known identity when startup fails after compatibility passed", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fake = globals(true);
        let nextId = 1;
        fake.Hooks!.on = vi.fn((name: string) => {
            if (name === "canvasReady") throw new Error("hooks broken");
            return nextId++;
        });
        const { observations } = install(fake);
        command("activate");
        expect(parsedTypes(observations)).toEqual(["handshake", "handshake"]);
        const [first, second] = observations.map((detail) => JSON.parse(detail as string) as {
            payload: Record<string, unknown>;
        });
        expect(first?.payload.status).toBe("active");
        expect(second?.payload).toMatchObject({
            status: "fallback",
            foundry: "14",
            system: "pf2e",
            systemVersion: "8.5.1",
            worldId: "world",
            userId: "me",
            reason: expect.any(String),
        });
        expect(fake.Hooks?.off).toHaveBeenCalledTimes((fake.Hooks?.on.mock.calls.length ?? 0) - 1);
        expect(warn).toHaveBeenCalled();
    });

    it("keeps an unsupported version unsupported without fallback", () => {
        vi.useFakeTimers();
        const fake = globals(true);
        (fake.game?.system as { version: string }).version = "8.6.0";
        const { observations } = install(fake);
        command("activate");
        vi.advanceTimersByTime(60_000);
        expect(parsedTypes(observations)).toEqual(["handshake"]);
        expect(JSON.parse(observations[0] as string)).toMatchObject({ payload: { status: "unsupported" } });
        vi.useRealTimers();
    });

    it("tears down hook registrations idempotently", () => {
        const fake = globals(true);
        install(fake);
        command("activate");
        const registered = fake.Hooks?.on.mock.calls.length ?? 0;
        expect(registered).toBeGreaterThan(0);
        command("teardown");
        command("teardown");
        expect(fake.Hooks?.off).toHaveBeenCalledTimes(registered);
    });

    it("ignores object, malformed, and invalid command details", () => {
        const fake = globals(true);
        const { observations } = install(fake);
        window.dispatchEvent(new CustomEvent(COMMAND_EVENT, {
            detail: { protocol: 1, type: "activate", payload: {} },
        }));
        window.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: "{oops" }));
        window.dispatchEvent(new CustomEvent(COMMAND_EVENT, {
            detail: JSON.stringify({ protocol: 1, type: "launch", payload: {} }),
        }));
        expect(observations).toEqual([]);
    });

    it("accepts overlay commands without effects when PIXI is unavailable", () => {
        const warn = vi.spyOn(console, "warn");
        const fake = globals(true);
        const { layer } = withCanvas(fake);
        delete fake.PIXI;
        install(fake);
        command("activate");
        expect(() => command("clear-overlay")).not.toThrow();
        expect(() => renderOverlay()).not.toThrow();
        expect(layer.children).toHaveLength(0);
        expect(() => hookCallback(fake, "canvasPan")()).not.toThrow();
        expect(layer.children).toHaveLength(0);
        expect(warn).not.toHaveBeenCalled();
    });

    it("keeps the overlay inert when the handshake is unsupported", () => {
        const fake = globals(true);
        (fake.game?.system as { version: string }).version = "8.6.0";
        const { layer } = withCanvas(fake);
        const { observations } = install(fake);
        command("activate");
        expect(parsedTypes(observations)).toEqual(["handshake"]);
        renderOverlay();
        expect(fake.Hooks?.on).not.toHaveBeenCalled();
        expect(layer.children).toHaveLength(0);
    });

    it("ignores render-overlay before activation", () => {
        const fake = globals(true);
        const { layer } = withCanvas(fake);
        install(fake);
        renderOverlay();
        expect(layer.children).toHaveLength(0);
    });

    it("routes render-overlay and clear-overlay to the overlay and destroys it on teardown", () => {
        const fake = globals(true);
        const { layer } = withCanvas(fake);
        install(fake);
        command("activate");
        renderOverlay();
        const label = labelOf(layer);
        expect(label?.text).toBe("Graveknight · AC 28 (observed)");
        command("clear-overlay");
        expect(label?.destroy).toHaveBeenCalledOnce();
        renderOverlay();
        const root = layer.children[0] as FakeContainer;
        command("teardown");
        expect(root.destroy).toHaveBeenCalledOnce();
        expect(layer.children).toHaveLength(0);
        renderOverlay();
        expect(layer.children).toHaveLength(0);
    });

    it("refreshes on canvas hooks, clears on canvas teardown, and unregisters on teardown", () => {
        const fake = globals(true);
        const { layer, token } = withCanvas(fake);
        install(fake);
        command("activate");
        renderOverlay();
        const position = labelOf(layer)?.position.set;
        (token.center as { x: number }).x = 99;
        hookCallback(fake, "refreshToken")({ document: { uuid: "Scene.s.Token.other" } });
        hookCallback(fake, "updateToken")({ uuid: "Scene.s.Token.other" });
        hookCallback(fake, "refreshToken")(null);
        hookCallback(fake, "updateToken")(undefined);
        expect(position).toHaveBeenCalledTimes(1);
        hookCallback(fake, "refreshToken")(token);
        expect(position).toHaveBeenLastCalledWith(99, -7);
        (token.center as { x: number }).x = 50;
        hookCallback(fake, "updateToken")(token.document);
        expect(position).toHaveBeenLastCalledWith(50, -7);
        (token.center as { x: number }).x = 60;
        hookCallback(fake, "canvasPan")();
        expect(position).toHaveBeenLastCalledWith(60, -7);
        hookCallback(fake, "canvasTearDown")();
        expect((layer.children[0] as FakeContainer).children).toHaveLength(0);
        const overlayHookNames = ["canvasPan", "updateToken", "refreshToken", "canvasTearDown"];
        command("teardown");
        const removed = fake.Hooks?.off.mock.calls.map((entry) => entry[0]) ?? [];
        expect(removed).toEqual(expect.arrayContaining(overlayHookNames));
    });

    it("swallows overlay hook errors, warns, and clears", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fake = globals(true);
        const { layer } = withCanvas(fake);
        install(fake);
        command("activate");
        renderOverlay();
        const label = labelOf(layer);
        (fake.canvas as Record<string, unknown>).stage = {
            get scale(): never {
                throw new Error("stage broken");
            },
        };
        expect(() => hookCallback(fake, "canvasPan")()).not.toThrow();
        expect(warn).toHaveBeenCalledOnce();
        expect(label?.destroy).toHaveBeenCalledOnce();
    });

    it("warns when the fallback clear also fails", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fake = globals(true);
        const { layer } = withCanvas(fake);
        install(fake);
        command("activate");
        renderOverlay();
        labelOf(layer)?.destroy.mockImplementation(() => {
            throw new Error("destroy broken");
        });
        (fake.canvas as Record<string, unknown>).stage = {
            get scale(): never {
                throw new Error("stage broken");
            },
        };
        expect(() => hookCallback(fake, "canvasPan")()).not.toThrow();
        expect(warn).toHaveBeenCalledTimes(2);
        expect(String(warn.mock.calls[1]?.[0])).toContain("destroy broken");
    });

    it("warns with a bounded message and reports unsupported when the identity is unavailable", () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fake = globals(true);
        fake.game!.system = null;
        const { observations } = install(fake);
        expect(() => command("activate")).not.toThrow();
        vi.advanceTimersByTime(60_000);
        expect(parsedTypes(observations)).toEqual(["handshake"]);
        expect(JSON.parse(observations[0] as string)).toMatchObject({
            payload: { status: "unsupported", reason: "Foundry identity unavailable." },
        });
        expect(fake.Hooks?.on).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledOnce();
        const message = String(warn.mock.calls[0]?.[0]);
        expect(message.startsWith("PF2e Combat Notebook:")).toBe(true);
        expect(message.length).toBeLessThanOrEqual(200);
    });

    it("never throws even if console.warn throws", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {
            throw new Error("console broken");
        });
        const fake = globals(true);
        delete fake.Hooks;
        install(fake);
        expect(() => command("activate")).not.toThrow();
    });
});

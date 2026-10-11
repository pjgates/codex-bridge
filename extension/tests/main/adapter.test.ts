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
}

const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
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
    });
    return { observations };
}

function command(type: PageCommand["type"]): void {
    window.dispatchEvent(new CustomEvent(COMMAND_EVENT, {
        detail: JSON.stringify({ protocol: 1, type, payload: {} }),
    }));
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

    it("stays inert when Foundry is not ready and has no Hooks.once", () => {
        const fake = globals(false);
        delete fake.Hooks?.once;
        const { observations } = install(fake);
        expect(() => command("activate")).not.toThrow();
        expect(observations).toEqual([]);
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

    it("accepts overlay commands without effects", () => {
        const fake = globals(true);
        const { observations } = install(fake);
        command("clear-overlay");
        window.dispatchEvent(new CustomEvent(COMMAND_EVENT, {
            detail: JSON.stringify({
                protocol: 1,
                type: "render-overlay",
                payload: { tokenUuid: "Scene.s.Token.t", name: "Graveknight", ac: "28" },
            }),
        }));
        expect(observations).toEqual([]);
    });

    it("warns with a bounded message and stays inert when startup fails", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fake = globals(true);
        delete fake.Hooks;
        const { observations } = install(fake);
        expect(() => command("activate")).not.toThrow();
        expect(observations).toEqual([]);
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

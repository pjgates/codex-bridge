import { afterEach, describe, expect, it, vi } from "vitest";
import {
    callWorker,
    loadNotebook,
    requestOriginStatus,
    saveNotebook,
    WORKER_TIMEOUT_MS,
    type RuntimeMessenger,
} from "../../src/content/worker-client.js";
import { emptyNotebook } from "../../src/core/reducer.js";

const ORIGIN = "https://foundry.example.test";

interface FakeMessenger extends RuntimeMessenger {
    lastError: { message?: string } | undefined;
    sendMessage: ReturnType<typeof vi.fn> & RuntimeMessenger["sendMessage"];
}

function messenger(reply: (message: unknown) => unknown): FakeMessenger {
    const runtime: FakeMessenger = {
        lastError: undefined as { message?: string } | undefined,
        sendMessage: vi.fn((message: unknown, callback: (response: unknown) => void) => {
            const response = reply(message);
            void Promise.resolve().then(() => callback(response));
        }),
    };
    return runtime;
}

afterEach(() => {
    vi.useRealTimers();
});

describe("content worker client", () => {
    it("sends origin-status and reads a boolean enabled flag", async () => {
        const runtime = messenger(() => ({ ok: true, enabled: true }));
        await expect(requestOriginStatus(runtime, ORIGIN)).resolves.toBe(true);
        expect(runtime.sendMessage).toHaveBeenCalledWith({ type: "origin-status", origin: ORIGIN }, expect.any(Function));
        await expect(requestOriginStatus(messenger(() => ({ ok: true, enabled: false })), ORIGIN)).resolves.toBe(false);
    });

    it.each([
        undefined,
        "yes",
        { ok: true },
        { ok: true, enabled: "true" },
        { ok: "true", enabled: true },
        { ok: false, error: "Origin does not match sender." },
    ])("rejects a malformed or failed origin-status response %#", async (response) => {
        await expect(requestOriginStatus(messenger(() => response), ORIGIN)).rejects.toThrow();
    });

    it("loads stored state or null and rejects malformed load responses", async () => {
        const state = emptyNotebook();
        await expect(loadNotebook(messenger(() => ({ ok: true, state })), "k")).resolves.toEqual(state);
        await expect(loadNotebook(messenger(() => ({ ok: true, state: null })), "k")).resolves.toBeNull();
        await expect(loadNotebook(messenger(() => ({ ok: true })), "k")).rejects.toThrow();
        await expect(loadNotebook(messenger(() => ({ ok: true, state: 3 })), "k")).rejects.toThrow();
        await expect(loadNotebook(messenger(() => ({ ok: false, error: "no" })), "k")).rejects.toThrow("no");
    });

    it("saves through the worker and rejects failed saves", async () => {
        const state = emptyNotebook();
        const runtime = messenger(() => ({ ok: true }));
        await expect(saveNotebook(runtime, "k", state)).resolves.toBeUndefined();
        expect(runtime.sendMessage).toHaveBeenCalledWith({ type: "save-notebook", key: "k", state }, expect.any(Function));
        await expect(saveNotebook(messenger(() => ({ ok: false, error: "full" })), "k", state)).rejects.toThrow("full");
        await expect(saveNotebook(messenger(() => null), "k", state)).rejects.toThrow();
    });

    it("rejects when chrome.runtime.lastError is set or sendMessage throws", async () => {
        const runtime = messenger(() => undefined);
        runtime.sendMessage.mockImplementation((_message: unknown, callback: (response: unknown) => void) => {
            runtime.lastError = { message: "Receiving end does not exist." };
            callback(undefined);
            runtime.lastError = undefined;
        });
        await expect(callWorker(runtime, { type: "origin-status", origin: ORIGIN })).rejects.toThrow("Receiving end");
        runtime.sendMessage.mockImplementation(() => {
            throw new Error("Extension context invalidated.");
        });
        await expect(callWorker(runtime, { type: "origin-status", origin: ORIGIN })).rejects.toThrow("invalidated");
    });

    it("rejects after the timeout when the worker never answers", async () => {
        vi.useFakeTimers();
        const runtime = messenger(() => undefined);
        runtime.sendMessage.mockImplementation(() => undefined);
        const pending = callWorker(runtime, { type: "origin-status", origin: ORIGIN });
        const assertion = expect(pending).rejects.toThrow(/timed out/);
        await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);
        await assertion;
        expect(vi.getTimerCount()).toBe(0);
    });
});

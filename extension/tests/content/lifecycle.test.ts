import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    bootContentScript,
    HANDSHAKE_TIMEOUT_MS,
    type ContentChrome,
    type ContentHandle,
} from "../../src/content/lifecycle.js";
import { HOST_ID } from "../../src/content/sidebar.js";
import { WORKER_TIMEOUT_MS } from "../../src/content/worker-client.js";
import { ENABLED_ORIGINS_KEY } from "../../src/shared/extension-messages.js";
import { COMMAND_EVENT, OBSERVATION_EVENT, type Observation } from "../../src/shared/protocol.js";

const ORIGIN = "https://foundry.example.test:30000";
const RUNTIME_ID = "extension-id";

type MessageListener = (message: unknown, sender: chrome.runtime.MessageSender) => void;
type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;

interface FakeChrome extends ContentChrome {
    requests: unknown[];
    held: ((response: unknown) => void)[];
    messageListeners: Set<MessageListener>;
    storageListeners: Set<StorageListener>;
}

function fakeChrome(reply: (message: unknown) => unknown = () => ({ ok: true, enabled: true })): FakeChrome {
    const messageListeners = new Set<MessageListener>();
    const storageListeners = new Set<StorageListener>();
    const requests: unknown[] = [];
    const held: ((response: unknown) => void)[] = [];
    return {
        requests,
        held,
        messageListeners,
        storageListeners,
        runtime: {
            id: RUNTIME_ID,
            lastError: undefined,
            sendMessage(message, callback) {
                requests.push(message);
                const response = reply(message);
                if (response === NO_REPLY) {
                    held.push(callback);
                    return;
                }
                void Promise.resolve().then(() => callback(response));
            },
            onMessage: {
                addListener: (listener) => messageListeners.add(listener),
                removeListener: (listener) => messageListeners.delete(listener),
            },
        },
        storage: {
            onChanged: {
                addListener: (listener) => storageListeners.add(listener),
                removeListener: (listener) => storageListeners.delete(listener),
            },
        },
    };
}

const NO_REPLY = Symbol("no reply");

function workerReply(message: unknown): unknown {
    const type = (message as { type?: string }).type;
    if (type === "origin-status") return { ok: true, enabled: true };
    if (type === "load-notebook") return { ok: true, state: null };
    return { ok: true };
}

const commands: { type: string }[] = [];
const commandListener = (event: Event): void => {
    commands.push(JSON.parse((event as CustomEvent<string>).detail) as { type: string });
};

const handles: ContentHandle[] = [];

beforeEach(() => {
    window.addEventListener(COMMAND_EVENT, commandListener);
});

afterEach(async () => {
    for (const handle of handles.splice(0)) await handle.teardown();
    window.removeEventListener(COMMAND_EVENT, commandListener);
    commands.length = 0;
    document.body.replaceChildren();
    vi.useRealTimers();
});

async function boot(api: FakeChrome = fakeChrome(workerReply)): Promise<ContentHandle | null> {
    const handle = await bootContentScript({ chrome: api, window, document, origin: ORIGIN });
    if (handle) handles.push(handle);
    return handle;
}

async function booted(api?: FakeChrome): Promise<ContentHandle> {
    const handle = await boot(api);
    if (!handle) throw new Error("content script did not boot");
    return handle;
}

function handshake(status: "active" | "fallback" | "unsupported", eventId: string = status): Observation {
    return {
        protocol: 1,
        eventId,
        timestamp: 1,
        type: "handshake",
        payload: { status, foundry: "14", system: "pf2e", systemVersion: "8.5.1", worldId: "world", userId: "me" },
    };
}

function emitObservation(observation: Observation): void {
    window.dispatchEvent(new CustomEvent(OBSERVATION_EVENT, { detail: JSON.stringify(observation) }));
}

function chatCard(messageId: string): HTMLElement {
    const element = document.createElement("li");
    element.className = "chat-message";
    element.dataset.messageId = messageId;
    element.innerHTML = `<span class="dice-total">21</span><span class="degree-of-success failure">Failure</span>`;
    return element;
}

function hasCardDiagnostic(handle: ContentHandle, messageId: string): boolean {
    return handle.controller.state().diagnostics.some((entry) => entry.includes(`message ${messageId}`));
}

function host(): HTMLElement | null {
    return document.getElementById(HOST_ID);
}

function tabMessage(api: FakeChrome, message: unknown, sender: chrome.runtime.MessageSender = { id: RUNTIME_ID }): void {
    for (const listener of [...api.messageListeners]) listener(message, sender);
}

function storageChange(api: FakeChrome, changes: Record<string, chrome.storage.StorageChange>, area = "local"): void {
    for (const listener of [...api.storageListeners]) listener(changes, area);
}

describe("content script origin gate", () => {
    it("asks for the exact origin and activates the page adapter after attaching the bridge", async () => {
        const api = fakeChrome(workerReply);
        const onActivate = (event: Event): void => {
            if ((JSON.parse((event as CustomEvent<string>).detail) as { type: string }).type === "activate") {
                emitObservation(handshake("active"));
            }
        };
        window.addEventListener(COMMAND_EVENT, onActivate);
        const handle = await booted(api);
        window.removeEventListener(COMMAND_EVENT, onActivate);
        await handle.controller.flush();
        expect(api.requests[0]).toEqual({ type: "origin-status", origin: ORIGIN });
        expect(host()).not.toBeNull();
        expect(commands.filter((command) => command.type === "activate")).toHaveLength(1);
        expect(handle.controller.state().compatibility).toBe("active");
    });

    it.each([
        ["disabled", { ok: true, enabled: false }],
        ["malformed", { ok: true, enabled: "yes" }],
        ["rejected", { ok: false, error: "Origin does not match sender." }],
        ["empty", undefined],
    ])("touches nothing when the origin status is %s", async (_label, response) => {
        const api = fakeChrome(() => response);
        await expect(boot(api)).resolves.toBeNull();
        expect(host()).toBeNull();
        expect(commands).toEqual([]);
        expect(api.messageListeners.size).toBe(0);
        expect(api.storageListeners.size).toBe(0);
    });

    it("touches nothing when the worker never answers", async () => {
        vi.useFakeTimers();
        const api = fakeChrome(() => NO_REPLY);
        const pending = boot(api);
        await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);
        await expect(pending).resolves.toBeNull();
        expect(host()).toBeNull();
        expect(commands).toEqual([]);
    });

    it("loads and saves notebooks through the worker", async () => {
        const api = fakeChrome(workerReply);
        const handle = await booted(api);
        emitObservation(handshake("active"));
        emitObservation({ protocol: 1, eventId: "scope", timestamp: 2, type: "scope", payload: { sceneId: "s", combatId: null } });
        await handle.controller.flush();
        const types = api.requests.map((request) => (request as { type: string }).type);
        expect(types).toEqual(expect.arrayContaining(["load-notebook", "save-notebook"]));
    });
});

describe("content script fallback mode", () => {
    it("constructs a fallback handshake when the adapter does not respond and starts reading chat cards", async () => {
        vi.useFakeTimers();
        document.body.append(chatCard("m1"));
        const handle = await booted();
        await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS - 1);
        expect(handle.controller.state().compatibility).toBe("unsupported");
        expect(hasCardDiagnostic(handle, "m1")).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await handle.controller.flush();
        expect(handle.controller.state()).toMatchObject({
            compatibility: "fallback",
            compatibilityReason: "Foundry adapter did not respond; reading rendered chat cards only.",
        });
        expect(hasCardDiagnostic(handle, "m1")).toBe(true);
    });

    it("starts reading chat cards after a fallback handshake and stops when an active handshake arrives", async () => {
        const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
        document.body.append(chatCard("m1"));
        const handle = await booted();
        emitObservation(handshake("fallback"));
        await handle.controller.flush();
        await Promise.resolve();
        expect(hasCardDiagnostic(handle, "m1")).toBe(true);
        expect(disconnect).not.toHaveBeenCalled();
        emitObservation(handshake("active"));
        await handle.controller.flush();
        await Promise.resolve();
        expect(disconnect).toHaveBeenCalledOnce();
    });

    it.each(["active", "unsupported"] as const)("never reads chat cards after an %s handshake", async (status) => {
        vi.useFakeTimers();
        document.body.append(chatCard("m1"));
        const handle = await booted();
        emitObservation(handshake(status));
        await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS * 2);
        await handle.controller.flush();
        expect(handle.controller.state().compatibility).toBe(status);
        expect(hasCardDiagnostic(handle, "m1")).toBe(false);
    });
});

describe("content script tab lifecycle", () => {
    it.each([
        ["a teardown tab message", (api: FakeChrome) => tabMessage(api, { type: "teardown" })],
        ["origin removal from storage", (api: FakeChrome) => storageChange(api, { [ENABLED_ORIGINS_KEY]: { newValue: [] } })],
        ["pagehide", () => window.dispatchEvent(new Event("pagehide"))],
    ])("stops booting when %s arrives during the origin-status request", async (_label, trigger) => {
        const api = fakeChrome(() => NO_REPLY);
        const pending = boot(api);
        expect(api.held).toHaveLength(1);
        expect(api.messageListeners.size).toBe(1);
        expect(api.storageListeners.size).toBe(1);
        trigger(api);
        api.held[0]!({ ok: true, enabled: true });
        await expect(pending).resolves.toBeNull();
        expect(host()).toBeNull();
        expect(commands).toEqual([]);
        expect(api.messageListeners.size).toBe(0);
        expect(api.storageListeners.size).toBe(0);
        expect(api.requests).toEqual([{ type: "origin-status", origin: ORIGIN }]);
    });

    it("tears down once on a teardown tab message", async () => {
        const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
        const api = fakeChrome(workerReply);
        const handle = await booted(api);
        emitObservation(handshake("fallback"));
        await handle.controller.flush();
        await Promise.resolve();
        tabMessage(api, { type: "teardown" });
        tabMessage(api, { type: "teardown" });
        await handle.teardown();
        expect(commands.filter((command) => command.type === "teardown")).toHaveLength(1);
        expect(host()).toBeNull();
        expect(disconnect).toHaveBeenCalledOnce();
        expect(api.messageListeners.size).toBe(0);
        expect(api.storageListeners.size).toBe(0);
        const before = handle.controller.state();
        emitObservation(handshake("active", "late"));
        await handle.controller.flush();
        expect(handle.controller.state()).toBe(before);
    });

    it("tears down on pagehide and cancels the handshake timer", async () => {
        vi.useFakeTimers();
        const handle = await booted();
        window.dispatchEvent(new Event("pagehide"));
        await handle.teardown();
        expect(commands.filter((command) => command.type === "teardown")).toHaveLength(1);
        expect(host()).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("tears down when the exact origin is removed from storage and ignores unrelated changes", async () => {
        const api = fakeChrome(workerReply);
        await booted(api);
        storageChange(api, { other: { newValue: [] } });
        storageChange(api, { [ENABLED_ORIGINS_KEY]: { newValue: [] } }, "session");
        storageChange(api, { [ENABLED_ORIGINS_KEY]: { newValue: [ORIGIN, "https://other.test"] } });
        storageChange(api, { [ENABLED_ORIGINS_KEY]: { newValue: ["https://foundry.example.test"] } });
        expect(commands.filter((command) => command.type === "teardown")).toHaveLength(1);
        expect(host()).toBeNull();
    });

    it("treats a deleted allowlist as removal", async () => {
        const api = fakeChrome(workerReply);
        await booted(api);
        storageChange(api, { [ENABLED_ORIGINS_KEY]: { oldValue: [ORIGIN] } });
        expect(host()).toBeNull();
    });

    it("toggles the sidebar and ignores foreign or malformed tab messages", async () => {
        const api = fakeChrome(workerReply);
        await booted(api);
        const panel = (): Element | null | undefined => host()?.shadowRoot?.querySelector(".pcn-panel");
        tabMessage(api, { type: "toggle-sidebar" }, { id: "other-extension" });
        tabMessage(api, { type: "teardown" }, { id: "other-extension" });
        tabMessage(api, { type: "teardown", extra: true });
        tabMessage(api, { type: "launch" });
        tabMessage(api, "teardown");
        expect(host()).not.toBeNull();
        expect(panel()?.classList.contains("pcn-collapsed")).toBe(true);
        tabMessage(api, { type: "toggle-sidebar" });
        expect(panel()?.classList.contains("pcn-collapsed")).toBe(false);
        expect(commands.filter((command) => command.type === "teardown")).toHaveLength(0);
    });

    it("remounts the sidebar when the page removed its host", async () => {
        const handle = await booted();
        host()?.remove();
        emitObservation(handshake("active"));
        await handle.controller.flush();
        expect(host()?.shadowRoot?.querySelector(".pcn-status")?.textContent).toContain("Active");
    });
});

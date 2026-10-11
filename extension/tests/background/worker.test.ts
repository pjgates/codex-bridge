import { describe, expect, it } from "vitest";
import { SCRIPT_IDS } from "../../src/background/origin.js";
import { createWorker, type WorkerApi } from "../../src/background/worker.js";
import { emptyNotebook } from "../../src/core/reducer.js";
import { ENABLED_ORIGINS_KEY, type ExtensionResponse } from "../../src/shared/extension-messages.js";

const RUNTIME_ID = "abcdefghijklmnopabcdefghijklmnop";
const EXTENSION_BASE = `chrome-extension://${RUNTIME_ID}/`;
const ORIGIN = "http://localhost:30000";
const PATTERN = "http://localhost/*";
const KEY = `notebook:${ORIGIN}:world:user:scene:combat`;

const popup: chrome.runtime.MessageSender = { id: RUNTIME_ID, url: `${EXTENSION_BASE}popup.html` };

function contentSender(url: string): chrome.runtime.MessageSender {
    return { id: RUNTIME_ID, url, tab: { id: 7 } as chrome.tabs.Tab };
}

function fakeApi(granted: string[] = [PATTERN]) {
    const local = new Map<string, unknown>();
    const session = new Map<string, unknown>();
    const scripts = new Map<string, chrome.scripting.RegisteredContentScript>();
    const permissions = new Set(granted);
    const api: WorkerApi = {
        runtimeId: RUNTIME_ID,
        extensionBaseUrl: EXTENSION_BASE,
        localGet: async (key) => local.get(key),
        localSet: async (key, value) => {
            local.set(key, structuredClone(value));
        },
        sessionGet: async (key) => (key === null
            ? Object.fromEntries(session)
            : session.has(key) ? { [key]: session.get(key) } : {}),
        sessionSet: async (items) => {
            for (const [key, value] of Object.entries(items)) session.set(key, structuredClone(value));
        },
        sessionRemove: async (keys) => {
            for (const key of keys) session.delete(key);
        },
        registeredScriptIds: async (ids) => ids.filter((id) => scripts.has(id)),
        registerScripts: async (registrations) => {
            for (const script of registrations) {
                if (scripts.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
                scripts.set(script.id, script);
            }
        },
        unregisterScripts: async (ids) => {
            for (const id of ids) scripts.delete(id);
        },
        hasPermission: async (pattern) => permissions.has(pattern),
        removePermission: async (pattern) => {
            permissions.delete(pattern);
        },
    };
    return { api, local, session, scripts, permissions };
}

async function send(
    worker: ReturnType<typeof createWorker>,
    message: unknown,
    sender: chrome.runtime.MessageSender,
): Promise<ExtensionResponse> {
    return worker.receive(message, sender);
}

describe("service worker", () => {
    it("enables an origin idempotently and registers both scripts", async () => {
        const fake = fakeApi();
        const worker = createWorker(fake.api);
        expect(await send(worker, { type: "enable-origin", origin: ORIGIN }, popup)).toEqual({ ok: true, enabled: true });
        expect(await send(worker, { type: "enable-origin", origin: `${ORIGIN}/game` }, popup)).toEqual({ ok: true, enabled: true });
        expect(fake.local.get(ENABLED_ORIGINS_KEY)).toEqual([ORIGIN]);
        expect([...fake.scripts.keys()]).toEqual([...SCRIPT_IDS]);
        expect(fake.scripts.get("pf2e-notebook-main")?.matches).toEqual([PATTERN]);
        expect(await send(worker, { type: "origin-status", origin: ORIGIN }, popup)).toEqual({ ok: true, enabled: true });
    });

    it("refuses to enable without host permission", async () => {
        const fake = fakeApi([]);
        const worker = createWorker(fake.api);
        expect(await send(worker, { type: "enable-origin", origin: ORIGIN }, popup))
            .toEqual({ ok: false, error: "Site access was not granted." });
        expect(fake.scripts.size).toBe(0);
    });

    it("rejects enable/disable requests from content scripts", async () => {
        const worker = createWorker(fakeApi().api);
        const response = await send(worker, { type: "enable-origin", origin: ORIGIN }, contentSender(`${ORIGIN}/game`));
        expect(response.ok).toBe(false);
    });

    it("saves and loads checkpoints for an authorized content origin", async () => {
        const fake = fakeApi();
        const worker = createWorker(fake.api);
        await send(worker, { type: "enable-origin", origin: ORIGIN }, popup);
        const sender = contentSender(`${ORIGIN}/game`);
        const state = emptyNotebook();
        expect(await send(worker, { type: "save-notebook", key: KEY, state }, sender)).toEqual({ ok: true });
        expect(await send(worker, { type: "load-notebook", key: KEY }, sender)).toEqual({ ok: true, state });
        expect(await send(worker, { type: "load-notebook", key: `${KEY}:other` }, sender)).toEqual({ ok: true, state: null });
        expect(await send(worker, { type: "origin-status", origin: ORIGIN }, sender)).toEqual({ ok: true, enabled: true });
        expect(await send(worker, { type: "clear-notebook", key: KEY }, sender)).toEqual({ ok: true });
        expect(fake.session.has(KEY)).toBe(false);
    });

    it("rejects content requests from an unauthorized origin", async () => {
        const fake = fakeApi();
        const worker = createWorker(fake.api);
        await send(worker, { type: "enable-origin", origin: ORIGIN }, popup);
        const sender = contentSender("http://localhost:30001/game");
        const key = "notebook:http://localhost:30001:w:u:s";
        expect((await send(worker, { type: "save-notebook", key, state: emptyNotebook() }, sender)).ok).toBe(false);
        expect((await send(worker, { type: "load-notebook", key }, sender)).ok).toBe(false);
        expect(await send(worker, { type: "origin-status", origin: "http://localhost:30001" }, sender))
            .toEqual({ ok: true, enabled: false });
        expect(fake.session.size).toBe(0);
    });

    it("rejects keys and status queries for another origin", async () => {
        const fake = fakeApi(["http://localhost/*", "https://other.test/*"]);
        const worker = createWorker(fake.api);
        await send(worker, { type: "enable-origin", origin: ORIGIN }, popup);
        await send(worker, { type: "enable-origin", origin: "https://other.test" }, popup);
        fake.session.set("notebook:https://other.test:w:u:s", emptyNotebook());
        const sender = contentSender(`${ORIGIN}/game`);
        expect((await send(worker, { type: "load-notebook", key: "notebook:https://other.test:w:u:s" }, sender)).ok)
            .toBe(false);
        expect((await send(worker, {
            type: "save-notebook",
            key: "notebook:https://other.test:w:u:s",
            state: emptyNotebook(),
        }, sender)).ok).toBe(false);
        expect((await send(worker, { type: "origin-status", origin: "https://other.test" }, sender)).ok).toBe(false);
    });

    it("rejects unknown request types, foreign senders, and tab-local messages synchronously", () => {
        const worker = createWorker(fakeApi().api);
        const sender = contentSender(`${ORIGIN}/game`);
        for (const [message, from] of [
            [{ type: "steal-everything" }, popup],
            [{ type: "teardown" }, sender],
            [{ type: "toggle-sidebar" }, popup],
            [{ type: "origin-status", origin: ORIGIN }, { ...popup, id: "another-extension" }],
            [undefined, popup],
        ] as const) {
            const response = worker.receive(message, from);
            expect(response).not.toBeInstanceOf(Promise);
            expect((response as ExtensionResponse).ok).toBe(false);
        }
    });

    it("disable removes registrations, session keys, the permission, and the local entry", async () => {
        const fake = fakeApi();
        const worker = createWorker(fake.api);
        await send(worker, { type: "enable-origin", origin: ORIGIN }, popup);
        fake.session.set(KEY, emptyNotebook());
        fake.session.set(`notebook:${ORIGIN}:w2:u:s`, emptyNotebook());
        fake.session.set("notebook:http://localhost:30001:w:u:s", emptyNotebook());
        expect(await send(worker, { type: "disable-origin", origin: ORIGIN }, popup)).toEqual({ ok: true, enabled: false });
        expect(fake.scripts.size).toBe(0);
        expect([...fake.session.keys()]).toEqual(["notebook:http://localhost:30001:w:u:s"]);
        expect(fake.local.get(ENABLED_ORIGINS_KEY)).toEqual([]);
        expect(fake.permissions.has(PATTERN)).toBe(false);
    });

    it("keeps a shared host permission while another port on that host stays enabled", async () => {
        const fake = fakeApi();
        const worker = createWorker(fake.api);
        await send(worker, { type: "enable-origin", origin: ORIGIN }, popup);
        await send(worker, { type: "enable-origin", origin: "http://localhost:30001" }, popup);
        await send(worker, { type: "disable-origin", origin: ORIGIN }, popup);
        expect(fake.permissions.has(PATTERN)).toBe(true);
        expect(fake.local.get(ENABLED_ORIGINS_KEY)).toEqual(["http://localhost:30001"]);
        expect(fake.scripts.get("pf2e-notebook-content")?.matches).toEqual([PATTERN]);
    });

    it("reconciles stored origins with revoked permissions on startup", async () => {
        const fake = fakeApi(["https://kept.test/*"]);
        fake.local.set(ENABLED_ORIGINS_KEY, ["https://kept.test", "https://revoked.test", 42]);
        fake.session.set("notebook:https://revoked.test:w:u:s", emptyNotebook());
        fake.scripts.set("pf2e-notebook-content", { id: "pf2e-notebook-content", matches: ["https://stale.test/*"], js: ["content.js"] });
        const worker = createWorker(fake.api);
        await worker.reconcile();
        expect(fake.local.get(ENABLED_ORIGINS_KEY)).toEqual(["https://kept.test"]);
        expect(fake.session.size).toBe(0);
        expect(fake.scripts.get("pf2e-notebook-content")?.matches).toEqual(["https://kept.test/*"]);
        expect(fake.scripts.get("pf2e-notebook-main")?.matches).toEqual(["https://kept.test/*"]);
    });

    it("unregisters everything when no origins remain authorized", async () => {
        const fake = fakeApi([]);
        fake.local.set(ENABLED_ORIGINS_KEY, ["https://revoked.test"]);
        fake.scripts.set("pf2e-notebook-main", { id: "pf2e-notebook-main", matches: ["https://revoked.test/*"], js: ["main-world.js"] });
        await createWorker(fake.api).reconcile();
        expect(fake.scripts.size).toBe(0);
    });

    it("never rejects when a chrome API fails", async () => {
        const fake = fakeApi();
        fake.api.localGet = async () => {
            throw new Error("storage offline");
        };
        const worker = createWorker(fake.api);
        expect(await send(worker, { type: "origin-status", origin: ORIGIN }, popup))
            .toEqual({ ok: false, error: "storage offline" });
        await expect(worker.reconcile()).rejects.toThrow("storage offline");
        expect(await send(worker, { type: "origin-status", origin: ORIGIN }, popup))
            .toEqual({ ok: false, error: "storage offline" });
    });
});

import { describe, expect, it } from "vitest";
import {
    classifySender,
    exactOrigin,
    keyBelongsToOrigin,
    MAX_KEY_LENGTH,
    originPattern,
    parseExtensionRequest,
    SCRIPT_IDS,
    scriptRegistrations,
    tabOrigin,
} from "../../src/background/origin.js";
import { emptyNotebook } from "../../src/core/reducer.js";

const RUNTIME_ID = "abcdefghijklmnopabcdefghijklmnop";
const EXTENSION_BASE = `chrome-extension://${RUNTIME_ID}/`;

describe("origin registration", () => {
    it("retains an exact HTTP(S) origin for the extension allowlist", () => {
        expect(exactOrigin("https://foundry.example.test/game")).toBe(
            "https://foundry.example.test",
        );
        expect(exactOrigin("http://localhost:30000/game")).toBe("http://localhost:30000");
        expect(() => exactOrigin("file:///tmp/game")).toThrow("HTTP(S)");
    });

    it("uses valid Chrome host patterns and omits unsupported ports", () => {
        expect(originPattern("https://foundry.example.test/game")).toBe(
            "https://foundry.example.test/*",
        );
        expect(originPattern("http://localhost:30000")).toBe("http://localhost/*");
        expect(() => originPattern("file:///tmp/game")).toThrow("HTTP(S)");
    });

    it("registers isolated and MAIN scripts at document start", () => {
        expect(scriptRegistrations(["https://foundry.example.test/*"])).toEqual([
            {
                id: "pf2e-notebook-content",
                matches: ["https://foundry.example.test/*"],
                js: ["content.js"],
                runAt: "document_start",
                world: "ISOLATED",
                persistAcrossSessions: true,
            },
            {
                id: "pf2e-notebook-main",
                matches: ["https://foundry.example.test/*"],
                js: ["main-world.js"],
                runAt: "document_start",
                world: "MAIN",
                persistAcrossSessions: true,
            },
        ]);
    });
});

describe("origin validation", () => {
    it("rejects chrome:// and file:// URLs", () => {
        expect(() => exactOrigin("chrome://extensions/")).toThrow("HTTP(S)");
        expect(() => originPattern("chrome://extensions/")).toThrow("HTTP(S)");
        expect(tabOrigin("chrome://newtab/")).toBeNull();
        expect(tabOrigin("file:///tmp/game.html")).toBeNull();
        expect(tabOrigin(undefined)).toBeNull();
        expect(tabOrigin("not a url")).toBeNull();
        expect(tabOrigin("http://localhost:30000/game")).toBe("http://localhost:30000");
    });

    it("produces deterministic registration ids", () => {
        const first = scriptRegistrations(["https://a.test/*"]).map((script) => script.id);
        const second = scriptRegistrations(["https://b.test/*", "http://c.test/*"]).map((script) => script.id);
        expect(first).toEqual(second);
        expect(first).toEqual([...SCRIPT_IDS]);
    });

    it("scopes notebook keys to the exact sender origin", () => {
        const origin = "http://localhost:30000";
        expect(keyBelongsToOrigin(`notebook:${origin}:w:u:s`, origin)).toBe(true);
        expect(keyBelongsToOrigin("notebook:http://localhost:30001:w:u:s", origin)).toBe(false);
        expect(keyBelongsToOrigin("notebook:https://evil.test:w:u:s", origin)).toBe(false);
        expect(keyBelongsToOrigin(`notebook:${origin}:${"x".repeat(MAX_KEY_LENGTH)}`, origin)).toBe(false);
    });
});

describe("request parsing", () => {
    it("accepts known request shapes", () => {
        expect(parseExtensionRequest({ type: "origin-status", origin: "https://a.test" }))
            .toEqual({ type: "origin-status", origin: "https://a.test" });
        expect(parseExtensionRequest({ type: "load-notebook", key: "notebook:https://a.test:w" }))
            .toEqual({ type: "load-notebook", key: "notebook:https://a.test:w" });
        const state = emptyNotebook();
        expect(parseExtensionRequest({ type: "save-notebook", key: "k", state }))
            .toEqual({ type: "save-notebook", key: "k", state });
    });

    it("rejects unknown types and malformed shapes", () => {
        expect(parseExtensionRequest({ type: "steal-everything" })).toBeNull();
        expect(parseExtensionRequest(null)).toBeNull();
        expect(parseExtensionRequest("origin-status")).toBeNull();
        expect(parseExtensionRequest({ type: "origin-status" })).toBeNull();
        expect(parseExtensionRequest({ type: "origin-status", origin: 4 })).toBeNull();
        expect(parseExtensionRequest({ type: "origin-status", origin: "https://a.test", extra: 1 })).toBeNull();
        expect(parseExtensionRequest({ type: "load-notebook", key: "x".repeat(MAX_KEY_LENGTH + 1) })).toBeNull();
        expect(parseExtensionRequest({ type: "save-notebook", key: "k", state: { bogus: true } })).toBeNull();
        expect(parseExtensionRequest({ type: "teardown" })).toBeNull();
        expect(parseExtensionRequest({ type: "toggle-sidebar" })).toBeNull();
    });
});

describe("sender classification", () => {
    it("recognizes the popup and content scripts of this extension only", () => {
        expect(classifySender({ id: RUNTIME_ID, url: `${EXTENSION_BASE}popup.html` }, RUNTIME_ID, EXTENSION_BASE))
            .toEqual({ kind: "extension" });
        expect(classifySender(
            { id: RUNTIME_ID, url: "http://localhost:30000/game", tab: { id: 1 } as chrome.tabs.Tab },
            RUNTIME_ID,
            EXTENSION_BASE,
        )).toEqual({ kind: "content", origin: "http://localhost:30000" });
        expect(classifySender(
            { id: RUNTIME_ID, origin: "https://a.test", url: "https://a.test/game", tab: { id: 1 } as chrome.tabs.Tab },
            RUNTIME_ID,
            EXTENSION_BASE,
        )).toEqual({ kind: "content", origin: "https://a.test" });
    });

    it("rejects foreign or unusable senders", () => {
        expect(classifySender({ id: "other", url: `${EXTENSION_BASE}popup.html` }, RUNTIME_ID, EXTENSION_BASE))
            .toBeNull();
        expect(classifySender({ url: "https://a.test/" }, RUNTIME_ID, EXTENSION_BASE)).toBeNull();
        expect(classifySender(
            { id: RUNTIME_ID, url: "file:///tmp/x", tab: { id: 1 } as chrome.tabs.Tab },
            RUNTIME_ID,
            EXTENSION_BASE,
        )).toBeNull();
        expect(classifySender({ id: RUNTIME_ID }, RUNTIME_ID, EXTENSION_BASE)).toBeNull();
    });
});

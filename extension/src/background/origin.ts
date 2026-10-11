import { parseNotebookState } from "../core/reducer.js";
import type { ExtensionRequest } from "../shared/extension-messages.js";

export const SCRIPT_IDS = ["pf2e-notebook-content", "pf2e-notebook-main"] as const;
export const MAX_KEY_LENGTH = 2_048;

export type SenderKind = { kind: "extension" } | { kind: "content"; origin: string };

export function exactOrigin(input: string): string {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Foundry origin must use HTTP(S)");
    }
    return url.origin;
}

// Chrome match patterns cannot carry a port, so one pattern covers every port on a host;
// the worker still authorizes requests by exact origin.
export function originPattern(input: string): string {
    const url = new URL(exactOrigin(input));
    return `${url.protocol}//${url.hostname}/*`;
}

export function tabOrigin(url: string | undefined): string | null {
    if (!url) return null;
    try {
        return exactOrigin(url);
    } catch {
        return null;
    }
}

export function scriptRegistrations(
    matches: string[],
): chrome.scripting.RegisteredContentScript[] {
    const shared = {
        matches,
        runAt: "document_start" as const,
        persistAcrossSessions: true,
    };
    return [
        {
            ...shared,
            id: SCRIPT_IDS[0],
            js: ["content.js"],
            world: "ISOLATED",
        },
        {
            ...shared,
            id: SCRIPT_IDS[1],
            js: ["main-world.js"],
            world: "MAIN",
        },
    ];
}

export function keyBelongsToOrigin(key: string, origin: string): boolean {
    return key.length <= MAX_KEY_LENGTH && key.startsWith(`notebook:${origin}:`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isBoundedString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_LENGTH;
}

export function parseExtensionRequest(value: unknown): ExtensionRequest | null {
    if (!isRecord(value)) return null;
    switch (value.type) {
        case "origin-status":
        case "enable-origin":
        case "disable-origin":
            return hasExactKeys(value, ["type", "origin"]) && isBoundedString(value.origin)
                ? { type: value.type, origin: value.origin }
                : null;
        case "load-notebook":
        case "clear-notebook":
            return hasExactKeys(value, ["type", "key"]) && isBoundedString(value.key)
                ? { type: value.type, key: value.key }
                : null;
        case "save-notebook": {
            if (!hasExactKeys(value, ["type", "key", "state"]) || !isBoundedString(value.key)) return null;
            const state = parseNotebookState(value.state);
            return state ? { type: "save-notebook", key: value.key, state } : null;
        }
        default:
            return null;
    }
}

export function classifySender(
    sender: chrome.runtime.MessageSender,
    runtimeId: string,
    extensionBaseUrl: string,
): SenderKind | null {
    if (sender.id !== runtimeId) return null;
    if (!sender.tab) {
        return sender.url?.startsWith(extensionBaseUrl) ? { kind: "extension" } : null;
    }
    if (sender.frameId !== undefined && sender.frameId !== 0) return null;
    const origin = tabOrigin(sender.origin ?? sender.url);
    return origin ? { kind: "content", origin } : null;
}

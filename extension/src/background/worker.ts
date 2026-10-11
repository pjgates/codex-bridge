import {
    classifySender,
    exactOrigin,
    keyBelongsToOrigin,
    originPattern,
    parseExtensionRequest,
    SCRIPT_IDS,
    scriptRegistrations,
} from "./origin.js";
import type { NotebookState } from "../core/types.js";
import {
    ENABLED_ORIGINS_KEY,
    type ExtensionRequest,
    type ExtensionResponse,
} from "../shared/extension-messages.js";

export interface WorkerApi {
    runtimeId: string;
    extensionBaseUrl: string;
    localGet(key: string): Promise<unknown>;
    localSet(key: string, value: unknown): Promise<void>;
    sessionGet(key: string | null): Promise<Record<string, unknown>>;
    sessionSet(items: Record<string, unknown>): Promise<void>;
    sessionRemove(keys: string[]): Promise<void>;
    registeredScriptIds(ids: string[]): Promise<string[]>;
    registerScripts(scripts: chrome.scripting.RegisteredContentScript[]): Promise<void>;
    unregisterScripts(ids: string[]): Promise<void>;
    hasPermission(pattern: string): Promise<boolean>;
    removePermission(pattern: string): Promise<void>;
}

export interface ServiceWorker {
    // Returns synchronously only for rejected requests; never throws or rejects.
    receive(message: unknown, sender: chrome.runtime.MessageSender): ExtensionResponse | Promise<ExtensionResponse>;
    reconcile(): Promise<void>;
}

function failure(error: unknown): ExtensionResponse {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export function createWorker(api: WorkerApi): ServiceWorker {
    let queue: Promise<unknown> = Promise.resolve();

    const serialized = <T>(task: () => Promise<T>): Promise<T> => {
        const run = queue.then(task);
        queue = run.catch(() => undefined);
        return run;
    };

    const enabledOrigins = async (): Promise<string[]> => {
        const value = await api.localGet(ENABLED_ORIGINS_KEY);
        return Array.isArray(value)
            ? value.filter((origin): origin is string => typeof origin === "string").sort()
            : [];
    };

    const setEnabledOrigins = async (origins: string[]): Promise<void> => {
        await api.localSet(ENABLED_ORIGINS_KEY, [...new Set(origins)].sort());
    };

    const refreshScripts = async (origins: string[]): Promise<void> => {
        const existing = await api.registeredScriptIds([...SCRIPT_IDS]);
        if (existing.length > 0) await api.unregisterScripts(existing);
        const matches = [...new Set(origins.map(originPattern))].sort();
        if (matches.length > 0) await api.registerScripts(scriptRegistrations(matches));
    };

    const clearOriginSessions = async (origins: string[]): Promise<void> => {
        if (origins.length === 0) return;
        const prefixes = origins.map((origin) => `notebook:${origin}:`);
        const stored = await api.sessionGet(null);
        const keys = Object.keys(stored).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
        if (keys.length > 0) await api.sessionRemove(keys);
    };

    const enable = async (input: string): Promise<ExtensionResponse> => {
        const origin = exactOrigin(input);
        if (!await api.hasPermission(originPattern(origin))) {
            return { ok: false, error: "Site access was not granted." };
        }
        const origins = [...new Set([...await enabledOrigins(), origin])];
        await setEnabledOrigins(origins);
        await refreshScripts(origins);
        return { ok: true, enabled: true };
    };

    const disable = async (input: string): Promise<ExtensionResponse> => {
        const origin = exactOrigin(input);
        const pattern = originPattern(origin);
        const remaining = (await enabledOrigins()).filter((value) => value !== origin);
        await setEnabledOrigins(remaining);
        await refreshScripts(remaining);
        await clearOriginSessions([origin]);
        if (!remaining.some((value) => originPattern(value) === pattern)) {
            await api.removePermission(pattern);
        }
        return { ok: true, enabled: false };
    };

    const fromExtension = async (request: ExtensionRequest): Promise<ExtensionResponse> => {
        switch (request.type) {
            case "origin-status":
                return { ok: true, enabled: (await enabledOrigins()).includes(exactOrigin(request.origin)) };
            case "enable-origin":
                return enable(request.origin);
            case "disable-origin":
                return disable(request.origin);
            case "load-notebook":
            case "save-notebook":
            case "clear-notebook":
            case "toggle-sidebar":
            case "teardown":
                return { ok: false, error: "Request is not permitted from this sender." };
            default: {
                const exhaustive: never = request;
                return exhaustive;
            }
        }
    };

    const fromContent = async (request: ExtensionRequest, origin: string): Promise<ExtensionResponse> => {
        switch (request.type) {
            case "origin-status":
                if (exactOrigin(request.origin) !== origin) {
                    return { ok: false, error: "Origin does not match sender." };
                }
                return { ok: true, enabled: (await enabledOrigins()).includes(origin) };
            case "load-notebook":
            case "save-notebook":
            case "clear-notebook":
                if (!keyBelongsToOrigin(request.key, origin)) {
                    return { ok: false, error: "Notebook key does not belong to sender origin." };
                }
                if (!(await enabledOrigins()).includes(origin)) {
                    return { ok: false, error: "Origin is not enabled." };
                }
                if (request.type === "load-notebook") {
                    const stored = await api.sessionGet(request.key);
                    return { ok: true, state: (stored[request.key] as NotebookState | undefined) ?? null };
                }
                if (request.type === "save-notebook") {
                    await api.sessionSet({ [request.key]: request.state });
                } else {
                    await api.sessionRemove([request.key]);
                }
                return { ok: true };
            case "enable-origin":
            case "disable-origin":
            case "toggle-sidebar":
            case "teardown":
                return { ok: false, error: "Request is not permitted from this sender." };
            default: {
                const exhaustive: never = request;
                return exhaustive;
            }
        }
    };

    return {
        receive(message, sender) {
            try {
                const source = classifySender(sender, api.runtimeId, api.extensionBaseUrl);
                if (!source) return { ok: false, error: "Sender is not permitted." };
                const request = parseExtensionRequest(message);
                if (!request) return { ok: false, error: "Unsupported request." };
                return serialized(() => (source.kind === "extension"
                    ? fromExtension(request)
                    : fromContent(request, source.origin))).catch(failure);
            } catch (error) {
                return failure(error);
            }
        },
        reconcile() {
            return serialized(async () => {
                const stored = await enabledOrigins();
                const kept: string[] = [];
                const dropped: string[] = [];
                for (const origin of stored) {
                    let pattern: string;
                    try {
                        pattern = originPattern(origin);
                    } catch {
                        dropped.push(origin);
                        continue;
                    }
                    (await api.hasPermission(pattern) ? kept : dropped).push(origin);
                }
                await setEnabledOrigins(kept);
                await refreshScripts(kept);
                await clearOriginSessions(dropped);
            });
        },
    };
}

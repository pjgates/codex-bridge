import { listenForObservations, sendPageCommand } from "./bridge.js";
import { createNotebookController, type NotebookController } from "./controller.js";
import { observeRenderedChecks } from "./dom-fallback.js";
import { HOST_ID, mountSidebar, type Sidebar } from "./sidebar.js";
import { loadNotebook, requestOriginStatus, saveNotebook, type RuntimeMessenger } from "./worker-client.js";
import type { NotebookState } from "../core/types.js";
import { ENABLED_ORIGINS_KEY } from "../shared/extension-messages.js";
import { PROTOCOL_VERSION, type Observation } from "../shared/protocol.js";

export const HANDSHAKE_TIMEOUT_MS = 35_000;

const ADAPTER_TIMEOUT_REASON = "Foundry adapter did not respond; reading rendered chat cards only.";
const UNKNOWN = "unknown";

interface ChromeEvent<TListener> {
    addListener(listener: TListener): void;
    removeListener(listener: TListener): void;
}

type TabMessageListener = (message: unknown, sender: chrome.runtime.MessageSender) => void;
type StorageChangeListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;

export interface ContentChrome {
    runtime: RuntimeMessenger & {
        readonly id: string;
        onMessage: ChromeEvent<TabMessageListener>;
    };
    storage: {
        onChanged: ChromeEvent<StorageChangeListener>;
    };
}

export interface ContentDependencies {
    chrome: ContentChrome;
    window: Window;
    document: Document;
    origin: string;
}

export interface ContentHandle {
    controller: NotebookController;
    teardown(): Promise<void>;
}

interface TabLifecycleOptions {
    chrome: ContentChrome;
    window: Window;
    origin: string;
    controller: NotebookController;
    sidebar(): Sidebar;
    stopBridge(): void;
    stopFallback(): (() => void) | null;
    cancelHandshakeTimer(): void;
    deactivate(): void;
}

type TabCommand = "toggle-sidebar" | "teardown";

function parseTabCommand(message: unknown): TabCommand | null {
    if (typeof message !== "object" || message === null || Array.isArray(message)) return null;
    const record = message as Record<string, unknown>;
    if (Object.keys(record).length !== 1) return null;
    return record.type === "toggle-sidebar" || record.type === "teardown" ? record.type : null;
}

function adapterTimeoutHandshake(): Observation {
    const timestamp = Date.now();
    return {
        protocol: PROTOCOL_VERSION,
        eventId: `handshake:content-fallback:${timestamp}`,
        timestamp,
        type: "handshake",
        payload: {
            status: "fallback",
            foundry: UNKNOWN,
            system: UNKNOWN,
            systemVersion: UNKNOWN,
            worldId: UNKNOWN,
            userId: UNKNOWN,
            reason: ADAPTER_TIMEOUT_REASON,
        },
    };
}

export function registerTabLifecycle(options: TabLifecycleOptions): () => Promise<void> {
    const { chrome: api, window: target, origin } = options;
    let finished: Promise<void> | null = null;

    const teardown = (): Promise<void> => {
        if (finished) return finished;
        options.deactivate();
        options.cancelHandshakeTimer();
        api.runtime.onMessage.removeListener(onMessage);
        api.storage.onChanged.removeListener(onStorageChanged);
        target.removeEventListener("pagehide", onPageHide);
        options.stopBridge();
        options.stopFallback()?.();
        sendPageCommand({ protocol: PROTOCOL_VERSION, type: "teardown", payload: {} });
        options.sidebar().destroy();
        finished = options.controller.flush();
        return finished;
    };

    const onMessage: TabMessageListener = (message, sender) => {
        if (sender.id !== api.runtime.id) return;
        const command = parseTabCommand(message);
        switch (command) {
            case null:
                return;
            case "toggle-sidebar":
                options.sidebar().toggle();
                return;
            case "teardown":
                void teardown();
                return;
            default: {
                const exhaustive: never = command;
                return exhaustive;
            }
        }
    };

    const onStorageChanged: StorageChangeListener = (changes, areaName) => {
        if (areaName !== "local" || !Object.hasOwn(changes, ENABLED_ORIGINS_KEY)) return;
        const enabled: unknown = changes[ENABLED_ORIGINS_KEY]?.newValue;
        if (!Array.isArray(enabled) || !enabled.includes(origin)) void teardown();
    };

    const onPageHide = (): void => {
        void teardown();
    };

    api.runtime.onMessage.addListener(onMessage);
    api.storage.onChanged.addListener(onStorageChanged);
    target.addEventListener("pagehide", onPageHide);
    return teardown;
}

export async function bootContentScript(dependencies: ContentDependencies): Promise<ContentHandle | null> {
    const { chrome: api, document, origin } = dependencies;
    try {
        if (!await requestOriginStatus(api.runtime, origin)) return null;
    } catch {
        return null;
    }

    let active = true;
    let clearEncounter = (): void => undefined;
    const onClear = (): void => clearEncounter();
    let sidebar = mountSidebar(document, onClear);
    const renderSidebar = (state: NotebookState): void => {
        if (!active) return;
        if (!document.getElementById(HOST_ID)) sidebar = mountSidebar(document, onClear);
        sidebar.render(state);
    };

    const controller = await createNotebookController({
        origin,
        load: (key) => loadNotebook(api.runtime, key),
        save: (key, state) => saveNotebook(api.runtime, key, state),
        renderSidebar,
        sendCommand: (command) => {
            if (active) sendPageCommand(command);
        },
    });
    clearEncounter = () => void controller.clear();

    let stopFallback: (() => void) | null = null;
    const syncFallback = (): void => {
        if (!active) return;
        const wanted = controller.state().compatibility === "fallback";
        if (wanted && stopFallback === null) {
            stopFallback = observeRenderedChecks(
                document.body ?? document.documentElement,
                (observation) => void controller.accept(observation),
            );
        } else if (!wanted && stopFallback !== null) {
            stopFallback();
            stopFallback = null;
        }
    };

    let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelHandshakeTimer = (): void => {
        if (handshakeTimer !== null) clearTimeout(handshakeTimer);
        handshakeTimer = null;
    };
    const acceptHandshake = (observation: Observation): void => {
        cancelHandshakeTimer();
        void controller.accept(observation).then(syncFallback);
    };

    const stopBridge = listenForObservations((observation) => {
        if (!active) return;
        if (observation.type === "handshake") acceptHandshake(observation);
        else void controller.accept(observation);
    });
    handshakeTimer = setTimeout(() => {
        handshakeTimer = null;
        acceptHandshake(adapterTimeoutHandshake());
    }, HANDSHAKE_TIMEOUT_MS);
    sendPageCommand({ protocol: PROTOCOL_VERSION, type: "activate", payload: {} });

    const teardown = registerTabLifecycle({
        chrome: api,
        window: dependencies.window,
        origin,
        controller,
        sidebar: () => sidebar,
        stopBridge,
        stopFallback: () => stopFallback,
        cancelHandshakeTimer,
        deactivate: () => {
            active = false;
        },
    });
    return { controller, teardown };
}

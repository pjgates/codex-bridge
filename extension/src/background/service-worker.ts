import { createWorker } from "./worker.js";
import type { ExtensionResponse } from "../shared/extension-messages.js";

const worker = createWorker({
    runtimeId: chrome.runtime.id,
    extensionBaseUrl: chrome.runtime.getURL(""),
    localGet: async (key) => (await chrome.storage.local.get(key))[key],
    localSet: (key, value) => chrome.storage.local.set({ [key]: value }),
    sessionGet: (key) => chrome.storage.session.get(key),
    sessionSet: (items) => chrome.storage.session.set(items),
    sessionRemove: (keys) => chrome.storage.session.remove(keys),
    registeredScriptIds: async (ids) =>
        (await chrome.scripting.getRegisteredContentScripts({ ids })).map((script) => script.id),
    registerScripts: (scripts) => chrome.scripting.registerContentScripts(scripts),
    unregisterScripts: (ids) => chrome.scripting.unregisterContentScripts({ ids }),
    hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }),
    removePermission: async (pattern) => {
        await chrome.permissions.remove({ origins: [pattern] });
    },
});

function reconcile(): void {
    worker.reconcile().catch((error: unknown) => {
        console.warn("PF2e Combat Notebook could not reconcile site access.", error);
    });
}

chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);
chrome.permissions.onRemoved.addListener(reconcile);
chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse: (response: ExtensionResponse) => void) => {
        const response = worker.receive(message, sender);
        if (!(response instanceof Promise)) {
            sendResponse(response);
            return false;
        }
        void response.then(sendResponse);
        return true;
    },
);

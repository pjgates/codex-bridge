import { bootContentScript } from "./lifecycle.js";

void bootContentScript({
    chrome: {
        runtime: {
            get id() {
                return chrome.runtime.id;
            },
            get lastError() {
                return chrome.runtime.lastError;
            },
            sendMessage: (message, callback) => chrome.runtime.sendMessage(message, callback),
            onMessage: chrome.runtime.onMessage,
        },
        storage: { onChanged: chrome.storage.onChanged },
    },
    window,
    document,
    origin: window.location.origin,
}).catch(() => undefined);

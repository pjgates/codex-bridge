import { originPattern, tabOrigin } from "../background/origin.js";
import type { ExtensionRequest, ExtensionResponse } from "../shared/extension-messages.js";

function element<T extends HTMLElement>(selector: string, type: new () => T): T {
    const found = document.querySelector(selector);
    if (!(found instanceof type)) throw new Error(`Popup element ${selector} is missing.`);
    return found;
}

function isResponse(value: unknown): value is ExtensionResponse {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return record.ok === true || (record.ok === false && typeof record.error === "string");
}

async function send(request: ExtensionRequest): Promise<ExtensionResponse> {
    try {
        const response: unknown = await chrome.runtime.sendMessage(request);
        return isResponse(response) ? response : { ok: false, error: "The extension did not respond." };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

async function main(): Promise<void> {
    const statusElement = element("#status", HTMLParagraphElement);
    const enableButton = element("#enable", HTMLButtonElement);
    const disableButton = element("#disable", HTMLButtonElement);
    const openButton = element("#open", HTMLButtonElement);
    const buttons = [enableButton, disableButton, openButton];

    const show = (visible: HTMLButtonElement[]): void => {
        for (const button of buttons) {
            button.hidden = !visible.includes(button);
            button.disabled = false;
        }
    };
    const busy = (): void => {
        for (const button of buttons) button.disabled = true;
    };

    show([]);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const origin = tabOrigin(tab?.url);
    if (!tab || !origin) {
        statusElement.textContent = "This page is not an HTTP(S) site, so the notebook is unavailable.";
        return;
    }

    const render = (enabled: boolean): void => {
        statusElement.textContent = `${origin} — ${enabled ? "enabled" : "disabled"}`;
        show(enabled ? [disableButton, openButton] : [enableButton]);
    };

    const status = await send({ type: "origin-status", origin });
    if (!status.ok) {
        statusElement.textContent = status.error;
        return;
    }
    render(status.enabled === true);

    enableButton.addEventListener("click", async () => {
        busy();
        let granted = false;
        try {
            granted = await chrome.permissions.request({ origins: [originPattern(origin)] });
        } catch {
            granted = false;
        }
        if (!granted) {
            render(false);
            statusElement.textContent = "Site access was not granted.";
            return;
        }
        const response = await send({ type: "enable-origin", origin });
        if (!response.ok) {
            render(false);
            statusElement.textContent = response.error;
            return;
        }
        if (tab.id !== undefined) await chrome.tabs.reload(tab.id).catch(() => undefined);
        window.close();
    });

    disableButton.addEventListener("click", async () => {
        busy();
        if (tab.id !== undefined) {
            await chrome.tabs.sendMessage(tab.id, { type: "teardown" }).catch(() => undefined);
        }
        const response = await send({ type: "disable-origin", origin });
        if (!response.ok) {
            render(true);
            statusElement.textContent = response.error;
            return;
        }
        window.close();
    });

    openButton.addEventListener("click", async () => {
        if (tab.id === undefined) return;
        busy();
        try {
            await chrome.tabs.sendMessage(tab.id, { type: "toggle-sidebar" });
            window.close();
        } catch {
            render(true);
            statusElement.textContent = "The notebook is not running on this page yet. Reload the tab and try again.";
        }
    });
}

void main().catch((error: unknown) => {
    const statusElement = document.querySelector("#status");
    if (statusElement) {
        statusElement.textContent = error instanceof Error ? error.message : String(error);
    }
});

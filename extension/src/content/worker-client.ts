import type { NotebookState } from "../core/types.js";
import type { ExtensionRequest } from "../shared/extension-messages.js";

export const WORKER_TIMEOUT_MS = 5_000;

export interface RuntimeMessenger {
    sendMessage(message: unknown, callback: (response: unknown) => void): void;
    readonly lastError?: { message?: string } | undefined;
}

type SuccessRecord = Record<string, unknown> & { ok: true };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function callWorker(runtime: RuntimeMessenger, request: ExtensionRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            settled = true;
            reject(new Error(`Extension worker timed out on ${request.type}.`));
        }, WORKER_TIMEOUT_MS);
        const settle = (action: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            action();
        };
        try {
            runtime.sendMessage(request, (response) => {
                const error = runtime.lastError;
                settle(() => (error ? reject(new Error(error.message ?? "Extension worker failed.")) : resolve(response)));
            });
        } catch (error) {
            settle(() => reject(error instanceof Error ? error : new Error(String(error))));
        }
    });
}

async function succeeded(runtime: RuntimeMessenger, request: ExtensionRequest): Promise<SuccessRecord> {
    const response = await callWorker(runtime, request);
    if (!isRecord(response) || typeof response.ok !== "boolean") {
        throw new Error(`Malformed worker response to ${request.type}.`);
    }
    if (!response.ok) {
        throw new Error(typeof response.error === "string" ? response.error : `Worker rejected ${request.type}.`);
    }
    return response as SuccessRecord;
}

export async function requestOriginStatus(runtime: RuntimeMessenger, origin: string): Promise<boolean> {
    const response = await succeeded(runtime, { type: "origin-status", origin });
    if (typeof response.enabled !== "boolean") throw new Error("Malformed origin-status response.");
    return response.enabled;
}

export async function loadNotebook(runtime: RuntimeMessenger, key: string): Promise<unknown> {
    const response = await succeeded(runtime, { type: "load-notebook", key });
    if (!Object.hasOwn(response, "state") || (response.state !== null && !isRecord(response.state))) {
        throw new Error("Malformed load-notebook response.");
    }
    return response.state;
}

export async function saveNotebook(runtime: RuntimeMessenger, key: string, state: NotebookState): Promise<void> {
    await succeeded(runtime, { type: "save-notebook", key, state });
}

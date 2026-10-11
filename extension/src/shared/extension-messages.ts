import type { NotebookState } from "../core/types.js";

export const ENABLED_ORIGINS_KEY = "enabledFoundryOrigins";

export type ExtensionRequest =
    | { type: "origin-status"; origin: string }
    | { type: "enable-origin"; origin: string }
    | { type: "disable-origin"; origin: string }
    | { type: "load-notebook"; key: string }
    | { type: "save-notebook"; key: string; state: NotebookState }
    | { type: "clear-notebook"; key: string }
    | { type: "toggle-sidebar" }
    | { type: "teardown" };

export type ExtensionResponse =
    | { ok: true; enabled?: boolean; state?: NotebookState | null }
    | { ok: false; error: string };

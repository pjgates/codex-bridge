/**
 * SF2e Forge Custom Rules
 * Main entry point for the Foundry VTT module.
 *
 * This module adds custom rules and homebrew modifications
 * to the Starfinder Second Edition system.
 */

import { onInit } from "./hooks/init.js";
import { onReady } from "./hooks/ready.js";
import { installRuntimeApi } from "./api.js";

// Import styles so Vite bundles them into dist/module.css
import "../styles/module.scss";

import { MODULE_ID } from "./constants.js";

// ─── Initialization ──────────────────────────────────────────────────────────

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | Initializing SF2e Forge Custom Rules`);
    installRuntimeApi();
    onInit();
});

Hooks.once("ready", () => {
    console.log(`${MODULE_ID} | SF2e Forge Custom Rules ready`);
    onReady();
});

export { MODULE_ID };

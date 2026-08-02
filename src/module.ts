/**
 * Codex Foundry
 * Main entry point for the Foundry VTT module.
 *
 * Codex bridge for Foundry VTT: vault content sync plus
 * ruleset houserules (currently Starfinder Second Edition).
 */

import { onInit } from "./hooks/init.js";
import { onReady } from "./hooks/ready.js";
import { installRuntimeApi } from "./api.js";

// Import styles so Vite bundles them into dist/module.css
import "../styles/module.scss";

import { MODULE_ID } from "./constants.js";

// ─── Initialization ──────────────────────────────────────────────────────────

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | Initializing Codex Foundry`);
    installRuntimeApi();
    onInit();
});

Hooks.once("ready", () => {
    console.log(`${MODULE_ID} | Codex Foundry ready`);
    onReady();
});

export { MODULE_ID };

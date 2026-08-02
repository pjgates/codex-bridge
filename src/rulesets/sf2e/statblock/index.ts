/**
 * Statblock core — browser-safe parsing, enrichment, and actor building
 * shared by codex-sync vault parsing and the
 * runtime statblock importer feature.
 *
 * Nothing in this feature may import Node builtins or Node-only packages;
 * DOM access goes through sanitize.ts's injectable document.
 */
export type * from "./types.js";
export { normaliseStatblock, parseSensesString, parseSpeedString, parseAttackName, parseAttackDesc, parseDamageString } from "./parse.js";
export type { ParseOptions } from "./parse.js";
export { extractStatblocks } from "./extract.js";
export type { ExtractedCreature, ExtractedStatblocks } from "./extract.js";
export { buildActorDocument, parseActionFromName, parseIWRString } from "./actor.js";
export type { BuildActorOptions } from "./actor.js";
export { enrichDescription, enrichChecks, enrichDamage, enrichTemplates, enrichConditions } from "./enrich.js";
export { markdownToHtml } from "./markdown.js";
export { sanitizeFoundryHtml, sanitizeFoundryEnricherLabels, sanitizeHtml, setSanitizerDocument } from "./sanitize.js";
export type { SanitizerDocument } from "./sanitize.js";
export { SF2E_ACTION_TRAITS, SF2E_CREATURE_TRAITS, SF2E_NPC_ATTACK_TRAITS } from "./traits.js";

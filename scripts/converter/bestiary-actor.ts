/**
 * Node-side wrapper: shared actor builder configured for pack compilation —
 * deterministic ids (stable across converter re-runs) and happy-dom sanitizing.
 */
import "./dom.js";
import { generateId } from "./ids.js";
import { buildActorDocument as buildActorDocumentCore } from "../../src/statblock/actor.js";
import type { ParsedCreature } from "../../src/statblock/types.js";

/**
 * Build a Foundry VTT NPC actor document from a parsed creature with
 * deterministic `_id`/`_key` fields for pack storage.
 */
export function buildActorDocument(creature: ParsedCreature): Record<string, unknown> {
    return buildActorDocumentCore(creature, { makeId: generateId });
}

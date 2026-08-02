/**
 * Injects a happy-dom document into the shared statblock sanitizer for
 * Node-side converter use. Import this module (for its side effect) before
 * any code path that sanitizes HTML.
 */
import { Window } from "happy-dom";
import { setSanitizerDocument, type SanitizerDocument } from "../../src/rulesets/sf2e/statblock/sanitize.js";

setSanitizerDocument(new Window().document as unknown as SanitizerDocument);

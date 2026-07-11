/**
 * Minimal document surface the sanitizer needs. Satisfied by both the real
 * browser `document` (Foundry runtime) and happy-dom's (Node converter).
 */
export interface SanitizerDocument {
    createElement(tagName: string): {
        innerHTML: string;
        textContent: string | null;
        value?: string;
        childNodes: ArrayLike<unknown>;
    };
}

let injectedDocument: SanitizerDocument | undefined;

/** Inject a DOM document for non-browser environments (the Node converter). */
export function setSanitizerDocument(doc: SanitizerDocument): void {
    injectedDocument = doc;
}

function doc(): SanitizerDocument {
    const resolved = injectedDocument ?? (globalThis as { document?: SanitizerDocument }).document;
    if (!resolved) throw new Error("sanitize: no DOM document available; call setSanitizerDocument() first");
    return resolved;
}

const ALLOWED_ELEMENTS = new Set([
    "a", "abbr", "b", "blockquote", "br", "code", "del", "details", "div", "em", "h1", "h2",
    "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s", "span", "strong",
    "sub", "summary", "sup", "table", "tbody", "td", "th", "thead", "tr", "ul",
]);
const DROP_CONTENT_ELEMENTS = new Set([
    "audio", "base", "button", "embed", "form", "iframe", "input", "link", "math", "meta", "object",
    "option", "script", "select", "source", "style", "svg", "template", "textarea", "video",
]);
const DROP_BLOCK_CONTENT_ELEMENTS = new Set([
    "audio", "button", "form", "iframe", "math", "object", "script", "select", "style", "svg", "template", "textarea", "video",
]);
const GLOBAL_ATTRIBUTES = new Set(["class", "title"]);
const ELEMENT_ATTRIBUTES = new Map<string, ReadonlySet<string>>([
    ["a", new Set(["href", "rel", "target"])],
    ["img", new Set(["alt", "height", "src", "width"])],
    ["ol", new Set(["start"])],
    ["td", new Set(["colspan", "rowspan"])],
    ["th", new Set(["colspan", "rowspan", "scope"])],
]);
const URL_ATTRIBUTES = new Set(["href", "src"]);
const SAFE_TARGETS = new Set(["_blank", "_self"]);
const SAFE_REL_TOKENS = new Set(["noopener", "noreferrer"]);

/** Apply the converter's HTML boundary before scrubbing Foundry innerHTML labels. */
export function sanitizeFoundryHtml(value: string): string {
    return sanitizeFoundryEnricherLabels(sanitizeHtml(value));
}

/**
 * Foundry and PF2e may also derive fallback labels from parameter text, so
 * scrub both parameters and explicit labels to plain text. Direct callers
 * must first pass ordinary HTML through sanitizeHtml so encoded syntax
 * delimiters are literal before this scanner runs. sanitizeFoundryHtml
 * guarantees that ordering for converter output sinks. The scanner
 * precomputes balanced and first-closing bracket ends plus the next closing
 * brace in linear passes, so flavored rolls and malformed input cannot cause
 * rescans.
 */
export function sanitizeFoundryEnricherLabels(value: string): string {
    const balancedClosingBrackets = findBalancedClosingBrackets(value);
    const nextClosingBracket = findNextClosingBrackets(value);
    const nextClosingBrace = findNextClosingBraces(value);
    const segments: string[] = [];
    let untouchedStart = 0;
    let cursor = 0;
    while (cursor < value.length) {
        const match = findFoundryEnricherMatch(value, cursor, balancedClosingBrackets, nextClosingBracket);
        if (match == null) {
            cursor += 1;
            continue;
        }

        const parameters = value.slice(match.parametersStart, match.parametersEnd);
        const scrubbedParameters = scrubFoundryEnricherParameter(parameters);
        if (scrubbedParameters !== parameters) {
            segments.push(value.slice(untouchedStart, match.parametersStart), scrubbedParameters);
            untouchedStart = match.parametersEnd;
        }

        cursor = match.prefixEnd;
        if (value[match.prefixEnd] !== "{") continue;
        const labelEnd = nextClosingBrace[match.prefixEnd + 1];
        if (labelEnd === -1) continue;

        const label = value.slice(match.prefixEnd + 1, labelEnd);
        const scrubbedLabel = scrubFoundryEnricherLabel(label);
        if (scrubbedLabel !== label) {
            segments.push(value.slice(untouchedStart, match.prefixEnd + 1), scrubbedLabel);
            untouchedStart = labelEnd;
        }
        cursor = labelEnd + 1;
    }
    return segments.length === 0 ? value : segments.join("") + value.slice(untouchedStart);
}

function findBalancedClosingBrackets(value: string): Int32Array {
    const result = new Int32Array(value.length).fill(-1);
    const stack: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] === "[") stack.push(index);
        else if (value[index] === "]") {
            const open = stack.pop();
            if (open != null) result[open] = index;
        }
    }
    return result;
}

function findNextClosingBrackets(value: string): Int32Array {
    const result = new Int32Array(value.length + 1).fill(-1);
    let next = -1;
    for (let index = value.length - 1; index >= 0; index -= 1) {
        if (value[index] === "]") next = index;
        result[index] = next;
    }
    return result;
}

function findNextClosingBraces(value: string): Int32Array {
    const result = new Int32Array(value.length + 1).fill(-1);
    let next = -1;
    for (let index = value.length - 1; index >= 0; index -= 1) {
        if (value[index] === "}") next = index;
        result[index] = next;
    }
    return result;
}

interface FoundryEnricherMatch {
    parametersStart: number;
    parametersEnd: number;
    prefixEnd: number;
}

function findFoundryEnricherMatch(
    value: string,
    start: number,
    balancedClosingBrackets: Int32Array,
    nextClosingBracket: Int32Array,
): FoundryEnricherMatch | undefined {
    if (value[start] === "@") {
        let cursor = start + 1;
        while (isAsciiLetter(value[cursor])) cursor += 1;
        if (cursor === start + 1 || value[cursor] !== "[") return undefined;

        // PF2e's Damage grammar permits nested brackets. Its Check, Localize,
        // and Template grammar, like Foundry content links, ends at the first ].
        const closingBracket = matchesWord(value, start + 1, cursor, "Damage")
            ? balancedClosingBrackets[cursor]
            : nextClosingBracket[cursor + 1];
        return closingBracket === -1
            ? undefined
            : { parametersStart: cursor + 1, parametersEnd: closingBracket, prefixEnd: closingBracket + 1 };
    }
    if (value[start] === "[" && value[start + 1] === "[") {
        // PF2e's /act custom enricher ends at the first ]], while Foundry inline
        // rolls permit nested bracketed roll syntax such as damage flavors.
        if (matchesActPrefix(value, start)) {
            const firstClosingBracket = nextClosingBracket[start + 2];
            return firstClosingBracket !== -1 && value[firstClosingBracket + 1] === "]"
                ? { parametersStart: start + 2, parametersEnd: firstClosingBracket, prefixEnd: firstClosingBracket + 2 }
                : undefined;
        }

        const closingBracket = balancedClosingBrackets[start];
        if (closingBracket !== -1 && balancedClosingBrackets[start + 1] === closingBracket - 1) {
            return { parametersStart: start + 2, parametersEnd: closingBracket - 1, prefixEnd: closingBracket + 1 };
        }
    }
    return undefined;
}

function matchesWord(value: string, start: number, end: number, word: string): boolean {
    if (end - start !== word.length) return false;
    for (let index = 0; index < word.length; index += 1) {
        if (value[start + index] !== word[index]) return false;
    }
    return true;
}

function matchesActPrefix(value: string, start: number): boolean {
    return value.startsWith("[[/act", start) && isWhitespace(value[start + 6]);
}

function isWhitespace(value: string | undefined): boolean {
    return value != null && /\s/.test(value);
}

function isAsciiLetter(value: string | undefined): boolean {
    if (value == null) return false;
    const code = value.charCodeAt(0);
    return code >= 65 && code <= 90 || code >= 97 && code <= 122;
}

function scrubFoundryEnricherParameter(parameters: string): string {
    if (!parameters.includes("&") && !parameters.includes("<")) return parameters;
    const container = doc().createElement("div");
    container.innerHTML = decodeHtmlEntities(parameters);
    return escapeHtmlParameter(container.textContent ?? "");
}

function scrubFoundryEnricherLabel(label: string): string {
    if (!label.includes("&") && !label.includes("<")) return label;
    const container = doc().createElement("div");
    container.innerHTML = decodeHtmlEntities(label);
    return escapeHtml(container.textContent ?? "");
}

function decodeHtmlEntities(value: string): string {
    let decoded = value;
    for (let iteration = 0; iteration < 16; iteration += 1) {
        const textarea = doc().createElement("textarea");
        textarea.innerHTML = decoded;
        const next = textarea.value ?? "";
        if (next === decoded) return decoded;
        decoded = next;
    }
    throw new Error("Foundry enricher text exceeds the bounded HTML entity decoding depth");
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[character]!);
}

function escapeHtmlParameter(value: string): string {
    return value.replace(/[&<>]/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
    })[character]!);
}


/**
 * Remove content-bearing active elements before DOM parsing. happy-dom treats
 * some SVG/script sequences as consuming later siblings, so the DOM walk alone
 * cannot reliably preserve safe content that follows them. This tokenizer is
 * linear: unlike a repeated suffix-search regex it never rescans the input.
 */
function stripDangerousBlocks(html: string): string {
    const token = /<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g;
    const ranges: Array<[number, number]> = [];
    const stack: string[] = [];
    let outerStart = -1;
    let match: RegExpExecArray | null;
    while ((match = token.exec(html)) !== null) {
        const name = match[2].toLowerCase();
        if (stack.length === 0) {
            if (!match[1] && DROP_BLOCK_CONTENT_ELEMENTS.has(name)) {
                outerStart = match.index;
                stack.push(name);
            }
            continue;
        }
        if (!match[1] && DROP_BLOCK_CONTENT_ELEMENTS.has(name)) stack.push(name);
        else if (match[1] && stack.at(-1) === name) {
            stack.pop();
            if (stack.length === 0) {
                ranges.push([outerStart, token.lastIndex]);
                outerStart = -1;
            }
        }
    }
    if (stack.length > 0) ranges.push([outerStart, html.length]);
    if (ranges.length === 0) return html;

    let stripped = "";
    let start = 0;
    for (const [from, to] of ranges) {
        stripped += html.slice(start, from);
        start = to;
    }
    return stripped + html.slice(start);
}

/** Sanitize converter-produced HTML while preserving the reviewed authoring subset. */
export function sanitizeHtml(html: string): string {
    const container = doc().createElement("div");
    container.innerHTML = stripDangerousBlocks(html);
    sanitizeChildren(container);
    return container.innerHTML;
}

function sanitizeChildren(parent: { childNodes: ArrayLike<unknown> }): void {
    for (const child of Array.from(parent.childNodes)) {
        if (!isElement(child)) {
            if (isComment(child)) child.remove();
            continue;
        }

        const name = child.localName;
        if (DROP_CONTENT_ELEMENTS.has(name)) {
            child.remove();
            continue;
        }
        if (!ALLOWED_ELEMENTS.has(name)) {
            sanitizeChildren(child);
            child.replaceWith(...Array.from(child.childNodes));
            continue;
        }

        sanitizeAttributes(child);
        sanitizeChildren(child);
    }
}

function sanitizeAttributes(element: {
    attributes: ArrayLike<{ name: string; value: string }>;
    localName: string;
    removeAttribute(name: string): void;
    setAttribute(name: string, value: string): void;
}): void {
    const allowed = ELEMENT_ATTRIBUTES.get(element.localName);
    for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        if (!GLOBAL_ATTRIBUTES.has(name) && !allowed?.has(name)) {
            element.removeAttribute(attribute.name);
            continue;
        }
        if (URL_ATTRIBUTES.has(name) && !isSafeUrl(attribute.value)) {
            element.removeAttribute(attribute.name);
            continue;
        }
        if (name === "target" && !SAFE_TARGETS.has(attribute.value.toLowerCase())) {
            element.removeAttribute(attribute.name);
            continue;
        }
        if (name === "rel") {
            const rel = attribute.value.toLowerCase().split(/\s+/).filter((token) => SAFE_REL_TOKENS.has(token));
            if (rel.length === 0) element.removeAttribute(attribute.name);
            else element.setAttribute("rel", [...new Set(rel)].join(" "));
        }
    }

    if (element.localName === "a" && getAttribute(element, "target")?.toLowerCase() === "_blank") {
        const rel = getAttribute(element, "rel")?.split(/\s+/).filter(Boolean) ?? [];
        element.setAttribute("rel", [...new Set([...rel, "noopener", "noreferrer"])].join(" "));
    }
}

function isSafeUrl(raw: string): boolean {
    const value = raw.trim();
    if (!value || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return false;
    if (value.startsWith("#") || value.startsWith("/") && !value.startsWith("//")) return true;
    if (/^[./]?[^:/?#][^:]*$/.test(value)) return true;
    return /^(?:https?:|mailto:)/i.test(value);
}

function isElement(value: unknown): value is {
    attributes: ArrayLike<{ name: string; value: string }>;
    childNodes: ArrayLike<unknown>;
    localName: string;
    remove(): void;
    removeAttribute(name: string): void;
    replaceWith(...nodes: unknown[]): void;
    setAttribute(name: string, value: string): void;
} {
    return typeof value === "object" && value !== null && "localName" in value && typeof value.localName === "string";
}

function isComment(value: unknown): value is { nodeType: number; remove(): void } {
    return typeof value === "object" && value !== null && "nodeType" in value && value.nodeType === 8 && "remove" in value;
}

function getAttribute(element: { attributes: ArrayLike<{ name: string; value: string }> }, name: string): string | undefined {
    return Array.from(element.attributes).find((attribute) => attribute.name.toLowerCase() === name)?.value;
}

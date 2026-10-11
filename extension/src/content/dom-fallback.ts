import {
    parseObservation,
    PROTOCOL_VERSION,
    type Degree,
    type Observation,
} from "../shared/protocol.js";

const CHAT_MESSAGE_SELECTOR = ".chat-message[data-message-id]";
const MAX_SEEN_MESSAGES = 2_000;
const INTEGER_TEXT = /^[-+]?\d+$/;

const DEGREE_CLASSES: ReadonlyArray<[string, Degree]> = [
    ["critical-success", "criticalSuccess"],
    ["critical-failure", "criticalFailure"],
    ["success", "success"],
    ["failure", "failure"],
];

function parseTotal(text: string | undefined): number | null {
    if (text === undefined || !INTEGER_TEXT.test(text)) return null;
    const total = Number(text);
    return Number.isSafeInteger(total) ? total : null;
}

export function parseRenderedCheck(element: Element): Observation | null {
    if (!(element instanceof HTMLElement)) return null;
    const messageId = element.dataset.messageId;
    const total = parseTotal(element.querySelector(".dice-total")?.textContent?.trim());
    const degreeElement = element.querySelector(".degree-of-success");
    const outcome = DEGREE_CLASSES.find(([className]) =>
        degreeElement?.classList.contains(className),
    )?.[1] ?? null;
    if (!messageId || total === null || outcome === null) return null;
    return parseObservation({
        protocol: PROTOCOL_VERSION,
        eventId: `dom:${messageId}`,
        timestamp: Date.now(),
        type: "unassigned-check",
        payload: { messageId, total, outcome },
    });
}

export function observeRenderedChecks(
    root: Element,
    emit: (observation: Observation) => void,
): () => void {
    const seen = new Set<string>();
    const scan = (element: Element): void => {
        const observation = parseRenderedCheck(element);
        if (!observation || seen.has(observation.eventId)) return;
        seen.add(observation.eventId);
        if (seen.size > MAX_SEEN_MESSAGES) {
            const oldest = seen.values().next();
            if (!oldest.done) seen.delete(oldest.value);
        }
        emit(observation);
    };
    root.querySelectorAll(CHAT_MESSAGE_SELECTOR).forEach(scan);
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node.matches(CHAT_MESSAGE_SELECTOR)) scan(node);
                node.querySelectorAll(CHAT_MESSAGE_SELECTOR).forEach(scan);
            }
        }
    });
    observer.observe(root, { childList: true, subtree: true });
    let connected = true;
    return () => {
        if (!connected) return;
        connected = false;
        observer.disconnect();
    };
}

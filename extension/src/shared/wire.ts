import type { Observation, PageCommand } from "./protocol.js";

export const MAX_DETAIL_LENGTH = 65_536;

// Chrome does not reliably share object event details between the page and isolated worlds.
export function encodeDetail(value: Observation | PageCommand): string {
    return JSON.stringify(value);
}

// Only string details survive the page/isolated world boundary; anything else is ignored.
export function decodeDetail(detail: unknown): unknown {
    if (typeof detail !== "string" || detail.length > MAX_DETAIL_LENGTH) return undefined;
    try {
        return JSON.parse(detail) as unknown;
    } catch {
        return undefined;
    }
}

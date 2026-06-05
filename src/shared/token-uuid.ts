const MAX_TOKEN_UUID_LENGTH = 512;
const MAX_TOKEN_UUID_SEGMENT_LENGTH = 128;
const SAFE_TOKEN_UUID_SEGMENT = /^[A-Za-z0-9_-]+$/;

function isSafeTokenUuidSegment(value: string): boolean {
    return value.length > 0
        && value.length <= MAX_TOKEN_UUID_SEGMENT_LENGTH
        && SAFE_TOKEN_UUID_SEGMENT.test(value)
        && value !== "__proto__"
        && value !== "constructor"
        && value !== "prototype";
}

/** Extract the token ID only from an exact canvas TokenDocument UUID. */
export function getSceneTokenId(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_TOKEN_UUID_LENGTH) return null;
    const parts = value.split(".");
    return parts.length === 4
        && parts[0] === "Scene"
        && isSafeTokenUuidSegment(parts[1])
        && parts[2] === "Token"
        && isSafeTokenUuidSegment(parts[3])
        ? parts[3]
        : null;
}

/** Whether a value is an exact canvas TokenDocument UUID. */
export function isSceneTokenUuid(value: unknown): value is string {
    return getSceneTokenId(value) !== null;
}

interface PublicTokenDocument {
    readonly uuid?: string;
    readonly hidden?: boolean;
    readonly actor?: { hasCondition?(...slugs: string[]): boolean } | null;
}

function resolveUuidSync<T>(uuid: string): T | null {
    try {
        return fromUuidSync(uuid) as T | null;
    } catch {
        return null;
    }
}

/** Whether an exact token UUID is safe to serialize onto a public chat message. */
export function isPublicSceneTokenUuid(value: unknown): value is string {
    if (!isSceneTokenUuid(value)) return false;
    const token = resolveUuidSync<PublicTokenDocument>(value);
    return token?.uuid === value
        && !!token.actor
        && token.hidden !== true
        && token.actor.hasCondition?.("hidden", "undetected", "unnoticed") !== true;
}

/** Remove private, unresolved, and duplicate tokens before public persistence. */
export function getPublicSceneTokenUuids(values: readonly string[]): string[] {
    if (!Array.isArray(values) || !values.every(isSceneTokenUuid)) throw new Error("Expected exact Scene Token UUIDs");
    return [...new Set(values.filter(isPublicSceneTokenUuid))];
}

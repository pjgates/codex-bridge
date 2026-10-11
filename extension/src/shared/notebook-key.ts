export interface NotebookKeyParts {
    origin: string;
    worldId: string;
    userId: string;
    scopeId: string;
}

const PREFIX = "notebook:";
const SEPARATOR = ":";

export function notebookKey(parts: NotebookKeyParts): string {
    return PREFIX + [parts.origin, parts.worldId, parts.userId, parts.scopeId]
        .map(encodeURIComponent)
        .join(SEPARATOR);
}

export function parseNotebookKey(key: string): NotebookKeyParts | null {
    if (!key.startsWith(PREFIX)) return null;
    const encoded = key.slice(PREFIX.length).split(SEPARATOR);
    if (encoded.length !== 4 || encoded.some((part) => part.length === 0)) return null;
    let decoded: string[];
    try {
        decoded = encoded.map(decodeURIComponent);
    } catch {
        return null;
    }
    if (decoded.some((part, index) => encodeURIComponent(part) !== encoded[index])) return null;
    const [origin, worldId, userId, scopeId] = decoded as [string, string, string, string];
    return { origin, worldId, userId, scopeId };
}

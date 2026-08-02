import { randomBytes } from "node:crypto";

export function mintSyncId(): string {
    let id = "";
    while (id.length < 8) id += randomBytes(6).readUIntBE(0, 6).toString(36);
    return `fs-${id.slice(0, 8)}`;
}

export function insertFrontmatterField(raw: string, field: string, value: string): string {
    if (!raw.startsWith("---\n")) throw new Error("File has no frontmatter block");
    const close = raw.indexOf("\n---", 3);
    if (close === -1) throw new Error("File has no closing frontmatter delimiter");
    return `${raw.slice(0, close)}\n${field}: ${value}${raw.slice(close)}`;
}

import { describe, expect, it } from "vitest";
import { parseEntity } from "../converter/parse.js";
import { insertFrontmatterField, mintSyncId } from "./frontmatter.js";

const RAW = `---
title: Randall
type: Character
portrait: "[[randall-20260726.webp]]"
published: false
---

# Randall

Body text.
`;

describe("frontmatter extensions", () => {
    it("parses portrait as a bare filename and missing syncId as undefined", () => {
        const entity = parseEntity("randall.md", RAW);
        expect(entity.frontmatter.portrait).toBe("randall-20260726.webp");
        expect(entity.frontmatter.syncId).toBeUndefined();
    });

    it("mints ids in the fs-xxxxxxxx format", () => {
        const id = mintSyncId();
        expect(id).toMatch(/^fs-[a-z0-9]{8}$/);
        expect(mintSyncId()).not.toBe(id);
    });

    it("inserts a field before the closing delimiter without touching other lines", () => {
        const out = insertFrontmatterField(RAW, "syncId", "fs-7k2m9p");
        expect(out).toContain("published: false\nsyncId: fs-7k2m9p\n---");
        expect(out.split("# Randall")).toHaveLength(2);
        expect(parseEntity("randall.md", out).frontmatter.syncId).toBe("fs-7k2m9p");
    });

    it("throws on a file without frontmatter", () => {
        expect(() => insertFrontmatterField("no frontmatter", "syncId", "x")).toThrow(/frontmatter/i);
    });
});

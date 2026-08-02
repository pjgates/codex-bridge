import { describe, expect, it } from "vitest";
import { parseEntity } from "../parse.js";

describe("parseEntity", () => {
    it("defaults absent published to true", () => {
        expect(parseEntity("entry.md", "---\ntitle: Entry\n---\n").frontmatter.published).toBe(true);
    });

    it("rejects non-boolean published values with a field diagnostic", () => {
        expect(() => parseEntity("entry.md", "---\ntitle: Entry\npublished: yes\n---\n"))
            .toThrow("entry.md: published: expected a boolean");
    });

    it("rejects malformed depth", () => {
        expect(() => parseEntity("entry.md", "---\ntitle: Entry\ndepth: nope\n---\n"))
            .toThrow("entry.md: depth: expected an integer");
    });
});

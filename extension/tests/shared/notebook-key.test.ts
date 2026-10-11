import { describe, expect, it } from "vitest";
import { notebookKey, parseNotebookKey } from "../../src/shared/notebook-key.js";

describe("notebook keys", () => {
    it("round-trips encoded parts", () => {
        const parts = { origin: "http://host:30000", worldId: "w:1", userId: "u%2", scopeId: "scene:combat" };
        const key = notebookKey(parts);
        expect(key).toBe("notebook:http%3A%2F%2Fhost%3A30000:w%3A1:u%252:scene%3Acombat");
        expect(parseNotebookKey(key)).toEqual(parts);
    });

    it("keeps an origin that is a prefix of another origin distinct", () => {
        const key = notebookKey({ origin: "http://host:30000", worldId: "w", userId: "u", scopeId: "s" });
        expect(parseNotebookKey(key)?.origin).toBe("http://host:30000");
        expect(key.startsWith(`notebook:${encodeURIComponent("http://host")}:`)).toBe(false);
    });

    it("rejects malformed keys", () => {
        for (const key of [
            "",
            "notebook:",
            "other:a:b:c:d",
            "notebook:http://host:w:u:s",
            "notebook:a:b:c",
            "notebook:a:b:c:d:e",
            "notebook:a::c:d",
            "notebook:%E0%A4%A:b:c:d",
            "notebook:A%3a:b:c:d",
        ]) {
            expect(parseNotebookKey(key)).toBeNull();
        }
    });
});

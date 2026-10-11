import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
    const manifest = JSON.parse(
        readFileSync(resolve(import.meta.dirname, "../manifest.json"), "utf8"),
    ) as Record<string, unknown>;

    it("uses MV3 with optional site access and exact entry names", () => {
        expect(manifest.manifest_version).toBe(3);
        expect(manifest.permissions).toEqual(["scripting", "storage", "activeTab"]);
        expect(manifest.optional_host_permissions).toEqual(["http://*/*", "https://*/*"]);
        expect(manifest.background).toEqual({
            service_worker: "service-worker.js",
            type: "module",
        });
        expect(manifest.action).toEqual({
            default_popup: "popup.html",
            default_title: "PF2e Combat Notebook",
        });
        expect(manifest.content_scripts).toBeUndefined();
    });
});

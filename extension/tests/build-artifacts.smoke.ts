import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dist = resolve(import.meta.dirname, "../dist");

const bundles = ["service-worker.js", "content.js", "main-world.js", "popup.js"];
const classicScripts = ["content.js", "main-world.js", "popup.js"];

interface BuiltManifest {
    background: { service_worker: string };
    action: { default_popup: string };
    permissions?: string[];
    host_permissions?: string[];
    optional_host_permissions?: string[];
    content_scripts?: unknown;
}

function read(file: string): string {
    return readFileSync(resolve(dist, file), "utf8");
}

function readManifest(): BuiltManifest {
    return JSON.parse(read("manifest.json")) as BuiltManifest;
}

describe("built extension", () => {
    it("contains every manifest-referenced entry", () => {
        const manifest = readManifest();
        expect(() => readFileSync(resolve(dist, manifest.background.service_worker))).not.toThrow();
        expect(() => readFileSync(resolve(dist, manifest.action.default_popup))).not.toThrow();
        for (const file of ["content.js", "main-world.js", "popup.js"]) {
            expect(() => readFileSync(resolve(dist, file))).not.toThrow();
        }
    });

    it("emits exactly the expected files", () => {
        const expected = [
            ...bundles.flatMap((bundle) => [bundle, `${bundle}.map`]),
            "manifest.json",
            "popup.html",
        ].sort();
        expect(readdirSync(dist).sort()).toEqual(expected);
    });

    it.each(classicScripts)("builds %s as a self-contained IIFE", (file) => {
        const source = read(file);
        expect(source.trimStart().startsWith("(function(")).toBe(true);
        expect(source).not.toMatch(/^\s*import[\s{*"']/m);
        expect(source).not.toMatch(/^\s*export[\s{*]/m);
        expect(source).not.toMatch(/\bimport\s*\(/);
    });

    it("bundles the service worker without chunk imports", () => {
        const source = read("service-worker.js");
        expect(source).not.toMatch(/^\s*import[\s{*"']/m);
        expect(source).not.toMatch(/\bimport\s*\(/);
    });

    it("requests site access only optionally and never statically injects", () => {
        const manifest = readManifest();
        expect(manifest.content_scripts).toBeUndefined();
        expect(manifest.permissions ?? []).not.toContain("tabs");
        expect(manifest.host_permissions ?? []).toEqual([]);
        expect(manifest.optional_host_permissions?.length).toBeGreaterThan(0);
    });

    // `.delete(` is excluded from the content and worker bundles: they run outside
    // the Foundry page and cannot reach documents, so it only appears on Map/Set.
    const forbidden: Array<{ label: string; pattern: RegExp; files: string[] }> = [
        { label: "fromUuid(", pattern: /\bfromUuid(?:Sync)?\s*\(/, files: bundles },
        { label: ".update(", pattern: /\.update\s*\(/, files: bundles },
        { label: ".create(", pattern: /\.create\s*\(/, files: bundles },
        { label: ".delete(", pattern: /\.delete\s*\(/, files: ["main-world.js", "popup.js"] },
        {
            label: "embedded document or flag writes",
            pattern: /\b(?:create|update|delete)EmbeddedDocuments\b|\b(?:set|unset)Flag\s*\(/,
            files: bundles,
        },
        { label: "fetch(", pattern: /\bfetch\s*\(/, files: bundles },
        { label: "socket.emit", pattern: /\bsocket\??\.emit\b/, files: bundles },
        { label: "game.settings.set", pattern: /\bsettings\??\.set\s*\(/, files: bundles },
        { label: "Hooks.call(", pattern: /\bHooks\??\.call(?:All)?\s*\(/, files: bundles },
        {
            label: "other network APIs",
            pattern: /\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b|\bEventSource\b/,
            files: bundles,
        },
    ];

    for (const { label, pattern, files } of forbidden) {
        it.each(files)(`contains no ${label} in %s`, (file) => {
            expect(read(file)).not.toMatch(pattern);
        });
    }
});

import { defineConfig, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { readFileSync, writeFileSync, mkdirSync, globSync } from "node:fs";
import { basename, resolve } from "node:path";
import path from "node:path";

// ─── Merge Lang Plugin ───────────────────────────────────────────────────────
// Globs all src/**/lang/*.json, deep-merges by locale, writes to dist/lang/.

function deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
): Record<string, unknown> {
    for (const key of Object.keys(source)) {
        const srcVal = source[key];
        if (srcVal && typeof srcVal === "object" && !Array.isArray(srcVal)) {
            target[key] = deepMerge(
                (target[key] as Record<string, unknown>) ?? {},
                srcVal as Record<string, unknown>,
            );
        } else {
            target[key] = srcVal;
        }
    }
    return target;
}

function mergeLang(): Plugin {
    return {
        name: "merge-lang",
        writeBundle(options) {
            const outDir = options.dir ?? "dist";
            const files = globSync("src/**/lang/*.json") as string[];

            const locales: Record<string, Record<string, unknown>> = {};
            for (const file of files) {
                const locale = basename(file);
                const content = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
                locales[locale] = deepMerge(locales[locale] ?? {}, content);
            }

            const langDir = resolve(outDir, "lang");
            mkdirSync(langDir, { recursive: true });
            for (const [locale, merged] of Object.entries(locales)) {
                writeFileSync(resolve(langDir, locale), JSON.stringify(merged, null, 4) + "\n");
            }
        },
    };
}

// ─── Vite Config ─────────────────────────────────────────────────────────────

export default defineConfig({
    build: {
        outDir: "dist",
        emptyOutDir: true,
        sourcemap: true,
        lib: {
            entry: path.resolve(__dirname, "src/module.ts"),
            formats: ["es"],
            fileName: "module",
        },
        rollupOptions: {
            output: {
                // Keep CSS as a separate file
                assetFileNames: "[name][extname]",
            },
        },
    },
    plugins: [
        viteStaticCopy({
            targets: [
                // Feature-co-located templates
                { src: "src/prad/templates/**/*", dest: "templates/prad" },
                { src: "src/target-helper/templates/**/*", dest: "templates/target-helper" },
                { src: "src/sync/templates/**/*", dest: "templates/sync" },
                { src: "module.json", dest: "." },
            ],
        }),
        // Merge per-feature lang files into a single dist/lang/en.json
        mergeLang(),
    ],
    css: {
        preprocessorOptions: {
            scss: {
                // Add any global SCSS variables or mixins here
            },
        },
    },
});

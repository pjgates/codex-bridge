import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build, type LibraryFormats } from "vite";

const root = import.meta.dirname;
const outDir = resolve(root, "dist");

interface Entry {
    source: string;
    output: string;
    format: LibraryFormats;
    name?: string;
}

const entries: Entry[] = [
    { source: "src/background/service-worker.ts", output: "service-worker.js", format: "es" },
    { source: "src/content/index.ts", output: "content.js", format: "iife", name: "PF2eNotebookContent" },
    { source: "src/main/index.ts", output: "main-world.js", format: "iife", name: "PF2eNotebookMain" },
    { source: "src/popup/index.ts", output: "popup.js", format: "iife", name: "PF2eNotebookPopup" },
];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const entry of entries) {
    await build({
        configFile: false,
        logLevel: "info",
        build: {
            outDir,
            emptyOutDir: false,
            sourcemap: true,
            lib: {
                entry: resolve(root, entry.source),
                formats: [entry.format],
                name: entry.name,
                fileName: () => entry.output,
            },
        },
    });
}

await Promise.all([
    copyFile(resolve(root, "manifest.json"), resolve(outDir, "manifest.json")),
    copyFile(resolve(root, "popup.html"), resolve(outDir, "popup.html")),
]);

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(pluginDir, "..");

function copyPluginArtifacts(): Plugin {
    return {
        name: "codex-dashboard-artifacts",
        writeBundle() {
            const distDir = resolve(pluginDir, "dist");
            const artifacts = ["manifest.json", "styles.css"] as const;

            for (const file of artifacts) {
                copyFileSync(resolve(pluginDir, file), join(distDir, file));
            }

            const configPath = resolve(repoRoot, "codex-sync.config.json");
            if (!existsSync(configPath)) {
                console.info("codex-dashboard: codex-sync.config.json not found; skipping vault copy");
                return;
            }

            const config = JSON.parse(readFileSync(configPath, "utf-8")) as { vaultPath?: string };
            if (!config.vaultPath) {
                console.info("codex-dashboard: vaultPath missing in codex-sync.config.json; skipping vault copy");
                return;
            }

            const vaultPluginDir = join(config.vaultPath, ".obsidian/plugins/codex-dashboard");
            mkdirSync(vaultPluginDir, { recursive: true });

            for (const file of ["main.js", "manifest.json", "styles.css"] as const) {
                copyFileSync(join(distDir, file), join(vaultPluginDir, file));
            }
        },
    };
}

export default defineConfig({
    root: pluginDir,
    build: {
        outDir: "dist",
        emptyOutDir: true,
        lib: {
            entry: resolve(pluginDir, "src/main.ts"),
            formats: ["cjs"],
        },
        rollupOptions: {
            external: ["obsidian", "electron", /^@codemirror\//, /^@lezer\//],
            output: {
                entryFileNames: "main.js",
            },
        },
    },
    plugins: [copyPluginArtifacts()],
});

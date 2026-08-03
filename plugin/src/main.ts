import { Plugin } from "obsidian";

export default class CodexDashboardPlugin extends Plugin {
    async onload(): Promise<void> {
        console.info("codex-dashboard: loaded");
    }
}

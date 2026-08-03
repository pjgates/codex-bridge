import { App, PluginSettingTab, Setting } from "obsidian";
import {
    clampDescriptionLines,
    DEFAULT_DESCRIPTION_LINES,
    formatExcludeTagsText,
    MAX_DESCRIPTION_LINES,
    MIN_DESCRIPTION_LINES,
    parseExcludeTagsText,
} from "./defaults.js";
import type CodexDashboardPlugin from "./main.js";

const TAB_HEADING = "Codex Dashboard";
const TAB_TAGLINE =
    "At-a-glance character cards and a GM roster for entity notes.";

export class CodexDashboardSettingTab extends PluginSettingTab {
    constructor(
        app: App,
        private readonly plugin: CodexDashboardPlugin,
    ) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: TAB_HEADING });
        containerEl.createEl("p", {
            cls: "setting-item-description",
            text: TAB_TAGLINE,
        });

        new Setting(containerEl)
            .setName("Show note cards")
            .setDesc("Master switch for character cards injected into reading view.")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.cardSettings.showNoteCards)
                    .onChange(async (value) => {
                        this.plugin.cardSettings.showNoteCards = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Exclude tags")
            .setDesc("Comma-separated tags hidden from card chips (case-insensitive).")
            .addText((text) => {
                text
                    .setPlaceholder("NPC")
                    .setValue(formatExcludeTagsText(this.plugin.cardSettings.excludeTags))
                    .onChange(async (value) => {
                        this.plugin.cardSettings.excludeTags = parseExcludeTagsText(value);
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Description lines")
            .setDesc(
                `Number of lines shown in the card description (${MIN_DESCRIPTION_LINES}–${MAX_DESCRIPTION_LINES}).`,
            )
            .addText((text) => {
                text
                    .setPlaceholder(String(DEFAULT_DESCRIPTION_LINES))
                    .setValue(String(this.plugin.cardSettings.descriptionLines))
                    .onChange(async (value) => {
                        const parsed = Number.parseInt(value.trim(), 10);
                        this.plugin.cardSettings.descriptionLines = clampDescriptionLines(
                            Number.isFinite(parsed) ? parsed : DEFAULT_DESCRIPTION_LINES,
                        );
                        await this.plugin.saveSettings();
                    });
            });
    }
}

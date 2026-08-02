/**
 * Statblock importer — paste-markdown → benchmark preview → NPC actor.
 *
 * Runtime counterpart to the build-time pack converter: same parsing and
 * actor-building core, but lenient about homebrew vocabulary and with no
 * module release required to add or update a monster.
 */
import { load } from "js-yaml";
import {
    buildActorDocument,
    markdownToHtml,
    normaliseStatblock,
    type CreatureStatblock,
} from "../statblock/index.js";
import { renderPreview } from "./preview.js";
import { MODULE_ID } from "../../../constants.js";

/** Split a markdown file into its YAML frontmatter block and body. */
function splitFrontmatter(markdown: string): { yaml: string; body: string } {
    const match = markdown.match(/^\ufeff?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) throw new Error(game.i18n!.localize(`${MODULE_ID}.statblockImporter.noFrontmatter`));
    return { yaml: match[1], body: match[2].trim() };
}

interface ImportedCreature {
    statblock: CreatureStatblock;
    /** Sanitized HTML for the actor's public notes (markdown body). */
    publicNotes: string;
}

/** Parse a full pasted markdown file into a statblock + notes HTML. */
export function parsePastedStatblock(markdown: string): ImportedCreature {
    const { yaml, body } = splitFrontmatter(markdown);
    const data = load(yaml);
    if (data == null || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(game.i18n!.localize(`${MODULE_ID}.statblockImporter.noFrontmatter`));
    }
    const record = data as Record<string, unknown>;
    if (record.statblock !== true) {
        throw new Error(game.i18n!.localize(`${MODULE_ID}.statblockImporter.notAStatblock`));
    }
    const statblock = normaliseStatblock(record, "<pasted>", { lenient: true });
    // Resolve Obsidian wikilinks to their display text before markdown conversion.
    const plainBody = body.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1").replace(/\[\[([^\]]*)\]\]/g, "$1");
    return { statblock, publicNotes: plainBody ? markdownToHtml(plainBody) : "" };
}

/** Build actor creation data for the runtime importer (no embedded ids). */
export function buildImportActorData(creature: ImportedCreature): Record<string, unknown> {
    const slug = creature.statblock.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return buildActorDocument(
        { slug, statblock: creature.statblock },
        { structuredIWR: true, publicNotes: creature.publicNotes, flagsSource: "importer" },
    );
}

async function runImportFlow(): Promise<void> {
    const { DialogV2 } = foundry.applications.api;
    const localize = (key: string): string => game.i18n!.localize(`${MODULE_ID}.statblockImporter.${key}`);

    const pasted = (await DialogV2.prompt({
        window: { title: localize("dialogTitle"), icon: "fa-solid fa-file-import" },
        position: { width: 560 },
        content: `
            <p>${localize("pasteHint")}</p>
            <textarea name="markdown" rows="16" class="ssi-paste" autofocus></textarea>`,
        ok: {
            label: localize("previewButton"),
            callback: (_event: Event, button: HTMLButtonElement) =>
                (button.form!.elements.namedItem("markdown") as HTMLTextAreaElement).value,
        },
        rejectClose: false,
    })) as string | null;
    if (!pasted?.trim()) return;

    let creature: ImportedCreature;
    try {
        creature = parsePastedStatblock(pasted);
    } catch (error) {
        ui.notifications!.error(
            game.i18n!.format(`${MODULE_ID}.statblockImporter.parseFailed`, {
                message: error instanceof Error ? error.message : String(error),
            }),
        );
        return;
    }

    const confirmed = await DialogV2.confirm({
        window: { title: `${localize("previewTitle")} — ${creature.statblock.name}`, icon: "fa-solid fa-dragon" },
        position: { width: 660 },
        content: renderPreview(creature.statblock),
        yes: { label: localize("createButton"), icon: "fa-solid fa-check" },
        no: { label: localize("cancelButton") },
        rejectClose: false,
    });
    if (confirmed !== true) return;

    const actor = await getDocumentClass("Actor").create(buildImportActorData(creature) as unknown as Actor.CreateData);
    if (!actor) return;
    ui.notifications!.info(
        game.i18n!.format(`${MODULE_ID}.statblockImporter.created`, { name: actor.name, level: String(creature.statblock.level) }),
    );
    actor.sheet?.render(true);
}

/** Register the Actors-directory button (init-time; GM gating happens at render). */
export function initStatblockImporter(): void {
    Hooks.on("renderActorDirectory", (_app: object, element: HTMLElement) => {
        if (!game.user?.isGM) return;
        if (!game.settings!.get(MODULE_ID, "enableCustomRules") || !game.settings!.get(MODULE_ID, "enableStatblockImporter")) return;
        if (element.querySelector(".ssi-import-button")) return;
        const anchor =
            element.querySelector(".directory-header .header-actions") ??
            element.querySelector(".directory-footer") ??
            element;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ssi-import-button";
        button.innerHTML = `<i class="fa-solid fa-file-import"></i> ${game.i18n!.localize(`${MODULE_ID}.statblockImporter.buttonLabel`)}`;
        button.addEventListener("click", () => {
            runImportFlow().catch((error) => {
                console.error(`${MODULE_ID} | Statblock importer failed`, error);
                ui.notifications!.error(
                    game.i18n!.format(`${MODULE_ID}.statblockImporter.parseFailed`, {
                        message: error instanceof Error ? error.message : String(error),
                    }),
                );
            });
        });
        anchor.append(button);
    });
}

/** Register the feature's world setting (called from the init hook). */
export function registerStatblockImporterSetting(): void {
    game.settings!.register(MODULE_ID, "enableStatblockImporter", {
        name: `${MODULE_ID}.settings.enableStatblockImporter.name`,
        hint: `${MODULE_ID}.settings.enableStatblockImporter.hint`,
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        requiresReload: true,
    });
}

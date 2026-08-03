export const DEFAULT_SHOW_NOTE_CARDS = true;
export const DEFAULT_EXCLUDE_TAGS = ["NPC"];
export const DEFAULT_DESCRIPTION_LINES = 3;

export const MIN_DESCRIPTION_LINES = 1;
export const MAX_DESCRIPTION_LINES = 10;

export interface CardSettings {
    showNoteCards: boolean;
    excludeTags: string[];
    descriptionLines: number;
}

export const DEFAULT_CARD_SETTINGS: CardSettings = {
    showNoteCards: DEFAULT_SHOW_NOTE_CARDS,
    excludeTags: [...DEFAULT_EXCLUDE_TAGS],
    descriptionLines: DEFAULT_DESCRIPTION_LINES,
};

export function clampDescriptionLines(value: number): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_DESCRIPTION_LINES;
    }

    return Math.min(
        MAX_DESCRIPTION_LINES,
        Math.max(MIN_DESCRIPTION_LINES, Math.round(value)),
    );
}

export function parseExcludeTagsText(text: string): string[] {
    const seen = new Set<string>();
    const tags: string[] = [];

    for (const part of text.split(",")) {
        let tag = part.trim();
        if (tag.startsWith("#")) {
            tag = tag.slice(1).trim();
        }

        if (!tag) {
            continue;
        }

        const key = tag.toLowerCase();
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        tags.push(tag);
    }

    return tags;
}

export function formatExcludeTagsText(tags: string[]): string {
    return tags.join(", ");
}

export function normalizeCardSettings(raw: unknown): CardSettings {
    const data =
        typeof raw === "object" && raw !== null
            ? (raw as Partial<CardSettings> & {
                  excludeTags?: unknown;
                  showNoteCards?: unknown;
                  descriptionLines?: unknown;
              })
            : {};

    const showNoteCards =
        typeof data.showNoteCards === "boolean"
            ? data.showNoteCards
            : DEFAULT_SHOW_NOTE_CARDS;

    let excludeTags: string[];
    if (Array.isArray(data.excludeTags)) {
        excludeTags = parseExcludeTagsText(
            data.excludeTags.map((entry) => String(entry)).join(", "),
        );
    } else if (typeof data.excludeTags === "string") {
        excludeTags = parseExcludeTagsText(data.excludeTags);
    } else {
        excludeTags = [...DEFAULT_EXCLUDE_TAGS];
    }

    const descriptionLines =
        typeof data.descriptionLines === "number"
            ? clampDescriptionLines(data.descriptionLines)
            : DEFAULT_DESCRIPTION_LINES;

    return {
        showNoteCards,
        excludeTags,
        descriptionLines,
    };
}

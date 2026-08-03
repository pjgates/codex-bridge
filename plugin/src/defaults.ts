/** Task 6 will replace these literals with persisted plugin settings. */
export const DEFAULT_SHOW_NOTE_CARDS = true;
export const DEFAULT_LIVE_PREVIEW_CARDS = false;
export const DEFAULT_EXCLUDE_TAGS = ["NPC"];
export const DEFAULT_DESCRIPTION_LINES = 3;

export interface CardSettings {
    showNoteCards: boolean;
    livePreviewCards: boolean;
    excludeTags: string[];
    descriptionLines: number;
}

export const DEFAULT_CARD_SETTINGS: CardSettings = {
    showNoteCards: DEFAULT_SHOW_NOTE_CARDS,
    livePreviewCards: DEFAULT_LIVE_PREVIEW_CARDS,
    excludeTags: [...DEFAULT_EXCLUDE_TAGS],
    descriptionLines: DEFAULT_DESCRIPTION_LINES,
};

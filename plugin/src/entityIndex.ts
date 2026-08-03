import {
    App,
    CachedMetadata,
    TFile,
    getAllTags,
} from "obsidian";
import { parseCampaigns, type CampaignRef } from "./core/campaign.js";
import type { EntityRecord } from "./core/roster.js";

type ChangeHandler = () => void;

const PORTRAIT_WIKILINK_RE = /^\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]$/;

export class EntityIndex {
    private readonly recordsByPath = new Map<string, EntityRecord>();
    private readonly changeHandlers = new Set<ChangeHandler>();
    private initialBuildDone = false;

    constructor(private readonly app: App) {}

    records(): EntityRecord[] {
        return Array.from(this.recordsByPath.values()).sort((left, right) =>
            left.path.localeCompare(right.path),
        );
    }

    campaigns(): CampaignRef[] {
        const byKey = new Map<string, CampaignRef>();

        for (const record of this.recordsByPath.values()) {
            for (const campaign of record.campaigns) {
                if (!byKey.has(campaign.key)) {
                    byKey.set(campaign.key, campaign);
                }
            }
        }

        return Array.from(byKey.values()).sort((left, right) =>
            left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
        );
    }

    onChanged(handler: ChangeHandler): () => void {
        this.changeHandlers.add(handler);
        return () => {
            this.changeHandlers.delete(handler);
        };
    }

    destroy(): void {
        this.changeHandlers.clear();
        this.recordsByPath.clear();
    }

    rebuild(): void {
        const next = new Map<string, EntityRecord>();

        for (const file of this.app.vault.getMarkdownFiles()) {
            const record = this.recordFromFile(file);
            if (record) {
                next.set(record.path, record);
            }
        }

        this.replaceRecords(next);
    }

    upsertFile(file: TFile): void {
        this.upsertFromCache(file.path, this.app.metadataCache.getFileCache(file));
    }

    upsertFromCache(path: string, cache: CachedMetadata | null): void {
        const record = buildEntityRecord(path, cache);
        const hadRecord = this.recordsByPath.has(path);

        if (record) {
            const previous = this.recordsByPath.get(path);
            this.recordsByPath.set(path, record);
            if (!hadRecord || !recordsEqual(previous, record)) {
                this.emitChanged();
            }
            return;
        }

        if (this.recordsByPath.delete(path)) {
            this.emitChanged();
        }
    }

    renamePath(oldPath: string, file: TFile): void {
        const hadOld = this.recordsByPath.delete(oldPath);
        const record = this.recordFromFile(file);

        if (record) {
            this.recordsByPath.set(file.path, record);
        }

        if (hadOld || record) {
            this.emitChanged();
        }
    }

    removePath(path: string): void {
        if (this.recordsByPath.delete(path)) {
            this.emitChanged();
        }
    }

    markInitialBuildDone(): void {
        this.initialBuildDone = true;
    }

    hasInitialBuild(): boolean {
        return this.initialBuildDone;
    }

    private recordFromFile(file: TFile): EntityRecord | null {
        return buildEntityRecord(file.path, this.app.metadataCache.getFileCache(file));
    }

    private replaceRecords(next: Map<string, EntityRecord>): void {
        const changed =
            next.size !== this.recordsByPath.size ||
            Array.from(next.entries()).some(([path, record]) => {
                const previous = this.recordsByPath.get(path);
                return !previous || !recordsEqual(previous, record);
            });

        this.recordsByPath.clear();
        for (const [path, record] of next) {
            this.recordsByPath.set(path, record);
        }

        if (changed) {
            this.emitChanged();
        }
    }

    private emitChanged(): void {
        for (const handler of this.changeHandlers) {
            handler();
        }
    }
}

export function buildEntityRecord(
    path: string,
    cache: CachedMetadata | null,
): EntityRecord | null {
    const frontmatter = cache?.frontmatter;
    if (!frontmatter || frontmatter.type !== "Character") {
        return null;
    }

    const depth = parseDepth(frontmatter.depth);
    if (depth === null) {
        return null;
    }

    const portrait = parsePortrait(frontmatter.portrait);

    return {
        path,
        name: String(frontmatter.title ?? titleFromPath(path)),
        aliases: toStringArray(frontmatter.aliases),
        depth,
        onstage: frontmatter.onstage === true,
        status: String(frontmatter.status ?? "active"),
        campaigns: parseCampaigns(frontmatter.campaign),
        tags: collectTags(cache),
        ...(portrait ? { portrait } : {}),
    };
}

function collectTags(cache: CachedMetadata): string[] {
    const rawTags = getAllTags(cache) ?? [];
    const seen = new Set<string>();
    const tags: string[] = [];

    for (const rawTag of rawTags) {
        const tag = rawTag.startsWith("#") ? rawTag.slice(1) : rawTag;
        if (!tag || seen.has(tag)) {
            continue;
        }
        seen.add(tag);
        tags.push(tag);
    }

    return tags;
}

function parsePortrait(value: unknown): string | undefined {
    if (typeof value !== "string" || value.trim().length === 0) {
        return undefined;
    }

    const trimmed = value.trim();
    const match = PORTRAIT_WIKILINK_RE.exec(trimmed);
    const target = (match?.[1] ?? trimmed).trim();
    return target.length > 0 ? target : undefined;
}

function parseDepth(value: unknown): number | null {
    if (value == null || value === "") {
        return 1;
    }

    const depth =
        typeof value === "number"
            ? value
            : typeof value === "string" && value.trim().length > 0
              ? Number(value)
              : Number.NaN;

    return Number.isInteger(depth) ? depth : null;
}

function toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(String).filter((entry) => entry.length > 0);
    }

    if (typeof value === "string" && value.length > 0) {
        return [value];
    }

    return [];
}

function titleFromPath(path: string): string {
    const basename = path.split("/").pop() ?? path;
    return basename.replace(/\.md$/i, "");
}

function recordsEqual(left: EntityRecord | undefined, right: EntityRecord): boolean {
    if (!left) {
        return false;
    }

    return (
        left.path === right.path &&
        left.name === right.name &&
        left.depth === right.depth &&
        left.onstage === right.onstage &&
        left.status === right.status &&
        left.portrait === right.portrait &&
        arraysEqual(left.aliases, right.aliases) &&
        arraysEqual(left.tags, right.tags) &&
        campaignsEqual(left.campaigns, right.campaigns)
    );
}

function arraysEqual(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function campaignsEqual(left: CampaignRef[], right: CampaignRef[]): boolean {
    return (
        left.length === right.length &&
        left.every((campaign, index) => {
            const other = right[index];
            return campaign.key === other.key && campaign.label === other.label;
        })
    );
}

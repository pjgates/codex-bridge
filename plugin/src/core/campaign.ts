export interface CampaignRef {
    key: string;
    label: string;
}

const WIKILINK_RE = /^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/;

export function parseCampaigns(frontmatterValue: unknown): CampaignRef[] {
    if (frontmatterValue == null || frontmatterValue === "") return [];

    const entries = Array.isArray(frontmatterValue) ? frontmatterValue : [frontmatterValue];

    return entries
        .map((entry) => parseCampaignEntry(String(entry)))
        .filter((campaign): campaign is CampaignRef => campaign !== null);
}

function parseCampaignEntry(raw: string): CampaignRef | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const wikilink = WIKILINK_RE.exec(trimmed);
    const target = (wikilink?.[1] ?? trimmed).trim();
    const alias = wikilink?.[2]?.trim();

    const key = normalizeCampaignKey(target);
    if (!key) return null;

    return {
        key,
        label: alias && alias.length > 0 ? alias : slugToLabel(key),
    };
}

export function normalizeCampaignKey(target: string): string {
    let slug = target.trim().replace(/^codex\//, "");

    if (slug.endsWith("/index")) {
        slug = slug.slice(0, -"/index".length);
    } else if (slug.endsWith(".index")) {
        slug = slug.slice(0, -".index".length);
    }

    slug = slug.replace(/\/index$/, "");
    return slug;
}

export function slugToLabel(slug: string): string {
    return slug
        .split("-")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

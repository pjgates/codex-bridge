import type { CampaignRef } from "./campaign.js";

export interface EntityRecord {
    path: string;
    name: string;
    aliases: string[];
    depth: number;
    onstage: boolean;
    status: string;
    campaigns: CampaignRef[];
    tags: string[];
    portrait?: string;
}

export interface RosterFilter {
    campaignKey?: string | null;
    onstage?: boolean;
    depths?: number[];
    query?: string;
}

export function filterRoster(records: EntityRecord[], filter: RosterFilter = {}): EntityRecord[] {
    const query = filter.query?.trim().toLowerCase() ?? "";

    return records.filter((record) => {
        if (filter.campaignKey && !record.campaigns.some((campaign) => campaign.key === filter.campaignKey)) {
            return false;
        }

        if (filter.onstage && !record.onstage) {
            return false;
        }

        if (filter.depths && filter.depths.length > 0 && !filter.depths.includes(record.depth)) {
            return false;
        }

        if (!query) return true;

        const haystack = [record.name, ...record.aliases].join("\n").toLowerCase();
        return haystack.includes(query);
    });
}

export function sortRoster(records: EntityRecord[]): EntityRecord[] {
    return [...records].sort((left, right) => {
        if (right.depth !== left.depth) return right.depth - left.depth;
        return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
}

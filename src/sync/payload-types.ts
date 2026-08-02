import type { CreatureStatblock } from "../rulesets/sf2e/statblock/index.js";

export const PAYLOAD_FORMAT_VERSION = 1;

export interface SyncEntity {
    syncId: string;
    slug: string;
    name: string;
    /** Frontmatter type: Character, Location, Faction, ... */
    type: string;
    published: boolean;
    /** HTML with @ForgeSync[<syncId>]{Display} link placeholders */
    playerHtml: string;
    gmHtml: string | null;
    /** Path relative to Data/forge-sync/, e.g. "art/fs-7k2m9p.webp"; null = no portrait */
    portrait: string | null;
    /** Path relative to Data/forge-sync/, e.g. "art/fs-7k2m9p-subject.png"; null = ring uses mystery-man */
    subject: string | null;
    contentHash: string;
}

export interface SyncCreature {
    syncId: string;
    slug: string;
    name: string;
    statblock: CreatureStatblock;
    portrait: string | null;
    contentHash: string;
}

export interface SyncPayload {
    formatVersion: typeof PAYLOAD_FORMAT_VERSION;
    generatedAt: string;
    manifestHash: string;
    entities: SyncEntity[];
    creatures: SyncCreature[];
}

export interface EncryptedBlob {
    v: 1;
    /** base64 */
    salt: string;
    /** base64 */
    iv: string;
    /** base64 AES-GCM ciphertext */
    data: string;
}

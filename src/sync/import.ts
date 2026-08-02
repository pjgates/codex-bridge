import { LEGACY_MODULE_ID, MODULE_ID } from "../constants.js";
import { buildActorDocument } from "../rulesets/sf2e/statblock/index.js";
import type { SyncCreature, SyncEntity, SyncPayload } from "./payload-types.js";
import { SETTING_LAST_MANIFEST } from "./settings.js";
import {
    actionKey,
    type AdoptAction,
    type ManagedDocType,
    type ReimportAction,
    type SyncAction,
    type SyncItem,
    type SyncKind,
    type SyncPlan,
    type UpdateAction,
    type WorldDocSnapshot,
} from "./plan.js";

const OBSERVER = 2;
const NONE = 0;

export interface ApprovedActions {
    adoptKeys: Set<string>;
    reimportKeys: Set<string>;
    deleteStaleKeys: Set<string>;
}

export interface SyncReport {
    created: number;
    updated: number;
    adopted: number;
    reimported: number;
    deleted: number;
    failed: { name: string; error: string }[];
}

interface SyncModuleFlags {
    syncId?: string;
    syncKind?: SyncKind;
    importedHash?: string;
    importedBaseline?: string;
}

type ForgeDocument = Actor.Implementation | JournalEntry.Implementation;

export function rewriteLinkPlaceholders(html: string, journalIdBySyncId: Map<string, string>): string {
    // ponytail: @ForgeSync keeps its pre-rename wire name — the old module reads new payloads until every world is migrated; never persists in world docs
    return html.replace(/@ForgeSync\[([^\]]+)\]\{([^}]*)\}/g, (_all, syncId: string, display: string) => {
        const id = journalIdBySyncId.get(syncId);
        return id ? `@UUID[JournalEntry.${id}]{${display}}` : display;
    });
}

function creatureImportProjection(source: {
    name: string;
    system: object;
    items?: { name: string; type: string; system: object }[];
}): object {
    return {
        name: source.name,
        system: source.system,
        items: (source.items ?? []).map((item) => ({ name: item.name, type: item.type, system: item.system })),
    };
}

/** Stable JSON hash of actor import state for Foundry-side change detection. */
export function hashCreatureImportData(
    actor: Pick<Actor.Implementation, "name" | "system" | "items" | "toObject">,
): string {
    const source =
        typeof actor.toObject === "function"
            ? creatureImportProjection(actor.toObject() as Parameters<typeof creatureImportProjection>[0])
            : creatureImportProjection({
                name: actor.name,
                system: actor.system,
                items: [...actor.items].map((item) => ({ name: item.name, type: item.type, system: item.system })),
            });
    return hashString(stableStringify(sortKeysDeep(source)));
}

function sortKeysDeep(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
        sorted[key] = sortKeysDeep(record[key]);
    }
    return sorted;
}

function stableStringify(value: unknown): string {
    return JSON.stringify(value);
}

/** FNV-1a 32-bit string hash, hex-encoded. */
function hashString(input: string): string {
    let hash = 2_166_136_261;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16_777_619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function syncFlags(syncId: string, syncKind: SyncKind, importedHash: string): Record<string, SyncModuleFlags> {
    return { [MODULE_ID]: { syncId, syncKind, importedHash } };
}

/** Identity-only flags for pass 1 — content hashes advance ONLY with successful content application. */
function identityFlags(syncId: string, syncKind: SyncKind): Record<string, SyncModuleFlags> {
    return { [MODULE_ID]: { syncId, syncKind } };
}

function creatureFlags(syncId: string, importedHash: string, importedBaseline: string): Record<string, SyncModuleFlags> {
    return { [MODULE_ID]: { syncId, syncKind: "creature-actor", importedHash, importedBaseline } };
}

export function moduleFlags(doc: { flags: Record<string, unknown> }): SyncModuleFlags {
    // ponytail: legacy-key read fallback keeps pre-rename docs managed; removal = one-time flag-migration script if cleanup is ever wanted
    return ((doc.flags[MODULE_ID] ?? doc.flags[LEGACY_MODULE_ID]) ?? {}) as SyncModuleFlags;
}

async function getOrCreateFolder(name: string, type: "JournalEntry" | "Actor"): Promise<string> {
    const existing = game.folders?.find((folder) => folder.type === type && folder.name === name);
    if (existing) return existing.id;
    const folder = await getDocumentClass("Folder").create({ name, type });
    return folder!.id;
}

function journalPages(entity: SyncEntity, journalIdBySyncId: Map<string, string>): Record<string, unknown>[] {
    const pages: Record<string, unknown>[] = [{
        name: entity.name,
        type: "text",
        sort: 100_000,
        text: { content: rewriteLinkPlaceholders(entity.playerHtml, journalIdBySyncId), format: 1 },
        title: { show: true, level: 1 },
        ownership: { default: OBSERVER },
    }];
    if (entity.gmHtml !== null) {
        pages.push({
            name: "GM Notes",
            type: "text",
            sort: 200_000,
            text: { content: rewriteLinkPlaceholders(entity.gmHtml, journalIdBySyncId), format: 1 },
            title: { show: true, level: 1 },
            ownership: { default: NONE },
        });
    }
    return pages;
}

function journalShellUpdate(entity: SyncEntity): Record<string, unknown> {
    return {
        name: entity.name,
        ownership: { default: entity.published ? OBSERVER : NONE },
        flags: syncFlags(entity.syncId, "entity-journal", entity.contentHash),
    };
}

/** Managed folder for pass-1 journal shells (create only — adopts never move). */
export const JOURNAL_SHELL_FOLDER = { name: "Entities", type: "JournalEntry" as const };

/** Pass-1 journal shell create — identity flags plus managed folder placement. */
export function journalShellCreateData(entity: SyncEntity, folderId: string): Record<string, unknown> {
    return {
        name: entity.name,
        ownership: { default: entity.published ? OBSERVER : NONE },
        folder: folderId,
        flags: identityFlags(entity.syncId, "entity-journal"),
    };
}

/** Pass-1 adopt attach — identity flags only; never moves existing documents. */
export function journalAdoptUpdateData(syncId: string, syncKind: SyncKind): Record<string, unknown> {
    return { flags: identityFlags(syncId, syncKind) };
}

/** Vault-owned fields written on EVERY people-actor sync (update-safe: never clobbers GM token tweaks like actorLink/disposition; note img is vault-owned — manual GM art on a placeholder actor reverts on the next content sync; set `portrait:` in the vault instead). */
export function peopleActorVaultFields(entity: SyncEntity): Record<string, unknown> {
    const MYSTERY_MAN = "icons/svg/mystery-man.svg";
    const img = entity.portrait ? `codex-sync/${entity.portrait}` : MYSTERY_MAN;
    const ringSubjectTexture = entity.subject ? `codex-sync/${entity.subject}` : MYSTERY_MAN;
    return {
        name: entity.name,
        img,
        prototypeToken: {
            texture: { src: img },
            ring: {
                enabled: true,
                subject: { texture: ringSubjectTexture, scale: 1 },
            },
        },
        flags: syncFlags(entity.syncId, "people-actor", entity.contentHash),
    };
}

export function peopleActorUpdateData(entity: SyncEntity): Record<string, unknown> {
    return peopleActorVaultFields(entity);
}

/** Create payload — vault fields plus create-only token defaults in one prototypeToken. */
export function peopleActorCreateData(entity: SyncEntity): Record<string, unknown> {
    const vault = peopleActorVaultFields(entity);
    const vaultPrototype = vault.prototypeToken as Record<string, unknown>;
    return {
        ...vault,
        prototypeToken: {
            ...vaultPrototype,
            actorLink: true,
            disposition: 0,
        },
    };
}

function buildTranslatedCreature(creature: SyncCreature): Record<string, unknown> {
    return buildActorDocument(
        { slug: creature.slug, statblock: creature.statblock },
        { structuredIWR: true },
    );
}

function creaturePortrait(creature: SyncCreature): string | undefined {
    return creature.portrait ? `codex-sync/${creature.portrait}` : undefined;
}

function getManagedDocument(docType: ManagedDocType, id: string): ForgeDocument | undefined {
    return docType === "JournalEntry" ? game.journal!.get(id) : game.actors!.get(id);
}

function recordFailure(report: SyncReport, name: string, error: unknown): void {
    report.failed.push({
        name,
        error: error instanceof Error ? error.message : String(error),
    });
}

function refreshJournalIdMap(journalIdBySyncId: Map<string, string>): void {
    journalIdBySyncId.clear();
    for (const doc of game.journal!) {
        const flags = moduleFlags(doc);
        if (flags.syncId) journalIdBySyncId.set(flags.syncId, doc.id);
    }
}

async function writeCreatureBaseline(actor: Actor.Implementation, syncId: string, importedHash: string): Promise<void> {
    await actor.update({
        flags: creatureFlags(syncId, importedHash, hashCreatureImportData(actor)),
    });
}

async function createCreatureActor(creature: SyncCreature): Promise<Actor.Implementation> {
    const translated = buildTranslatedCreature(creature);
    const portrait = creaturePortrait(creature);
    const translatedFlags = translated.flags as Record<string, Record<string, unknown>> | undefined;
    const builderModuleFlags = translatedFlags?.[MODULE_ID] ?? {};
    const actor = await getDocumentClass("Actor").create({
        ...translated,
        ...(portrait ? { img: portrait } : {}),
        folder: await getOrCreateFolder("Bestiary", "Actor"),
        ownership: { default: NONE },
        flags: {
            ...translatedFlags,
            [MODULE_ID]: {
                ...builderModuleFlags,
                ...syncFlags(creature.syncId, "creature-actor", creature.contentHash)[MODULE_ID],
            },
        },
    } as unknown as Actor.CreateData);
    if (!actor) throw new Error(`Failed to create creature actor "${creature.name}"`);
    await writeCreatureBaseline(actor, creature.syncId, creature.contentHash);
    return actor;
}

async function reimportCreatureActor(actor: Actor.Implementation, creature: SyncCreature): Promise<void> {
    const translated = buildTranslatedCreature(creature);
    const portrait = creaturePortrait(creature);
    await actor.update({
        name: translated.name,
        ...(portrait ? { img: portrait } : {}),
        system: translated.system,
    } as Actor.UpdateData);
    const itemIds = actor.items.map((item) => item.id);
    if (itemIds.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", itemIds);
    }
    const items = translated.items as Item.CreateData[] | undefined;
    if (items?.length) {
        await actor.createEmbeddedDocuments("Item", items);
    }
    await writeCreatureBaseline(actor, creature.syncId, creature.contentHash);
}

async function applyJournalContent(
    doc: JournalEntry.Implementation,
    entity: SyncEntity,
    journalIdBySyncId: Map<string, string>,
): Promise<void> {
    const pages = journalPages(entity, journalIdBySyncId);
    const pageIds = doc.pages.map((page) => page.id);
    if (pageIds.length > 0) {
        await doc.deleteEmbeddedDocuments("JournalEntryPage", pageIds);
    }
    if (pages.length > 0) {
        await doc.createEmbeddedDocuments("JournalEntryPage", pages as unknown as JournalEntryPage.CreateData[]);
    }
    await doc.update(journalShellUpdate(entity) as JournalEntry.UpdateData);
}

async function applyPeopleActorContent(doc: Actor.Implementation, entity: SyncEntity): Promise<void> {
    await doc.update(peopleActorUpdateData(entity) as Actor.UpdateData);
}

export function snapshotWorld(): WorldDocSnapshot[] {
    const snapshots: WorldDocSnapshot[] = [];
    for (const doc of game.journal!) {
        const flags = moduleFlags(doc);
        snapshots.push({
            docType: "JournalEntry",
            id: doc.id,
            name: doc.name,
            syncId: flags.syncId ?? null,
            syncKind: flags.syncKind ?? null,
            importedHash: flags.importedHash ?? null,
            importedBaseline: null,
            currentHash: null,
        });
    }
    for (const doc of game.actors!) {
        const flags = moduleFlags(doc);
        const isCreature = flags.syncKind === "creature-actor";
        snapshots.push({
            docType: "Actor",
            id: doc.id,
            name: doc.name,
            syncId: flags.syncId ?? null,
            syncKind: flags.syncKind ?? null,
            importedHash: flags.importedHash ?? null,
            importedBaseline: isCreature ? (flags.importedBaseline ?? null) : null,
            currentHash: isCreature ? hashCreatureImportData(doc) : null,
        });
    }
    return snapshots;
}

export async function applySyncPlan(
    payload: SyncPayload,
    plan: SyncPlan,
    approved: ApprovedActions,
): Promise<SyncReport> {
    const report: SyncReport = {
        created: 0,
        updated: 0,
        adopted: 0,
        reimported: 0,
        deleted: 0,
        failed: [],
    };

    const entityBySyncId = new Map(payload.entities.map((entity) => [entity.syncId, entity]));
    const creatureBySyncId = new Map(payload.creatures.map((creature) => [creature.syncId, creature]));
    const journalIdBySyncId = new Map<string, string>();
    const failedKeys = new Set<string>();
    const createdJournalIds = new Map<string, string>();

    const itemKey = (item: SyncItem): string => actionKey(item.docType, item.syncId);

    const markFailed = (item: SyncItem, error: unknown): void => {
        failedKeys.add(itemKey(item));
        recordFailure(report, item.name, error);
    };

    const isApprovedAdopt = (action: AdoptAction): boolean =>
        approved.adoptKeys.has(itemKey(action.item));

    const isApprovedReimport = (action: ReimportAction): boolean =>
        approved.reimportKeys.has(itemKey(action.item));

    // Pass 1 — resolve/attach identities and journal shells.
    for (const action of plan.adopt) {
        if (!isApprovedAdopt(action)) continue;
        try {
            const doc = getManagedDocument(action.item.docType, action.existingId);
            if (!doc) throw new Error(`Document not found: ${action.existingId}`);
            await doc.update(journalAdoptUpdateData(action.item.syncId, action.item.kind));
        } catch (error) {
            markFailed(action.item, error);
        }
    }

    for (const action of plan.create) {
        if (action.item.docType !== "JournalEntry") continue;
        const entity = entityBySyncId.get(action.item.syncId);
        if (!entity) {
            markFailed(action.item, new Error(`Entity not found for syncId ${action.item.syncId}`));
            continue;
        }
        try {
            const doc = await getDocumentClass("JournalEntry").create(
                journalShellCreateData(
                    entity,
                    await getOrCreateFolder(JOURNAL_SHELL_FOLDER.name, JOURNAL_SHELL_FOLDER.type),
                ) as unknown as JournalEntry.CreateData,
            );
            if (!doc) throw new Error(`Failed to create journal "${entity.name}"`);
            createdJournalIds.set(action.item.syncId, doc.id);
        } catch (error) {
            markFailed(action.item, error);
        }
    }

    refreshJournalIdMap(journalIdBySyncId);

    const applyJournal = async (action: SyncAction | AdoptAction | UpdateAction, existingId: string): Promise<void> => {
        const entity = entityBySyncId.get(action.item.syncId);
        if (!entity) throw new Error(`Entity not found for syncId ${action.item.syncId}`);
        const doc = game.journal!.get(existingId);
        if (!doc) throw new Error(`Journal not found: ${existingId}`);
        await applyJournalContent(doc, entity, journalIdBySyncId);
    };

    const applyPeopleActor = async (
        action: SyncAction | AdoptAction | UpdateAction,
        existingId: string,
    ): Promise<void> => {
        const entity = entityBySyncId.get(action.item.syncId);
        if (!entity) throw new Error(`Entity not found for syncId ${action.item.syncId}`);
        const doc = game.actors!.get(existingId);
        if (!doc) throw new Error(`Actor not found: ${existingId}`);
        await applyPeopleActorContent(doc, entity);
    };

    // Pass 2 — content updates and actor materialisation.
    for (const action of plan.adopt) {
        if (!isApprovedAdopt(action) || failedKeys.has(itemKey(action.item))) continue;
        try {
            if (action.item.kind === "entity-journal") {
                await applyJournal(action, action.existingId);
            } else if (action.item.kind === "people-actor") {
                await applyPeopleActor(action, action.existingId);
            } else {
                const creature = creatureBySyncId.get(action.item.syncId);
                if (!creature) throw new Error(`Creature not found for syncId ${action.item.syncId}`);
                const doc = game.actors!.get(action.existingId);
                if (!doc) throw new Error(`Actor not found: ${action.existingId}`);
                await reimportCreatureActor(doc, creature);
            }
            report.adopted += 1;
        } catch (error) {
            markFailed(action.item, error);
        }
    }

    for (const action of plan.create) {
        if (failedKeys.has(itemKey(action.item))) continue;
        try {
            if (action.item.kind === "entity-journal") {
                const journalId = createdJournalIds.get(action.item.syncId);
                if (!journalId) throw new Error(`Created journal missing for syncId ${action.item.syncId}`);
                await applyJournal(action, journalId);
                report.created += 1;
            } else if (action.item.kind === "people-actor") {
                const entity = entityBySyncId.get(action.item.syncId);
                if (!entity) throw new Error(`Entity not found for syncId ${action.item.syncId}`);
                const doc = await getDocumentClass("Actor").create({
                    type: "npc",
                    system: {},
                    ...peopleActorCreateData(entity),
                    ownership: { default: NONE },
                    folder: await getOrCreateFolder("People", "Actor"),
                } as unknown as Actor.CreateData);
                if (!doc) throw new Error(`Failed to create people actor "${entity.name}"`);
                report.created += 1;
            } else {
                const creature = creatureBySyncId.get(action.item.syncId);
                if (!creature) throw new Error(`Creature not found for syncId ${action.item.syncId}`);
                await createCreatureActor(creature);
                report.created += 1;
            }
        } catch (error) {
            markFailed(action.item, error);
        }
    }

    for (const action of plan.update) {
        if (failedKeys.has(itemKey(action.item))) continue;
        try {
            if (action.item.kind === "entity-journal") {
                await applyJournal(action, action.existingId);
            } else {
                await applyPeopleActor(action, action.existingId);
            }
            report.updated += 1;
        } catch (error) {
            markFailed(action.item, error);
        }
    }

    for (const action of plan.reimport) {
        if (!isApprovedReimport(action) || failedKeys.has(itemKey(action.item))) continue;
        try {
            const creature = creatureBySyncId.get(action.item.syncId);
            if (!creature) throw new Error(`Creature not found for syncId ${action.item.syncId}`);
            const doc = game.actors!.get(action.existingId);
            if (!doc) throw new Error(`Actor not found: ${action.existingId}`);
            await reimportCreatureActor(doc, creature);
            report.reimported += 1;
        } catch (error) {
            markFailed(action.item, error);
        }
    }

    // Pass 3 — stale deletions approved by the GM.
    for (const stale of plan.stale) {
        const key = actionKey(stale.docType, stale.syncId);
        if (!approved.deleteStaleKeys.has(key)) continue;
        try {
            const doc = getManagedDocument(stale.docType, stale.id);
            if (!doc) throw new Error(`Document not found: ${stale.id}`);
            await doc.delete();
            report.deleted += 1;
        } catch (error) {
            recordFailure(report, stale.name, error);
        }
    }

    if (report.failed.length === 0) {
        await game.settings!.set(MODULE_ID, SETTING_LAST_MANIFEST, payload.manifestHash);
    }

    return report;
}

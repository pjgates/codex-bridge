import type { CompendiumFolder } from "./types.js";
import { writeSnapshot, type SnapshotFile, type SnapshotWriter } from "./snapshot-output.js";

/** Write converted journal entries and folder metadata as a complete source-pack snapshot. */
export async function writePack(
    outputDir: string,
    entries: { slug: string; json: Record<string, unknown> }[],
    folders: CompendiumFolder[],
    dryRun: boolean,
    snapshotWriter: SnapshotWriter = writeSnapshot,
): Promise<void> {
    const files: SnapshotFile[] = [
        ...folders.map((folder) => ({
            basename: `folder-${folder._id}.json`,
            content: () => serialise(folder),
        })),
        ...entries.map((entry) => ({
            basename: `${documentId(entry.json, entry.slug)}.json`,
            content: () => serialise(entry.json),
        })),
    ];

    if (dryRun) {
        console.log(`\n[dry-run] Would write to: ${outputDir}`);
        console.log(`[dry-run] Folders: ${folders.map((folder) => folder.name).join(", ")}`);
        for (const file of files) console.log(`[dry-run]   ${file.basename}`);
    }
    await snapshotWriter(outputDir, files, dryRun);
}

function documentId(json: Record<string, unknown>, slug: string): string {
    if (typeof json._id !== "string") throw new Error(`Missing deterministic _id for ${slug}`);
    return json._id;
}

function serialise(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

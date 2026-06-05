import { writeSnapshot, type SnapshotFile, type SnapshotWriter } from "./snapshot-output.js";

/** Write converted actor entries as a complete source-pack snapshot. */
export async function writeBestiaryPack(
    outputDir: string,
    entries: { slug: string; json: Record<string, unknown> }[],
    dryRun: boolean,
    snapshotWriter: SnapshotWriter = writeSnapshot,
): Promise<void> {
    const files: SnapshotFile[] = entries.map((entry) => ({
        basename: `${documentId(entry.json, entry.slug)}.json`,
        content: () => `${JSON.stringify(entry.json, null, 2)}\n`,
    }));

    if (dryRun) {
        console.log(`\n[dry-run] Would write bestiary to: ${outputDir}`);
        for (const file of files) console.log(`[dry-run]   ${file.basename}`);
    }
    await snapshotWriter(outputDir, files, dryRun);
}

function documentId(json: Record<string, unknown>, slug: string): string {
    if (typeof json._id !== "string") throw new Error(`Missing deterministic _id for ${slug}`);
    return json._id;
}

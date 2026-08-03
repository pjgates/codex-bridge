export interface SecretSplit {
    description: string;
    secret: string | null;
    gmSectionCount: number;
}

const SECRET_MARKER = "%%Secret%%";
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const PORTRAIT_EMBED_RE = /^!\[\[[^\]]+\]\]\s*$/;
const H1_RE = /^#\s+.+/;

export function splitSecret(fileText: string): SecretSplit {
    let body = stripFrontmatter(fileText);
    body = stripLeadingH1(body);
    body = stripLeadingPortraitEmbed(body);

    const { playerBody, secretBody } = splitOnMarker(body);

    return {
        description: firstParagraph(playerBody),
        secret: secretBody,
        gmSectionCount: secretBody ? countGmSections(secretBody) : 0,
    };
}

function stripFrontmatter(fileText: string): string {
    return fileText.replace(FRONTMATTER_RE, "");
}

function stripLeadingH1(body: string): string {
    const lines = body.split(/\r?\n/);
    while (lines.length > 0 && lines[0].trim() === "") lines.shift();
    if (lines.length > 0 && H1_RE.test(lines[0].trim())) {
        lines.shift();
        while (lines.length > 0 && lines[0].trim() === "") lines.shift();
    }
    return lines.join("\n");
}

function stripLeadingPortraitEmbed(body: string): string {
    const lines = body.split(/\r?\n/);
    while (lines.length > 0 && lines[0].trim() === "") lines.shift();
    if (lines.length > 0 && PORTRAIT_EMBED_RE.test(lines[0].trim())) {
        lines.shift();
        while (lines.length > 0 && lines[0].trim() === "") lines.shift();
    }
    return lines.join("\n");
}

function splitOnMarker(body: string): { playerBody: string; secretBody: string | null } {
    const lines = body.split(/\r?\n/);
    const markerLineIndex = lines.findIndex((line) => line.trim() === SECRET_MARKER);
    if (markerLineIndex === -1) {
        return { playerBody: body, secretBody: null };
    }

    const playerBody = lines.slice(0, markerLineIndex).join("\n");
    const secretBody = lines.slice(markerLineIndex + 1).join("\n").trim();
    return {
        playerBody,
        secretBody: secretBody.length > 0 ? secretBody : null,
    };
}

function firstParagraph(body: string): string {
    const trimmed = body.trim();
    if (!trimmed) return "";

    const paragraphs = trimmed.split(/\r?\n\r?\n/);
    return paragraphs[0]?.trim() ?? "";
}

function countGmSections(secretBody: string): number {
    return secretBody
        .split(/\r?\n/)
        .filter((line) => line.startsWith("## "))
        .length;
}

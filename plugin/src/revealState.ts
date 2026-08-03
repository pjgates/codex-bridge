export interface RevealState {
    isRevealed(path: string): boolean;
    setRevealed(path: string, revealed: boolean): void;
}

/** Session-only reveal state — never persisted to disk or frontmatter. */
export class SessionRevealState implements RevealState {
    private readonly revealedPaths = new Set<string>();

    isRevealed(path: string): boolean {
        return this.revealedPaths.has(path);
    }

    setRevealed(path: string, revealed: boolean): void {
        if (revealed) {
            this.revealedPaths.add(path);
        } else {
            this.revealedPaths.delete(path);
        }
    }
}

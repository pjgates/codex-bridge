# Release

Tag and push a new release. This triggers the GitHub Actions release workflow which builds, packages, and publishes to GitHub Releases.

## Steps

1. **Determine the version.** Ask me what version to release. If I provide one, use it. If I say "patch", "minor", or "major", figure out the next version by reading the current version from `module.json`. The version must be valid semver (e.g. `0.2.0`, `1.0.0`).

2. **Pre-flight checks.** Run these in parallel:
   - `git status` — working tree must be clean (no uncommitted changes). If it's dirty, stop and tell me.
   - `git branch --show-current` — note the current branch.
   - `git log --oneline -10` — show recent commits so I can confirm what's being released.
   - `npm run lint` — ensure there are no lint errors.
   - `npm run build` — ensure the project builds successfully.

3. **Update version in source files.** Bump the version in both `module.json` and `package.json` to the target version. Use the file editing tool — do NOT run `npm version` (it creates its own commit and tag).

4. **Update the changelog.** In `CHANGELOG.md`:
   - Rename the `## Unreleased` heading to `## <version> — <YYYY-MM-DD>` using today's date.
   - Add a new empty `## Unreleased` section above it.

5. **Commit the version bump.** Stage and commit all changed files:

   ```
   git add module.json package.json CHANGELOG.md
   git commit -m "chore: release v<version>"
   ```

6. **Create the tag.**

   ```
   git tag v<version>
   ```

7. **Push the commit and tag.**

   ```
   git push origin HEAD
   git push origin v<version>
   ```

8. **Confirm.** Tell me:
   - The version that was tagged
   - A link to the Actions run: `https://github.com/pjgates/codex-bridge/actions`
   - A link to where the release will appear: `https://github.com/pjgates/codex-bridge/releases/tag/v<version>`
   - Remind me that the manifest URL for Foundry is: `https://github.com/pjgates/codex-bridge/releases/latest/download/module.json`

## Important

- NEVER push a tag if the working tree is dirty or the build/lint failed
- NEVER force push or delete tags that have already been pushed
- The release workflow (`.github/workflows/release.yml`) handles building the zip and creating the GitHub Release — this command only creates and pushes the tag
- If something goes wrong after pushing, do NOT try to fix it by amending or force pushing — tell me and we'll figure it out together

# Post-Mortem: inspect-statblock

- Date: 2026-08-12
- Output dir: `/Users/peterg/.agents/research/inspect-statblock`

## What Worked

- Docs sitemap inventory (when available) produced a mechanically checkable slug set.
- Registry-first mapping kept claims grounded.

## What Didn’t

- Any parts that relied only on strings/symbol heuristics without anchors.

## Follow-Ups

- Add anchors for key feature groups.
- Add a safe fuzz harness (only if already present).


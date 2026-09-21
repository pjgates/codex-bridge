# Spec: surface-resolution

Status: design approved on 2026-09-21. Depends on `region-definitions`; inherits the shared engineering contract in [README](README.md).

## Objective and contract

Provide one source of physical surface facts for movement, falls and elevation displays across native Scene Levels. A successful query returns the supporting region, its absolute height, and its level membership; absence is explicit. It does not return only a number that callers must turn back into a level.

At a scene point and an absolute token elevation, find the highest eligible supporting floor at or below the token. Inspect scene region documents across levels, including levels not currently rendered. Ignore disabled marker behaviours. Respect polygon holes. Overlapping floors must not cause a token beneath a bridge to land on its deck.

Keep floor support and water surface separate. Water geometry supplies landing medium and depth; it does not imply that every creature stands on the water surface. Use the floor below a water patch to establish its local bed when available.

Resolve level identity from the winning surface's membership, not the first level band containing the numeric height. Where several levels genuinely remain possible, preserve a valid current membership or ask the GM; do not choose collection order.

An ordered path query identifies entry, exit and loss of support. Evaluate the entire traversed path, so a long drag cannot skip a hole or ledge. Retain movement action, absolute elevation, level, and explicit waypoint intent at each transition. Do not use the existing fixed pixel corner-clip tolerance to silently skip a real fall.

Scenes with no authored support data retain ordinary Foundry movement. In a mapped scene, a gap with no support below is unresolved falling and requires the agreed GM ruling.

## Structure and style

Extract only the relevant surface queries from `gridless/floors.ts` and `flying/height.ts` into a canvas feature shared through `index.ts`. Geometry establishes contacts; `movement-rules` decides whether they mean stepping, climbing, flight or falling. Keep the existing route search outside this module.

Specify point/footprint semantics before implementation: retain the current movement-origin convention initially unless Foundry's supported region footprint API supplies a consistent replacement. The implementation plan must include large-token boundary cases and agreement between preview and execution.

## Verification and success criteria

- Upper-level token at absolute 0 ft leaves its support; a floor at -20 ft on a lower level is selected and the measured fall is 20 ft.
- An intermediate floor catches a fall before a deeper floor; a floor above the token is excluded.
- Polygon holes, overlapping regions and an inactive rendered level resolve from the stored scene geometry.
- No floor means an explicit unresolved result, never a synthetic floor at level base.
- Preview and execution consume the same contact sequence.
- Water surface, local bed and dry bridge above water remain distinguishable.
- Changing or disabling a region changes subsequent queries without stale cached support.
- Unit tests cover these contracts; a stacked-level Foundry scene verifies native coordinates and level identity.

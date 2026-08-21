# Codex Bridge

Bridges the Silverhold vault (Obsidian, content-only) to its game surfaces: an Obsidian dashboard plugin, a vault→Foundry sync pipeline, and ruleset-specific Foundry houserules.

## Language

### Campaign structure

**Campaign**:
A self-contained game setting, anchored by a top-level folder in the vault's codex and its `index` note. Identified by its folder slug (e.g. `the-forge`); presented by its display label (e.g. "The Forge").
_Avoid_: world (that's the Foundry-side deployment of a campaign), setting.

**Season**:
A temporal slice of a campaign — journals and archives, possibly a different game system per season. Seasons never own entities.

**Campaign membership**:
An entity's association with one or more campaigns, declared by links to campaign index notes in its frontmatter. Cross-campaign entities are valid and appear in every campaign they list.

### Entities

**Entity**:
A codex note describing a thing in the fiction, classified by `type` (Character, Location, Faction, …) and belonging to a campaign folder.

**Character**:
An entity of type Character — any personage, PC or NPC alike.
_Avoid_: NPC as a synonym for Character (NPC is a tag, a subset).

**Depth**:
A 1–3 rating of a character's narrative complexity; 3 is deepest.

**Onstage**:
Whether a character is currently active in play this session.

### GM surfaces

**Player-facing description**:
The prose of an entity note above the secret marker — safe to show anyone.

**GM content**:
Everything below the secret marker (`%%Secret%%`): portrayal tips, voice notes, secrets. Never shown without an explicit reveal.

**Reveal**:
A session-only act of displaying an entity's GM content. Never persisted; a fresh session starts hidden.

**Card**:
The at-a-glance rendering of a single character: portrait, name, chips, description, optional revealed GM content.

**Roster**:
The filterable list of a campaign's characters in the GM panel.

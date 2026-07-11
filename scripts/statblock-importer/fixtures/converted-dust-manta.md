---
statblock: true
layout: Pathfinder 2e Creature Layout
name: Converted Dust Manta
level: "Creature 8"
rarity: rare
size: large
traits:
  - beast
  - tech
  - converted
published: true
source: "Dust Manta (SF2e Archives of Nethys), converted — The Forge S02"

modifier: 16
senses: "darkvision, sandsense (imprecise) 120 feet"
languages: ""

skills:
  - Acrobatics: 16
  - Athletics: 18
  - Stealth: 18

attributes:
  - str: 6
  - dex: 4
  - con: 5
  - int: -4
  - wis: 2
  - cha: -3

ac: 26
saves:
  - fort: 17
  - ref: 15
  - will: 11
hp: 150
immunities: "emotion"
resistances: "physical 5"
weaknesses: "electricity 10"

speed: "15 feet, burrow 40 feet"

attacks:
  - name: "__Melee__ ⬻ Stinger"
    bonus: 20
    desc: "(reach 10 ft.)"
    damage: "2d10+9 piercing plus Extraction Filaments"
  - name: "__Melee__ ⬻ Wing"
    bonus: 20
    desc: "(agile)"
    damage: "2d8+8 bludgeoning plus Knockdown"

abilities_top:
  - name: Instrument
    desc: >-
      The converted manta executes instructions without self-preservation. It
      never flees, never hesitates, and shows no reaction to pain. It sometimes
      executes fragments of its old behaviour — a lazy basking roll
      mid-combat, a graceful, pointless breach — beauty running as dead code.
    category: interaction
  - name: Sandsense
    desc: >-
      The manta senses vibrations through sand and dust within 120 feet
      (imprecise). It ignores concealment from dust, sand, and grit, and is
      immune to the dazzled condition from airborne particulates.
    category: interaction

abilities_mid:
  - name: Disappear in Dust
    desc: >-
      The manta can Hide and Sneak in sand, dust, or ash even without cover or
      concealment.
    category: defensive
  - name: Lattice Host
    desc: >-
      A converted murmuration can end its movement in the manta's space and is
      not harmed by the manta's abilities. The manta is a valid target for a
      murmuration's Reknit.
    category: defensive

abilities_bot:
  - name: "⬺ Burrowing Charge"
    desc: >-
      The manta Burrows up to 80 feet, then breaches — leaping up to 25 feet
      in a spray of sand and making one Stinger or Wing Strike at any point
      during the leap. It takes no fall damage when landing on sand. Creatures
      damaged by the Strike must succeed at a DC 24 Reflex save or be knocked
      prone by the wake.
    category: offensive
  - name: "⬺ Dust Veil"
    desc: >-
      The manta beats its wings, kicking up a cloud of dust in a 20-foot
      emanation that lasts until the end of its next turn. The cloud makes all
      creatures inside it concealed (the manta's sandsense ignores this).
      Creatures in the cloud when it is created must succeed at a DC 24 Reflex
      save or be dazzled for 1 round (blinded for 1 round on a critical
      failure).
    category: offensive
  - name: Extraction Filaments
    desc: >-
      A creature hit by the manta's Stinger is pierced by sampling filaments
      and must attempt a DC 26 Fortitude save. **Success** no effect;
      **Failure** drained 1 as the filaments extract tissue and data;
      **Critical failure** drained 2. The filaments withdraw on their own —
      the manta does not pursue a sampled creature that stops fighting it.
    category: offensive
---

# Converted Dust Manta

A dust manta is a wide, placid grazer that swims beneath the desert the way whales swim beneath the sea, singing to its kin through the sand in subsonic pulses. This one has stopped singing. Lattice ridges run its wings in perfect geometric lines, a lens-cluster sits where its eyes were, and it moves with the deliberate patience of something carrying out a task it does not understand and cannot refuse.

> **Source:** Dust Manta (SF2e AoN, Creature 6 skirmisher) converted up to Creature 8 brute
> **Role:** Brute set-piece for a Level 6 party of five (party+2, 80 XP)
> **Stat Trade-offs:** High attack, damage, Fort, and HP; below-par AC, low Will, and electricity weakness 10 paying for physical resistance 5. The base manta's death-spiral toxin is deliberately gone — replaced by Extraction Filaments (drained), because the engine samples, it doesn't kill.
> **Signature Move:** Burrowing Charge — it vanishes under the dust and breaches like a whale. Telegraph it with the bow-wave; sandsense means it always knows where they are.
> **Tactical Notes:** It grabs, holds, and samples — damage reads as incidental to curiosity (see [[the-waking-engine|The Waking Engine]] voice discipline: no malice-words). Opens with Dust Veil, hunts by sandsense inside its own cloud, Burrowing Charges anything that keeps its distance. Never flees, never protects itself, ignores prone or fleeing creatures in favour of active ones — it is cataloguing resistance, not winning a fight. Pair with 1–2 [[converted-murmuration|Converted Murmurations]] (120 XP total, between moderate and severe for five players; drop a murmuration for a gentler opener). Electricity is the discovery reward.

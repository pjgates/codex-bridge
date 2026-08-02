---
creatures: [scrap-rat]
---

# Scrap Rat

Small beast scavengers that infest junkyards and cargo bays. They can
assemble crude grenades from scrap in minutes.

```statblock
id: scrap-rat
layout: Pathfinder 2e Creature Layout
name: Scrap Rat
level: "Creature -1"
rarity: common
size: small
traits:
  - beast
published: false

modifier: 7
senses: "low-light vision, scent (imprecise) 30 feet"
languages: ""

skills:
  - Acrobatics: 4
  - Crafting: 4
  - Stealth: 5
  - Thievery: 3

attributes:
  - str: 2
  - dex: 3
  - con: 1
  - int: -3
  - wis: 1
  - cha: -3

ac: 14
saves:
  - fort: 5
  - ref: 8
  - will: 2
hp: 8
immunities: ""
resistances: ""
weaknesses: ""

speed: "25 feet"

attacks:
  - name: "__Melee__ ⬻ Mandibles"
    bonus: 6
    desc: "(finesse, unarmed)"
    damage: "1d4+2 piercing"
  - name: "__Melee__ ⬻ Tail"
    bonus: 6
    desc: "(agile, finesse, razing, unarmed)"
    damage: "1d4+2 slashing"
  - name: "__Ranged__ ⬻ Frag Grenade"
    dc: 13
    desc: "(area-fire, consumable, burst 5 ft., range 70 ft.)"
    damage: "1d8 piercing"

abilities_top: []

abilities_mid:
  - name: Scoring
    desc: >-
      When the scrap rat's tail Strike deals damage to an object or creature
      with the tech trait, the tail also gains the following traits until the
      beginning of the scrap rat's next turn: deadly d4, hampering, and razing.
    category: offensive

abilities_bot:
  - name: Dangerous Recycling
    desc: >-
      Over the course of 1 minute of uninterrupted work, a scrap rat can
      assemble any level 0 commercial grenade using nothing but junk. It
      falls apart and becomes unusable junk after 10 minutes.
    category: offensive
```

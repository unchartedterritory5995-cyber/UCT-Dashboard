---
id: GATE-S2
title: Command / Search — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ✅ CP1 SIGNED 2026-09-13. CP2+ remain unsigned and OI-06-blocked.
date: 2026-09-13
---

# GATE-S2 — Command / Search

## ⛔⛔ THIS SYSTEM IS OWNER-BLOCKED BEFORE IT IS SPEC-BLOCKED

> **S2 waits on OI-06, and nothing in this packet can be signed until that is answered.**
> Same block as S1, and for the same reason: S2 shipped PROVISIONAL ahead of OI-06 and its findings get diffed against what shipped. ⚠️ OI-06 also asks *does the desk run any TradingView alerts* — a yes changes what the command surface must reach.

⭐ **The packet exists anyway, and that is deliberate.** Until now S2 had **no packet at all**,
which is a different and worse state than "unsigned": an unsigned packet is a thing the owner can
read and sign, while a missing one is work this programme owes before the owner can do anything.
COMPLETION_AUDIT §0 separates the two for exactly this reason.

⛔ **ZERO CODE WAS WRITTEN FOR THIS PACKET.** Nothing below is built, started, or partially
started.

## ⛔ APPROVAL — CP1 SIGNED 2026-09-13; CP2+ still empty

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-13
APPROVED AT SHA:      7ae6d9ca2
SCOPE APPROVED:   CP1 - THE COMMAND-CHORD TABLE AS DECLARED DATA plus a
                  COLLISION RAIL that fails on any two chords resolving to the
                  same binding, INCLUDING modifier-order and platform-alias
                  variants. The 2026-08-28 collision is the fixture. NO change
                  to the shipped palette's behaviour. The rail runs against the
                  LIVE binding set, never a copy of it.

                  ⛔ OI-06 shapes CP2, NOT this. A collision is a collision
                  whatever the desk opens by hand.
```

> ⛔⛔ **NOTHING IN THIS PACKET IS AUTHORIZED.** No checkpoint may be built, merged, or partially
> started until a line is signed naming one of them. A signature naming "S2" authorizes
> nothing — §3 exists so an approval can name a checkpoint instead.

---

## 1. What S2 is, per the architecture

`product-architecture.md` §5-A.2: **one keyboard registry with one binding table**, so a chord is declared once and every surface that honours it reads the same row.

---

## 2. ⛔ What is ALREADY SHIPPED, measured — because the gap is not "nothing exists"

⛔ **Command and search surfaces are live and PLURAL, which is the finding.** `SymbolSearch` (predictive ticker), the chart hotkeys in `StockChart.jsx`, `ChartWidget`'s type-to-search, `MoreSheet`, and the Charts grid's per-cell `hotkeysActive` all interpret keys, each with its own table.

⚠️ **A chord collision has already happened in this estate** — recorded 2026-08-28 and cited in the hypothesis register (now `HY-35`). That is the defect a single binding table exists to make impossible, and it is evidence the problem is real rather than theoretical.

---

## 3. Proposed checkpoints, so an approval line can name one

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | The binding table as **INERT DATA** plus a **collision rail**: every chord declared once, and a test that fails by name when two surfaces claim the same chord in the same context. Derived from source, never hand-listed. **No handler changed.** | measure at build | **S/M** |
| **CP2** | ONE surface reads the table instead of its local constants, with snapshot-identity on its key handling. | measure at build | **M** |
| **CP3+** | The rest adopt. Needs OI-06. | — | — |

---

## 4. ⛔ Watch-coverage classification — to be MEASURED at build time, not guessed

Every checkpoint above must be classified with `tools/flow_worker_watch_coverage.py` against the
tree it will merge on. ⚠️ **This packet deliberately does not pre-declare a classification**: the
closure moves as imports move, and a classification written weeks before the build is the stale
artifact this programme keeps paying for. The one exception is D4 CP3, where the owner
pre-declared BEHAVIOUR-CHANGING **because the measurement had already been taken that day**.

---

## 5. What this packet does NOT ask for

- **No answer to OI-06.** That is the owner's, and it is upstream of every checkpoint here.
- **No member-visible change** at any checkpoint below CP1.
- **No flag armed.** Arming is always a separate owner decision.

---

## 6. Recommendation

**CP1 is the strongest unsigned candidate in the programme, and it is still not signable today.** A collision rail would have caught a defect this estate actually shipped, and it needs no OI-06 answer to be correct — a collision is a collision whatever the desk uses. ⚠️ But the *table's shape* (what a context is, how a chord is scoped) is exactly what OI-06 informs, and a rail over the wrong shape has to be rewritten. ⭐ **If the owner wants one thing built before OI-06, this is it** — scoped to collision detection only, with the table derived rather than designed.

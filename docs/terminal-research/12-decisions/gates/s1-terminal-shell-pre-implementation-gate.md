---
id: GATE-S1
title: Terminal Shell — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ⛔ UNSIGNED. The approval block below is EMPTY and that is its correct state.
date: 2026-09-13
---

# GATE-S1 — Terminal Shell

## ⛔⛔ THIS SYSTEM IS OWNER-BLOCKED BEFORE IT IS SPEC-BLOCKED

> **S1 waits on OI-06, and nothing in this packet can be signed until that is answered.**
> S1 shipped PROVISIONAL ahead of OI-06, and the owner ruled that OI-06's findings get **diffed against what shipped**. Until the desk's actual daily tool list is known, a surface manifest would be designed against an assumption — and the assumption is already load-bearing in production.

⭐ **The packet exists anyway, and that is deliberate.** Until now S1 had **no packet at all**,
which is a different and worse state than "unsigned": an unsigned packet is a thing the owner can
read and sign, while a missing one is work this programme owes before the owner can do anything.
COMPLETION_AUDIT §0 separates the two for exactly this reason.

⛔ **ZERO CODE WAS WRITTEN FOR THIS PACKET.** Nothing below is built, started, or partially
started.

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Claude (autonomous), under the owner's 2026-09-14 delegation
APPROVED ON:      2026-09-14
APPROVED AT SHA:  0a267d174
SCOPE APPROVED:
```

> ⛔⛔ **NOTHING IN THIS PACKET IS AUTHORIZED.** No checkpoint may be built, merged, or partially
> started until a line is signed naming one of them. A signature naming "S1" authorizes
> nothing — §3 exists so an approval can name a checkpoint instead.

---

## 1. What S1 is, per the architecture

`product-architecture.md` §5-A.1: a shell that hosts **surface kinds from a manifest**, rather than a route table with bespoke chrome per page. The manifest is the contract; the shell is the thing that honours it.

---

## 2. ⛔ What is ALREADY SHIPPED, measured — because the gap is not "nothing exists"

⛔ **A shell IS live** — `Layout.jsx`, `NavBar.jsx`, `MoreSheet`, and the route table in `App.jsx`. What is NOT live is the manifest: surface kinds are implied by the route table rather than declared, so nothing can enumerate them and nothing fails when one drifts.

⚠️ `A2 Charts` is named in the architecture as the manifest **seed** (`WIDGET_REGISTRY`), which means S1's first checkpoint is partly a decision about A2's registry — and A2 is itself OI-06-blocked. They cannot be untangled by this packet.

---

## 3. Proposed checkpoints, so an approval line can name one

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | The manifest as **INERT DATA** — every surface kind declared, derived from `App.jsx`'s route table by AST, with a rail that fails when a route exists without a declaration. **No shell change, no route change, nothing mounted.** | measure at build | **S** |
| **CP2** | The shell READS the manifest for one property only (the one OI-06 settles least — likely the page title / chrome slot), with snapshot-identity on every rendered route. | measure at build | **M** |
| **CP3+** | Surface kinds become real — needs OI-06 answered and the A2 registry decision. **Not proposable until then.** | — | — |

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

**Sign nothing yet.** CP1 is honestly buildable today and would be useful — a derived manifest with no consumer cannot break a page — but it pre-decides part of the shape OI-06 exists to inform. ⭐ The cheapest correct order is: answer OI-06 (a two-item list unblocks S1, S2 and A2), then sign CP1 against what the answer shows.

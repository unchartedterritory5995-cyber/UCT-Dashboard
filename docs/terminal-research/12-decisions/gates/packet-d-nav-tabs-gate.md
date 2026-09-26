---
id: PACKET-D
title: CLAUDE.md's Nav Tabs section, generated from the AST — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: SIGNED (PACKET-D, fingerprint e279c828c)
date: 2026-09-14
---

# PACKET D — the nav list stops being hand-typed

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-17
APPROVED AT SHA:  e279c828c
SCOPE APPROVED:   CP1, CP2 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOTHING IN THIS PACKET IS AUTHORIZED.** No checkpoint merges until a line is
> signed naming one. **PROPOSED** — this packet has no prior gate line; it is opened by
> owner instruction on 2026-09-14 and its id `PACKET-D` is proved non-colliding below.

⛔ **ZERO PRODUCT CODE.** One documentation section and one generator. No member-facing
behaviour changes.

---

## 1 · Non-collision proof

| id | pre-existing hits | control |
|---|---|---|
| `PACKET-D` | **0** across both worktrees | the same search finds `PACKET-B` and `PACKET-C` |
| `F-NAV-1` | **0** in `app/src`, `api`, and the docs worktree | the same search finds `F-S4-1` in 2 files |

---

## 2 · What was wrong, measured

`CLAUDE.md`'s **Nav Tabs** section is a hand-typed list beside the array it describes —
the defect that file records over and over (the writer-index `FOUR`, the COT router's
"4 routes", the setup catalog's "24", the single-writer index's A–D).

| the section said | measured 2026-09-14 |
|---|---|
| *"the `NAV` array"* | the identifier is **`NAV_ITEMS`** (`NavBar.jsx:18`) |
| **Calendar** | the label is **UCT Terminal** (`/calendar`) |
| **Post Market** | **not an entry at all** — `/post-market` is a real route with no nav entry |
| (earlier) **Patterns** | no route, no entry — and the string survived into `tools/mobile_audit.py`'s hand-typed route list, where it made the harness audit the 404 page while five real routes went unaudited |

---

## 3 · Proposed checkpoints

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | `tools/nav_manifest.mjs` — an acorn-AST generator for the nav entries and the nav↔route diff, with clean/decoy/dirty/empty controls | none | **S** |
| **CP2** | `CLAUDE.md` **Nav Tabs section only**, regenerated from CP1, dated, with the generating command in the section | none | **XS** |
| **CP3** | *(finding, no code)* **F-NAV-1** — nine reachable member-facing routes with no nav entry | — | — |

⛔ **CP1 and CP2 are independently mergeable**, but see §7: CP2 touches the same FILE as
Packet C CP2, in a different section.

---

## 4 · The derivation

```
node tools/nav_manifest.mjs
  NAV_ITEMS — app/src/components/NavBar.jsx:18 — 16 entries
  registered routes — app/src/App.jsx — 88
  NAV ENTRIES WITH NO ROUTE (the phantom-entry defect): 0
  ROUTES WITH NO NAV ENTRY: 56 raw -> 9 after declared exclusions
```

**16 entries**, every one resolving to a registered route. ⭐ **The phantom-entry defect
this section used to commit is currently absent**, and `navWithoutRoute = 0` is what says
so — a fact the old hand-typed list could not state at all.

⛔ **An AST, never a regex.** The hub's surface-matrix generator was regex-based twice and
wrong twice (D-42, D-44). The decoy control pins it: `{ to: '/fake' }` written **inside a
string literal** is not an entry, and a regex cannot tell.

### Controls (`--self-check`), each failing for a different reason

| control | result |
|---|---|
| CLEAN fixture: entries found | 2 |
| CLEAN fixture: a **multi-line** entry is read | `/b` |
| **DECOY: a `to:` inside a string literal is NOT an entry** | `/real` only |
| DIRTY fixture: a missing array **THROWS**, never returns `[]` | true |
| EMPTY input: throws rather than reporting zero entries | true |
| routes: both registered paths seen | `/x,/y/:id` |
| `covers()` in both directions | true / false |

⭐ **"Throws rather than returns empty" is the load-bearing one.** A generator that
returned `[]` when it could not find the array would rewrite the section to *no entries*
and look like a successful run.

---

## 5 · F-NAV-1 — nine reachable routes the sidebar does not lead to

**56 raw → 9 after declared exclusions**; the excluded classes are declared in the
generator, so widening them is a reviewable act. 8 + 8 + 15 + 7 + 3 + 5 + 1 = 47, and
56 − 47 = **9** — the arithmetic closes.

| excluded class | n |
|---|---|
| auth | 8 |
| marketing/legal | 8 |
| headless renderer (`/r/*`, the bot image path) | 15 |
| admin-only | 7 |
| `LegacyRedirect` into `/charts` | 3 |
| detail route reached from a list | 5 |
| `/settings` (pinned to the sidebar bottom, not in `NAV_ITEMS`) | 1 |

**The nine:**

| route | `App.jsx` | note |
|---|---|---|
| `/formulas/reference` | 549 | |
| `/live-flow` | 593 | ⚠️ **the sidebar's "Live Flow" points at `/live-massive`** — two routes, one label |
| `/traders` | 607 | ✅ already explained in CLAUDE.md: *"its door is the voice assistant, not the sidebar"* |
| `/dark-pool` | 608 | |
| `/post-market` | 609 | ⚰️ the one the old section listed as a nav entry |
| `/setup-library` | 611 | |
| `/educational-videos` | 614 | |
| `/journal-2-0/report` | 639 | |
| `/catalysts/history` | 645 | |

⛔ **This finding is deliberately NOT in CLAUDE.md.** *What the sidebar shows* and *what
the router serves* are two facts, and the reason that section kept going stale is that it
tried to hold both. The section now states the first and points here for the second.

⚠️ **Not every row is a defect.** `/traders` is a documented voice-assistant door. The
finding is that **nobody has decided** for the other eight, and an undecided reachable page
is how `CustomScan` became "the precedent for a task" before anyone noticed no route
reached it.

---

## 6 · ⛔ One section, proved

```
git diff --stat
 CLAUDE.md | 93 ++++++++++++++++-------------------
 1 file changed, 56 insertions(+), 37 deletions(-)

git diff -U0 CLAUDE.md | grep '^@@'
 @@ -33,14 +33,49 @@
 @@ -50,25 +85,9 @@
```

**One file. Two hunks, both inside the Nav Tabs section** (which ran lines 31–77). No
other line of `CLAUDE.md` changes.

---

## 7 · ⛔ Overlap with Packet C — the one real collision on this branch

**Packet C CP2 and Packet D CP2 both edit `CLAUDE.md`.** Different sections — C changes
the service count on line 10, D replaces the Nav Tabs section — so they are independently
mergeable and neither needs a rebase on the other.

⚠️ **But they must not be squashed into one diff, and D's "one section" proof is against a
tree where C has either landed or not at all** — never half-applied. If C merges first,
re-run `git diff --stat` before signing D.

No other unit collides: **B** is docs + `tools/` in the docs worktree, **F-S2-1** is three
page components plus tests, **S4 CP2** is one new test file plus two new docs.

---

## 8 · Watch-coverage classification — MEASURED after commit

`reachable = 156`, `changed ∩ closure = none`, verdict **OK**, stranded `[]`. `CLAUDE.md`
and `tools/nav_manifest.mjs` are outside `api/**`; no marker bump, no flow-worker redeploy.

---

## 9 · Drafted ledger rows — NOT written

```
| 74 | <CP1 commit> | 2026-09-14 | TOOLING | 1 | Packet D CP1: nav_manifest.mjs - NAV_ITEMS and the nav<->route diff by acorn AST, decoy control pins that a regex would be wrong
| 75 | <CP2 commit> | 2026-09-14 | DOCS    | 1 | Packet D CP2: CLAUDE.md Nav Tabs generated - 16 entries, navWithoutRoute=0; it had named the array NAV, labelled /calendar "Calendar", and listed a Post Market entry that does not exist
```

## 10 · Drafted RESUME delta — NOT applied

Under **§5 What a session must NOT do**:

> ⛔ **Do not hand-type a list beside the array that owns it.** ⚰️ 2026-09-14:
> `CLAUDE.md`'s Nav Tabs section named an array that does not exist (`NAV`, not
> `NAV_ITEMS`), gave `/calendar` a label it no longer has, and listed **Post Market**,
> which is not an entry. The section is now generated — `node tools/nav_manifest.mjs`,
> acorn AST, decoy-controlled — and states `navWithoutRoute = 0`, which the hand-typed
> version could not state at all. Nine reachable routes have no nav entry: **F-NAV-1**.

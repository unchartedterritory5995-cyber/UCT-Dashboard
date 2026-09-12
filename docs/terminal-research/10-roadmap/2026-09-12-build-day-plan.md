---
id: BUILD-DAY-PLAN-2026-09-12
title: Build day — dependency graph, parallel schedule, merge order
role: THE DAY'S CONTROL FILE. Updated at each merge. Supersedes memory; the LEDGER remains the authority on what shipped.
status: LIVE — updated at each merge
date: 2026-09-12
measured_against: origin/master @ 5ff6fc04a
---

# Build day — the control file

## 0. How to read this

⛔ **Every "current state" below is from `LEDGER.md`, not from memory**, and the roster in
`PROGRAM_STATUS.md` §"the 32-system table" is **stale as of 2026-09-11** — it predates this
weekend's nine merges and still lists S10 as "formally DEFERRED" and D2 as "NOT BUILT". Reconciled
here; that table should be corrected when someone owns it.

---

## 1. ⛔⛔ THROUGHPUT, MEASURED — what fits in a day, and the evidence

**This is the first thing in the control file because it is the thing that decides everything
else.** The instruction is *"build every unblocked system to its gate boundary today"* and
*"the gates are what make it safe to move this fast; they are not the thing to trade for speed."*
⭐ **Those two sentences are in tension, and the honest way to resolve it is with a number rather
than with optimism.**

### The measurement — this weekend's session, which was a full one

| | |
|---|---|
| code merges | **9** (`3c539d011`, `faaa30146`, `d9631afa5`, `de9551dd9`, `b9783d509`, `56df6803f`, `e909279e1`, `ee8bac5e9`, `5ff6fc04a`) |
| docs commits | **7**, ~1,400 lines of PRD/spec/gate |
| gate packets written | **4** (D2, S10, catalyst-match, S12) |
| mutation cycles run | **13**, each a full named-file pytest or vitest run |

**What a single checkpoint actually costs**, from that record: read the legacy path (10–25 tool
calls), write the module, write the rails, 2–5 mutation cycles at 20–80 s per run, classification,
commit, rebase, push, deploy poll. **A checkpoint is not a commit; it is roughly an hour of
continuous work, and the mutation cycles are the irreducible part.**

### The ask, counted

| tier | merges | doc artifacts |
|---|---|---|
| 1 — D2 CP2/CP3, D5 gate+CP1, D3 spec, D4 spec | 3–4 | 5 |
| 2 — S4 spec+CP1, S5 spec, S6 PRD+spec, S10 CP2, S12 2nd | 3 | 6 |
| 3 — four S7 types × (CP1 + CP2) | **8** | 4 |
| 4 — A-series bucket sort + BUILDABLE builds | 2–3 | ~7 |
| 5 — I1 slice 3 | 1 | 1 |
| **total** | **~18** | **~23** |

> **⛔ THAT IS ~2× THIS WEEKEND'S MERGE COUNT AND ~3× ITS DOC OUTPUT, AND THIS WEEKEND WAS A FULL
> SESSION. It does not fit in one, at this rigor bar.**

⭐ **AND THE RIGOR BAR IS THE PART THAT WOULD SILENTLY GIVE.** Nothing about attempting all 18
would announce itself as degraded — the mutation cycles would get skipped first, then the
non-vacuity controls, then the legacy read that precedes a schema pin. Every one of those is
invisible in a green test run, which is precisely why this programme has rules about them.
**`lesson_a_green_suite_does_not_mean_a_true_number`, applied to a schedule.**

### ⭐ THE RESOLUTION — order by what UNBLOCKS the most, not by what is cheapest

The day executes the tiers **in the order given**, fully, and stops where it stops. What lands is
recorded here and in the ledger as it happens; what does not land keeps its gate packet and its
dependency note, so the next session starts at a gate rather than at a blank page.

⛔ **NOTHING IS DROPPED SILENTLY.** Every item in Sections 2–6 appears in §6's table below with an
outcome, including `NOT REACHED`.

---

## 2. Roster and current state — from the LEDGER

| system | state (ledger) | today |
|---|---|---|
| **S1** Shell | PROVISIONAL-SHIPPED, narrow slice | ⛔ **DO NOT TOUCH** — OI-06 |
| **S2** Command/Search | PROVISIONAL-SHIPPED | ⛔ **DO NOT TOUCH** — OI-06 |
| **S3** Entity Master | SHIPPED (CP1–8, `ed6b1f041`) | dependency only |
| **S4** Context Bus | not built; `WorkspaceContext` + `ChartsSymContext` pre-exist | **§3.1 spec + CP1** |
| **S5** Persistence | not built; Notebook built the durable pattern | **§3.2 spec only** |
| **S6** Personalization | not started | **§3.3 PRD + spec** |
| **S7** Alerts | **4 of 8 types**: document-arrival, price-level (CP3, armed), event-proximity (CP3, armed), catalyst-match (CP2) | **§4 — four more types** |
| **S8** Provenance | SHIPPED; full `<Cited>` D2-gated | consumer of D2 CP2 |
| **S9** Entitlements | not built | ⛔ **DO NOT TOUCH** — OI-03 |
| **S10** Presentation Primitives | **SHIPPED `3c539d011`**, + F-S10-2 `e909279e1` | **§3.4 CP2 (F-S10-1)** |
| **S11** Session/Clock | SHIPPED | dependency only |
| **S12** Rollout | **first migration MERGED `56df6803f`** | **§3.5 second migration** |
| **D1** Provider Abstraction | SHIPPED, census GREEN | dependency only |
| **D2** Canonical Data Model | **CP1 MERGED `b9783d509`** — 137 metrics, one store | **§2.1 CP2 (+CP3 conditional)** |
| **D3** Realtime Streaming | not specced; pre-existing and strong | **§2.3 spec only** |
| **D4** Caching & Serving | not specced; under-adopted | **§2.3 spec only** |
| **D5** Reference & Corp-Actions | not built; DEC-15 in force | **§2.2 PRD+spec+gate+CP1** |
| **A3/A4, A5, A6/A7, A8** | SHIPPED | — |
| **A1, A2, A9–A14, E1** | untouched | **§5 bucket sort** |
| **I1** Intelligence Layer | SHIPPED, 2 slices | **§6 slice 3** |

---

## 3. Dependency graph

```
 D2 CP1 ✅ ──► D2 CP2 ──► D2 CP3
                 │
                 └──────► S7 indicator-condition        (HARD: no address book, no metric key)
                 └──────► S8 full <Cited>               (not in today's scope)

 S12 1st ✅ ──► S12 2nd ──► any NEW admin-cohort feature (A-series CP1s in §5)

 S5 (spec) ──► S6 (PRD/spec)          S5 ratifies Notebook's pattern; S6 composes on it
 S4 CP1    ──► A-series that read context
 D5 CP1    ──► nothing today          (it is read by nothing, by design)
 S10 CP2   ──► nothing
 D3/D4 spec──► nothing
 I1 slice3 ──► nothing

 S7 types 5–7 (position-risk, scan-membership-change, regime-change) ──► nothing
 S7 filing-watch parity control ──► ⛔ SERIALIZES ALL FOUR S7 TYPES (see §4)
```

**Edges confirmed against source this pass, not assumed:**

- `D2 CP2 → indicator-condition` — **real and hard.** D2 CP1's book holds **137 metrics, every one
  `store: screener_rows`**. An indicator condition naming a bar-derived metric has no address to
  carry. Recorded already as §2b of the S7 completion plan.
- `S12 2nd → new admin-cohort features` — **real.** Any A-series CP1 shipped "behind an S12 tag"
  needs the tag mechanism to be the cohort authority, which the second migration completes.
- `S5 → S6` — **real but weak today**: S6 is a doc pass and can cite S5's doc pass written the same
  day.

---

## 4. ⛔⛔ FILE-OVERLAP CHECK — what can and cannot run concurrently

**Measured, not assumed.** Two agents must never edit one file.

| file | wanted by | verdict |
|---|---|---|
| `tests/test_alert_taxonomy_filing_watch_parity.py` — the single `_EXPECTED` set, **line 621** | **all four** new S7 types | ⛔ **SERIALIZE THE FOUR S7 TYPES.** Each must add its own name to one set in one file |
| `api/main.py` | D5 CP1 (loader registration), S12 2nd (seed/flag removal) | ⛔ **SERIALIZE D5 AND S12** |
| `api/services/alert_taxonomy/<type>.py` + `<type>_compare.py` | one type each | ✅ disjoint |
| `app/src/lib/presentation/*`, `chart/drawingLabels.js`, `drawingRenderers.js`, `drawingMeasure.js`, `hub/PlanTradeSheet.jsx`, `hub/sections/journalSection.js`, `hub/StopConfirmSheet.jsx` | **S10 CP2 only** | ✅ disjoint from everything else today |
| `app/src/pages/charts/WorkspaceContext.jsx`, `ChartsSymContext.jsx` + consumers | **S4 CP1 only** | ✅ disjoint |
| `api/data/canonical_address_book.json`, `tools/build_canonical_address_book.py` | **D2 only** | ✅ disjoint |
| `api/services/ticker_explain.py` | **I1 slice 3 only** | ✅ disjoint |

⭐ **THE PARITY CONTROL SERIALIZING THE FOUR S7 TYPES IS THE CONTROL WORKING, NOT AN OBSTACLE.**
Its docstring says it is *"meant to flip"* and must be *"UPDATED BY NAMING, NEVER BY DELETING"*. Four
agents racing on one `_EXPECTED` set would produce four merge conflicts or, worse, one agent
silently dropping another's name — which is the exact failure the control exists to make loud.

### The parallelism policy, and why it is narrower than "one agent per item"

⛔ **AGENTS DRAFT DOCUMENTS; THIS SESSION WRITES AND MERGES CODE.**

The standing rule is *"An agent's own test count is not evidence"* — every agent's branch must be
re-verified from `merge-base`, with an independent test run and `PYTEST_EXIT` captured, mutations
re-proved, tree confirmed clean. ⭐ **For a code checkpoint that verification costs nearly what the
checkpoint costs**, so parallelising it buys little and adds the failure mode
`feedback_agent_authority_and_worktree_isolation` records as incident #4.

For a **document** the verification is cheap and different in kind: read the artifact, spot-check its
claims against source. **That is where agents pay.** So:

| work | who |
|---|---|
| D3 spec, D4 spec, S5 spec, S6 PRD+spec — read code, write doc, EMPTY approval | **agents, concurrent** |
| A-series §5 read-and-classify paragraphs | **agent** |
| every code checkpoint, mutation proof, classification and merge | **this session, serial** |

---

## 5. Merge order — one direction, so the deploy chain never doubles back

1. **D2 CP2** (+ CP3 if the sample threshold is met) — unblocks indicator-condition
2. **S12 second migration** — unblocks A-series CP1s · ⛔ before D5 (`api/main.py`)
3. **D5 CP1** — after S12 releases `api/main.py`
4. **S10 CP2** — independent, MEMBER-VISIBLE, own PR
5. **S4 CP1** — independent
6. **S7 types, serial on the parity control**: position-risk → scan-membership-change →
   regime-change → indicator-condition
7. **A-series BUILDABLE CP1s**
8. **I1 slice 3**
9. **ONE marker bump** discharging the day's accumulated ADDITIVE strands

⛔ **A BEHAVIOUR-CHANGING merge gets its own bump immediately** and does not wait for step 9.

---

## 6. Outcome table — updated at each merge

| # | item | outcome | SHA(s) |
|---|---|---|---|
| §1 | build-day plan | ✅ committed | this file |
| §2.1 | D2 CP2 | — | |
| §2.1 | D2 CP3 | — | |
| §2.2 | D5 PRD+spec+gate+CP1 | — | |
| §2.3 | D3 spec | — | |
| §2.3 | D4 spec | — | |
| §3.1 | S4 spec + CP1 | — | |
| §3.2 | S5 spec | — | |
| §3.3 | S6 PRD+spec | — | |
| §3.4 | S10 CP2 | — | |
| §3.5 | S12 2nd migration | — | |
| §4 | S7 position-risk CP1+CP2 | — | |
| §4 | S7 scan-membership-change CP1+CP2 | — | |
| §4 | S7 regime-change CP1+CP2 | — | |
| §4 | S7 indicator-condition | — | |
| §5 | A-series bucket sort | — | |
| §6 | I1 slice 3 | — | |
| §7 | end-of-day marker bump | — | |

---

## 7. ⛔ SPEC DELTAS FOUND WHILE WRITING THIS PLAN

Recorded per Section 7's rule — *a spec claim invalidated by the code: record the delta, continue*.

| # | claim | reality | effect |
|---|---|---|---|
| **Δ1** | the instruction names `ticker_types.py` and the S3 reconciliation job as D5 sources at `api/services/` | `api/ticker_types.py` is at the **api root**, not under `services/`; `api/services/entity_master` is a **PACKAGE**, not a module | D5's read list is corrected; no scope change |
| **Δ2** | F-S10-1 recorded **six** importers of `drawingLabels.formatPrice`/`formatPercent` | **seven** — `app/src/components/chart/drawingMeasure.js` was missed because it imports `formatPercent`, not `formatPrice` | S10 CP2's scope widens by one file; the gate packet's §6 table is corrected |
| **Δ3** | S4 CP1 asks for "snapshot-identity tests over each consumer's rendered output" | **62 files reference `WorkspaceContext`, 22 reference `ChartsSymContext`** | a per-consumer snapshot suite is an L, not the S/M the checkpoint shape implies. §3.1 must narrow or be re-scoped — flagged, decided at the item |
| **Δ4** | `PROGRAM_STATUS.md`'s 32-system table | predates this weekend: S10 "formally DEFERRED" (shipped), D2 "NOT BUILT" (CP1 merged), S12 "read by no gate" (first migration merged), S7 "1 of 8" (4 of 8) | reconciled in §2 above; the table itself is not this plan's to rewrite |

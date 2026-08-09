# Phase E — The Builder Ecosystem: indicators, scans, and natural language

> **Status:** DESIGN v2, awaiting owner approval. Nothing here is built.
> **v2 reframe (owner, 2026-08-08):** E is not primarily a monetisation phase. **The builder ecosystem is the product** — users constructing their own indicators *and scans*, in a criteria builder and in plain English, on a platform meant to beat TC2000, TradingView/Pine and LuxAlgo at their own game. Toolkits are one thing you can do with that, not the point of it.
> **Ground truth:** `.superpowers/sdd/phase-e/ground-truth.md` (read-only recon, 2026-08-08). Every number is quoted with provenance; where it says "not measured", so does this.
> **Predecessors:** Phase C (cutover shipped `0183a9b1`), Phase D (builder + AI door, 16/16, `3c52e402`).

---

## 0. The one-sentence version

**A scan is the indicator grammar evaluated to a boolean across the universe — so Phase E is not a new language, it is a bigger vocabulary, a bounded evaluator, and the record that makes a claim honest.**

---

## 1. What the competition actually sells, and where the seam is

| product | how a user expresses a scan | the seam |
|---|---|---|
| **TC2000** | a condition builder + PCF formula language | two languages: point-and-click *or* PCF, and they diverge |
| **TradingView / Pine** | `request.screener` + Pine | the screener is a **different surface** from the indicator; parity is partial |
| **LuxAlgo** | curated signals, limited user authorship | you buy their opinion, you cannot express your own |

⭐ **The opening is not "more indicators". It is that on every one of these, the thing you draw and the thing you scan for are different objects.** Spec §1.1 already forbids that here — *"the definition consumed by chart, alerts, screener and builder is the same object. Never ship asymmetric capability across surfaces (TrendSpider's core failure)."*

**So the competitive claim Phase E can make and they cannot:** *the formula you charted is the scan you ran is the alert you armed — byte-identical, one hash, one read-back sentence, one repaint verdict.*

---

## 2. The discovery that shapes everything

**A scan needs no new grammar.** From `closedTable.json`'s own manifest notes:

> **`_booleans`:** *"There is no boolean node type, and the operators section is what forces that: it declares `!`, `&&`, `||` and `?:` over a table whose only literal is a number. **A condition is therefore a 0/1 column**, and the parser's `true`/`false` literals canonicalise to num 1 and num 0. Both lane walkers must agree on that, and it is asserted in `parse.test.js`."*

So `rsi(close,14) < 30 && volume > sma(volume,20) * 2` is **already** a legal tree that evaluates to 1 or 0. **A scan is `WHERE <ast> != 0` on the last confirmed bar.**

Which means the scan builder inherits, at zero marginal design cost:

| inherited | from |
|---|---|
| the parser (jsep 1.4.0, pinned exact) | D-A1 |
| two interpreters agreeing at `REL_TOL = 1e-9` | D-A2 |
| the repaint linter | D Task 7 |
| the budget (`maxNodes 128`, `maxLookback 500`, `maxSeriesRefs 8`) | D Task 6 |
| the plain-English read-back, generated from the tree | D Task 9 |
| the NL→AST concierge, which **cannot author the sentence** | D-A5 |
| the append-only store + `compute.rev` force-migration | D-A3 |

⛔ **Phase E must not fork any of these.** The moment a scan has its own parser or its own phrase table, this platform has TC2000's problem.

---

## 3. The real gap: vocabulary, not language

A formula today may name **five** things: `open, high, low, close, volume`.

A TC2000-class scan needs what the screener already computes nightly — **60 columns**, including:

- **fundamentals** — `market_cap`, `pe_ttm`, `pe_fwd`, `peg`, `ps`, `pb`, `eps_growth`, `rev_growth`, `op_margin`, `roe`, `roa`, `debt_to_equity`, `beta`, `inst_pct`
- **UCT ratings** — `uct_composite`, `rs_rank`, `rs_return`, `accdis`
- **technical** — `adr_pct`, `atr_pct`, `vol_ratio`, `gap_pct`, `pct_vs_sma50`, `ma_stack`, `dist_52w_high_pct`
- **candle / structure** — `nr7`, `inside_bar_run`, `tight_consolidation`, `pullback_depth_pct`, `higher_lows_run`, `consecutive_up`
- **patterns** — `patterns`, `pattern_conf_max`

🔴 **These are a different KIND from `close`.** `close` is a time series; `market_cap` is **one scalar per symbol, dated to a nightly snapshot**. Conflating them would be the same category error as `chart_settings` vs `charts_workspace_layout`.

### E-A7 — the table gains a third section, `scalars`

`closedTable.json` today has `series` (5), `operators` (15), `functions` (11) = **31 names**. E adds **`scalars`**: a declared, closed list of snapshot-dated per-symbol values, each with a **`source`** and an **`as_of`** provenance.

⚠️ **This is a SPEC decision and the manifest says so in its own words:**

> **`_no_offset_reopened_by`:** *"Re-opening this is a SPEC decision, not an implementation one: it belongs to the owner of the repaint claim… plus the owner of this manifest, together."*

That note is about `offset`, but the principle governs any table change. **This document is that decision being asked for, explicitly.** What it protects:

1. **The escape census stays meaningful.** `--escapes` currently reads CLOSED, 0 of 16, declared == fired, with a non-zero unguarded control. A scalar is a **declared** name, not an escape hatch — and the census must still read 0 with its control still non-zero afterwards.
2. **The repaint linter needs a new verdict, not a bent one.** A scalar has no lookback, so `astReach` returns 0 — it cannot *repaint*. But it **can be stale**: a nightly `market_cap` on an intraday chart is a freshness claim, not a repaint claim. ⇒ **E introduces `meta.freshness` alongside `meta.repaint`**, machine-derived from the scalar's `as_of`, and refused in both directions exactly as the repaint badge is.
3. **Both lanes or neither.** The table is DATA precisely because both lanes read it (`parse.js` configures the parser from it; `ast_interpret.py` walks the tree). A scalar added to one lane is a second grammar, and this repo has measured what that costs (`williams_r` vs `williamsR`).

---

## 4. Architecture

### E1 — Vocabulary: `scalars` in the closed table
Declared list + `source` + `as_of`. Both lanes read it. Census stays closed with a live control. New `meta.freshness` verdict, machine-assigned.

### E2 — The scan: `WHERE <ast> != 0`
A scan definition is an ordinary definition whose tree yields 0/1 on the last confirmed bar. Stored in the same append-only store, identified by the same `def_hash` (**`compute.fn` *is* `astHash`** — the tree is the implementation, so "the handle changed" and "the maths changed" are one event).

**Results live in a narrow side table** keyed `(def_hash, tf, symbol, as_of)`, joined to `screener_rows`. Not new columns:

| option | verdict |
|---|---|
| widen `screener_rows` per definition | ⛔ unbounded schema, per-user DDL, breaks its 8 indexes |
| generic EAV on `screener_rows` | ⛔ destroys the indexed SQL that makes it fast |
| **narrow side table + join** | ⭐ existing 60-column screener untouched; results append-only and prunable |

### E3 — The evaluator: off the request path, sequential, always
**Copy `screener/snapshot_builder`, not `rs_ranking`.**

Measured, full universe (3,742 tickers), serial, bars resident locally:

| workload | cost |
|---|---|
| one native (RSI) | **~2.3 s** |
| one median user AST | **~5.4 s** |
| worst-case corpus AST | **~8.1 s** |

⛔ **Threads are not available, and the reason is load-bearing.** 400 symbols × worst-case AST: serial 613 ms · ThreadPool(4) **×1.00** · (8) **×0.62** · (16) **×0.55**. The interpreter is pure-Python plain loops *because* *"numpy changes summation order, and a 1e-9 equality across two languages only holds if the accumulations happen in the same order."* **The correctness guarantee is what makes it GIL-bound.** `rs_ranking`'s 12 workers work only because it is I/O-bound.

⛔ **A member request never triggers an evaluation.** The chokepoint is the shared event loop + 64-slot anyio pool (`main.py:1220`); all 7 signature routes are `sync def`, so a GIL-bound 2–8 s sweep degrades *every handler on the pod*. This is the **524 class**. `/confluence-scan`'s four bounds are the proven template: wall-clock budget · `BoundedSemaphore` minority of the pool (`_DPC_COLD_LANE_SLOTS = 2` of 64 ≈ 3%) · lane pace · **a background warmer so a user is never the one who rebuilds.**

### E4 — The criteria builder (the surface users actually touch)
Two doors onto one object, mirroring Phase D's builder:
- **Structured** — pick a variable, a comparator, a value; conditions AND/OR into a tree. Every row emits the same AST nodes typing would.
- **Formula** — the text field, with the same parse → lint → budget → read-back chain.

🔴 **Both must round-trip.** Build in the picker, see the formula; edit the formula, see the picker. A one-way builder is TC2000's PCF seam re-created. **The gate is a property test: picker → AST → picker is the identity, over a generated corpus.**

### E5 — Natural language → scan
Extend the shipped concierge. ⭐ **Its central property survives unchanged and must be re-asserted: the model emits a TREE and never authors the sentence** (D-A5, proved by parsing `propose`'s own AST). The read-back a user confirms is generated from the tree by `sentence_for`, so an NL scan is confirmable in the same words as a typed one.

### E6 — The rule record (what makes a claim honest)
🔴 The signal ledger **cannot** back an accuracy claim. Eleven conditions produce a right rule and an empty ledger; **five are member behaviour**: `active=0` · **snoozed** · level conditions keyed per armed *episode* · **user-authored `ast` fires refused first in every mode** · the entire first cycle after a `compute.rev` migration.

⇒ Ledger row count is a **lower bound biased by who armed and who snoozed**. Publishing it as accuracy is spec §1.6's *"unmeasured accuracy claims"* trap reached by arithmetic rather than intent.

**No member-independent store exists.** `alert_shadow_fires` is keyed on `alert_id`, default-off, and has **no prune** — 53 B/row ⇒ **279 GB/yr at 10k alerts**. `signature_coverage` (`ledger.py:115`) is the right shape and the template: append-only, *"this rule evaluated this symbol over this window"*, turning *"no signal"* from a shrug into an answer. **E6 generalises it to any definition.**

### E7 — Toolkits and entitlement
Per §1.4, a toolkit gates **breadth** — symbols, history depth, definition count, refresh cadence — **never mechanics**. Nobody is sold a worse RSI. `meta.tier` is a **badge only**; the gate is the handler's `Depends(require_paid)`. There is **no entitlement model** today; E7 builds the first one.

---

## 5. Adjudications

| id | question | call |
|---|---|---|
| **E-A1** | A separate scan language? | **No.** A scan is `<ast> != 0`. Same parser, interpreters, linter, budget, read-back, concierge. |
| **E-A2** | Reimplement the interpreter for scale? | **No.** §1.1, and threads prove it buys nothing. |
| **E-A3** | Parallelise the sweep? | **No.** Sequential, off the request path. |
| **E-A4** | New columns on `screener_rows`? | **No.** Narrow side table keyed by `def_hash`. |
| **E-A5** | Ledger as a toolkit track record? | **No.** E6 builds a member-independent record. |
| **E-A6** | Grow `INDICATOR_FUNCS`? | **No.** `build_alert_grid` iterates it in order; growing it changes the instrument every B/C/D gate is measured against (D-A4). Fifth partition or nothing. |
| **E-A7** | Extend the closed table with `scalars`? | **YES — and it is the owner's call to make, per the manifest's own note.** Declared, closed, with `source` + `as_of`, both lanes, census still 0 with a live control. |
| **E-A8** | One `freshness` verdict, or overload `repaint`? | **Separate.** A stale scalar is not a repainting one; overloading would make the brand's central claim mean two things. |

---

## 6. Verification — reviews and tests throughout

### 6.1 Every task, without exception
Implementer → **mutation gauntlet** (CONTROL A with abort-on-zero; each mutation **proven applied**; verdict from the **bare exit code read without a pipe**; artifacts sha-restored; a kill by a non-targeted test is **SUSPECT, never KILLED**) → **task review** (spec *and* quality, both verdicts) → bounded five-round fix loop.

### 6.2 Gates specific to Phase E

| gate | why it can fail |
|---|---|
| **cross-lane parity unmoved** — `ast_conformance --check` byte-identical, `REL_TOL` still `1e-9` | E must not perturb the guarantee it depends on |
| **`--escapes` still CLOSED with a non-zero unguarded control** | a `scalar` is a declared name, not an escape hatch |
| **fire log unmoved** — the literal `FIRE LOG MATCHES`, exit 0 | ⛔ **never judged by a total**; `685,193` is stale, the real output is 22 blocks / 1,153,245 |
| **`INDICATOR_FUNCS` unchanged** (`len 28`, `all_addresses() 31`) | E-A6 |
| 🔴 **picker ⇄ formula round-trip is the identity**, over a generated corpus | a one-way builder is the competitor seam re-created |
| 🔴 **pod-degradation budget** — a sweep must not raise p99 on an unrelated endpoint beyond a stated bound, **measured under concurrent load** | the 524 class; "fast alone" is not "safe together" |
| 🔴 **coverage is part of the result** | see 6.3 |
| **NL emits a tree, never a sentence** — re-assert by parsing `propose`'s own AST | D-A5's property must survive the extension |
| **entitlement derived from `router.routes`, count asserted** | a hand-listed path set let two paid endpoints ride uncovered in Phase C |
| **wire-cut test per surface** | eight features shipped this week built, tested, green and unreachable |

### 6.3 🔴 The failure this phase must not ship

The recon surveyed every existing universe sweep. **Almost all swallow per-symbol failures silently** — `bars_prewarm` (`except: pass`, counted into neither `warmed` nor `skipped`), `rs_ranking` (dropped with no counter; marks itself done **even on failure**), `theme_performance` (a failed fetch becomes a legitimate-looking `None`), `scan_volume` (**a failed reference is indistinguishable from an empty market**).

⛔ **At screener scale that is `lesson_health_check_reads_a_proxy_not_the_artifact`: a screen that silently drops 800 symbols returns fewer hits and looks like a quiet market — and a trader would act on it.**

Two exceptions exist and E copies both: `screener/snapshot_builder` (counts *and* logs per-symbol failures, returns `{built, skipped, errors}`) and `scan_gainers` (returns `None` on a transient miss so the job **retries** instead of caching an empty day).

**E's rule: a screen states its own coverage.** *"3,742 evaluated · 3,701 answered · 41 dropped — here they are."* Coverage is part of the result, not a log line.

---

## 7. What each zero will NOT cover

- The pixel-parity harness **mounts no screener**. A total regression of everything here reports **0 changed pixels**, honestly.
- `alert_replay --check` staying green proves E did not disturb the alert lane. It says **nothing** about whether a screen is correct.
- Cross-lane conformance covers the **interpreter**, not the **sweep**. A sweep evaluating the right formula over the wrong symbol set passes every conformance gate.
- Ledger rows prove accrual, **not** rule performance (E-A5).

---

## 8. Open questions — owner calls

1. 🔴 **E-A7: may the closed table gain `scalars`?** Without it a scan can say `rsi(close,14) < 30` but not `market_cap > 1e9` — which is table stakes against TC2000. The manifest says this is yours to grant.
2. 🔴 **"Ecosystem and recognition" vs §12.** Spec §12 puts *"marketplace / user publishing"* out of scope *"until the ledger can hold publishers accountable"*. Sharing a scan with attribution **is** publishing. **E6 is what makes it accountable** — so the honest sequence is E6 → sharing, and §12 gets amended rather than ignored. Confirm that reading.
3. **What does a published record claim?** *"This rule fired 340 times, 61% followed through"* needs E6. *"Members were notified 340 times"* is an operations metric. §1.6 forbids selling the second as the first.
4. **What does a toolkit gate?** Symbols · history depth · definition count · refresh cadence — pick the axes before E7 builds enforcement.
5. **Cadence.** Is nightly 03:00 right for definition columns, or do scans need intraday? This drives cost and the entire freshness contract.

---

## 9. Sequencing

```
E1 scalars ──> E2 scan object ──> E3 evaluator ──> E4 criteria builder ──> E5 NL
                                        │                                    │
                                        └──────> E6 rule record <────────────┘
                                                      │
                                                      └──> E7 toolkits + sharing
```

**E1 is the gate on everything** — without `scalars` the builder is a toy against TC2000. **E6 gates every public claim and all sharing.** E7 needs §8.4 answered first.

⚠️ **A prerequisite that is not code:** §2's E-row gate reads *"ledger has public-worthy history"*. The door opened 2026-08-08 — but production's 31 soak rows are **armed-and-snoozed**, so they accrue nothing. **History begins when real members hold real alerts.** E1–E6 can be built meanwhile; a *published* record cannot precede the history it claims.

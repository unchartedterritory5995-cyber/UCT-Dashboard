# C2 — COMPUTE BUDGET (C2A) AND THE 64 KB DOCUMENT CAP (C2B)

**C2A PASSES and shipped a fix. C2B is answered and DELIBERATELY SHIPS NO CHANGE:
its finding is that the cap is not the defect, and the real fix is a
representation redesign returned here as an architecture decision.**

---

# C2A — COMPUTE-BUDGET SEMANTICS + PARTIAL-FAILURE CONTAINMENT

## 1. The architecture, traced in production code

```
definition → instance → binder.sync → registry.computeFor
                                       → astColumnsFor: ONE interpret() PER TREE
                                          → assertBudget(ast, compute.budget)   [static, per AST]
                                          → runRecurrence: bars × warmup        [dynamic, per call]
```

**Two limits, both per-column, neither shared:**

| Limit | Where | What it counts |
|---|---|---|
| `DEFAULT_BUDGET` — `maxNodes: 128`, `maxLookback: 960`, `maxSeriesRefs: 8` | `budget.js::assertBudget`, before a single bar is walked | the SHAPE of one tree |
| `MAX_RECURRENCE_STEPS = 1_000_000` | `interpret.js::runRecurrence` | `bars × warmup` for one `accum`, where the bar count is finally known |

⛔ **NOTHING ACCUMULATES ACROSS SIBLINGS.** The hypothesis C0R left open — a
shared aggregate budget — is **false**. That distinction decided the whole wave: a
shared budget would mean the document is too big, and it is not; one column of it
is. Fixing the wrong one would have meant raising a limit that was never involved.

## 2. `master-line-lite`, column by column (5,000 bars)

| # | Column | Result |
|---|---|---|
| 0 | Consensus | **OK** — 4,945/5,000 finite, 20 ms |
| 1 | Upper band | **OK** — 4,945/5,000, 7 ms |
| 2 | Lower band | **OK** — 4,945/5,000, 6 ms |
| 3–6 | Bull/Bear flip ×2 | **REFUSED** `interpret:steps` |

Growing subsets through the real `computeFor`: **OK at 1, 2 and 3 columns; THREW
from the 4th on.**

### The mechanism — proven, not inferred

`astColumnsFor` ran `interpret` per tree in a plain `for` loop **with no `try`**.
The fourth tree threw, the loop unwound, `computeFor` threw, and the binder's
`attempt(...)` caught it and `continue`d **past the whole instance** — so all seven
plots drew nothing. Category **D/E**: sibling containment, not budget.

`spma-trend` is a different case and must not be lumped in: **all five of its
columns refuse on their own.** There is nothing to contain — the honest answer is
no columns and five reasons.

## 3. The fix

Per-tree containment in `astColumnsFor`. A failed column is **absent** (not
all-NaN: `hasAnyFinite` already reads absence correctly, and a 5,000-long NaN array
per failed column would allocate for nothing and read as a column that computed).

The **reason** is preserved on a non-enumerable `__columnErrors`, read through
`columnErrors(cols)` — C2A.8's structured state, without new UX.

⛔ **NON-ENUMERABLE IS THE WHOLE DESIGN.** Every consumer walks a column map with
`Object.keys` — the binder's `for (const plotKey of Object.keys(cols))` is the one
that matters — and a visible extra key would become a phantom plot on every chart.

**Live result:** master-line-lite moves **7/7 empty → 3 of 7 drawing.** It stays
`CHART_PARTIAL`, correctly: an indicator with four dead columns is partial, and
saying so is the point.

## 4. Duplicated computation (C2A.4)

| Script | Outputs | Counted nodes | Repeated |
|---|---|---|---|
| master-line-lite | 7 | 3,300 | **2,782 (84%)** — the 13-node consensus appears **19×** |
| cm-ultimate-rsi-mtf | 6 | 1,897 | **1,502 (79%)** — the RSI expression 9× |
| coppock-curve | 6 | 1,614 | **1,247 (77%)** — its 13-node `wma` 16× |
| 3way-bollinger | 3 | 71 | 14 (20%) |

⚠️ **It does NOT drive execution cost** (§5). It is the same fact that drives C2B's
document size, where it dominates completely.

## 5. Budget policy — measured, and the answer is DO NOT RAISE

A recurrence step costs **~374 ns**, linearly: 250k→93 ms, 500k→196 ms, 750k→299 ms,
975k→412 ms.

- The current ceiling (1e6 steps) is therefore **already ~374 ms of blocked main
  thread, per column**.
- Admitting a 5,000-bar × 250-warmup recurrence (1.25M steps) would be **~468 ms per
  column** — and master-line-lite has **four**, i.e. ~1.9 s of frozen UI for one
  indicator, on the single event loop the launch-hardening work exists to protect.

**The guard is doing real work and must stay.**

### Bar count and step count are different limits, and their PRODUCT is what nobody chose

- `PINE_STATE_WARMUP = 250` — one trading year. A translated Pine `var` is bounded
  **on purpose**: Pine accumulates from the first bar the chart ever loaded, and a
  value that depends on where a fetch happened to start changes when a member pans.
- `MAX_RECURRENCE_STEPS = 1e6` — the work ceiling.
- 250 × 5,000 = 1.25M. **The break-even is 4,000 bars**, so on the default daily
  window **every translated Pine `var` refuses** — trailing stops, streaks, flip
  states, the whole class.

⚠️ **A 20% smaller daily window would make the class computable — and is not a free
win.** At 4,000 bars each such column costs ~374 ms; master-line-lite's four would
be ~1.5 s. That is an owner trade-off (history vs. latency vs. this capability),
not an engineering default, so it is returned rather than taken.

### ⚰️ A hypothesis I held and disproved

I believed the recurrence re-evaluated its body's non-`self` subtrees on every
warm-up step, so hoisting them would collapse the cost by ~250×. **Measured: a
heavy body (the 5-MA consensus) costs 304 ms against a tiny body's 285 ms at the
same step count — ~7%.** The interpreter already evaluates sub-series once; the
`bars × warmup` walk is intrinsic. There is no cheap architectural win there, and
proposing one would have been wrong.

## 6. What the corpus actually costs (C2A.6)

17 scripts, 5,000 bars, all carried columns:

| | P50 | P75 | P90 | P95 | MAX |
|---|---|---|---|---|---|
| outputs/script | 3 | 6 | 12 | 12 | 12 |
| nodes/script | 44 | 104 | 457 | 518 | 518 |
| **ms/script** | **7** | **20** | **39** | **71** | **71** |

Scripts with ≥1 refused column: **3/17**. The corpus is cheap; the limits are not
being hit by ordinary indicators.

## 7. Safety under adversarial complexity (C2A.7)

Ten deterministic fixtures — 24 independent outputs, 300-deep nesting, a 50,000-bar
window, an expensive recurrence, **twelve** expensive recurrences at once, repeated
subexpressions, a malformed tree — each refused by the right guard, and each
containing its failure. Twelve refused recurrences cost **8 ms total**, because the
ceiling refuses from a multiplication before doing any work: that property is what
makes containment safe to ship.

⚠️ **A threshold I guessed wrong and then measured:** the first draft asserted that
twelve moving averages would exceed the node budget. Twelve is 36 nodes and computes
happily; the wall is at ~43. Both sides are now pinned (120 nodes computes, 150 does
not). A stress fixture whose "too big" is not actually too big measures nothing.

## C2A EXIT GATE

| # | Condition | Met? |
|---|---|---|
| 1 | master-line-lite mechanism proven | ✅ containment, not budget |
| 2 | shared-vs-per-output semantics explicit | ✅ per-output; nothing accumulates |
| 3 | valid siblings not erased | ✅ 3 of 7 now draw |
| 4 | any new limit evidence-based | ✅ **no limit changed** — the evidence says do not |
| 5 | resource protection still effective | ✅ 10 adversarial fixtures |
| 6 | OOS execution distribution measured | ✅ |
| 7 | no new silent wrong result | ✅ partials are reported as partial |
| 8 | full journey remeasured | ✅ 13/2/2/1 |

**C2A PASSES.**

---

# C2B — THE 64 KB DOCUMENT CAP

## 1. Every enforcement point (C2B.1)

**There is exactly one.** `api/services/user_definitions.py:916`, on the canonical
JSON (`sort_keys`, compact separators, UTF-8 bytes), raising before anything is
stored.

Nothing else constrains size anywhere on the path: the column is SQLite `TEXT`
(effectively unbounded), there is no request-body limit, no client-side check, and
no proxy/transport limit in play.

**The rationale is recoverable and explicit**, from the module's own header:

> *64 KiB is ~1,000 lines of formula and plot metadata; **the point of the number is
> that there IS one**, because the store this replaced (`user_preferences`) has none.*

So it is a deliberate "have a bound" number — not a storage or transport constraint.
The neighbouring caps are `MAX_DEFINITIONS_PER_USER = 50`, with **versions
explicitly unbounded** and documented as such.

## 2. What documents actually weigh (C2B.2)

21 of the 60 build a document (the rest refuse earlier):

| | P50 | P75 | P90 | P95 | MAX |
|---|---|---|---|---|---|
| document bytes | 3,309 | 9,225 | 28,767 | 181,315 | 331,977 |

**Over the cap: 2 of 21.** P90 is 28.8 KB — the cap is comfortable for 19.

| Document | Source | Document | Ratio |
|---|---|---|---|
| `supertrend-kivancozbilgic` | 2,549 B | **331,977 B** | **×130.2** |
| `rsi-levels-regime-map` | 50,198 B | 181,315 B | ×3.6 |
| master-line-lite | 4,064 B | 28,767 B | ×7.1 |

## 3. ⛔⛔ THE BLOAT IS STRUCTURAL — and this is the finding (C2B.3)

| Section | supertrend | rsi-levels |
|---|---|---|
| `compute.trees` | 270,300 B (**81.4%**) | 152,943 B (**84.4%**) |
| `compute.sources` | 34,829 B (10.5%) | 19,607 B (10.8%) |
| everything else | ~8% | ~5% |

supertrend's ten trees include four of ~35 KB that are **pairwise near-identical**
(out3/out6 both 35,286 B; out2/out5 both 35,212 B). Each output inlines the whole
shared computation.

### The decisive measurement

| Document | Stored | **gzip** | Ratio |
|---|---|---|---|
| supertrend | 331,977 B | **4,838 B** | **×68.6** — under the cap |
| rsi-levels | 181,315 B | **4,018 B** | **×45.1** — under the cap |

**Both "oversized" documents contain under 5 KB of information.** They are ~98.5%
repetition. A 2.5 KB Pine script produces a 332 KB document carrying 4.8 KB of
meaning.

⛔ **SO THE CAP IS NOT THE DEFECT.** Raising it would enshrine a representation
~70× larger than what it encodes, and the next ten-plot script would need 500 KB.
And it is not a performance argument either — parsing the 332 KB document costs
**2.9 ms** — which is precisely why "just raise it" is tempting and wrong.

## 4. ⛔⛔ THE ARCHITECTURE DECISION, RETURNED RATHER THAN TAKEN

The correct fix is a **shared-subtree representation** — a defs table with `$ref`
nodes, so one consensus expression is stored once. It is a major redesign, and the
blast radius is specific, not hand-waved:

| What breaks | Why |
|---|---|
| **Track F `astPath` locators** | a locator is a structural path (`["args", 1]`) walked into the tree, resolved in BOTH `app/.../paramEdit.js` and `api/services/param_manifest.py`. A `$ref` node ends the walk. |
| **Parameter-edit semantics** | with sharing, one literal is reachable from several outputs — so editing a parameter stops being local. That may be *right*, but it is a behaviour change to reason about, not a serialisation detail. |
| **`astHash` / `def_hash`** | keys a results table every member shares, plus share tokens and the ledger. Changing the serialisation changes every hash and invalidates all of it. |
| `interpret` / `sentence` / `lint` / the screener | every reader of the canonical tree |

Per this wave's own instruction — *do not hide it inside a larger constant* — **no
limit is changed and no representation change is attempted here.**

## C2B EXIT GATE

| # | Condition | Met? |
|---|---|---|
| the cap's reason and enforcement points | ✅ one point; rationale quoted above |
| representation bloat separated from complexity | ✅ gzip ×68.6 / ×45.1 — it is ~all bloat |
| any limit change evidence-based | ✅ **none made**; the evidence says the cap is not the problem |
| all layers support the envelope | ✅ SQLite TEXT unbounded; no other limit |
| large-document performance acceptable | ✅ 2.9 ms parse at 332 KB |
| abuse protection remains | ✅ unchanged |
| backward compatibility | ✅ trivially — nothing changed |
| OOS persistence remeasured | ✅ 13/2/2/1, unchanged |

**C2B is ANSWERED. Its outcome is an architecture decision for the owner, not a
constant.**

---

# THE 18, AFTER C2

| Outcome | Count | Change |
|---|---|---|
| FULL_JOURNEY_PASS | **13** | — |
| DOCUMENT_SIZE_BLOCKED | **2** | — (C2B deliberately shipped no change) |
| COMPUTE_PARTIAL | **2** | master-line-lite: 7/7 empty → **3 of 7 drawing** |
| IMPORT_BLOCKED | **1** | — |

⛔ **THE COUNTS DID NOT MOVE AND ONE SCRIPT GOT MATERIALLY BETTER.** Anyone reading
a flat 13 as "C2A did nothing" is reading the wrong column: three columns of a real
indicator went from erased to drawn, and the classification stayed PARTIAL because
four of its seven still do not compute. That is the honest shape.

⛔ **AND FULL_JOURNEY_PASS IS STILL NOT VISUAL_FULL.** 16/18 remain VISUALLY
PARTIAL; Tier 3 remains unearned.

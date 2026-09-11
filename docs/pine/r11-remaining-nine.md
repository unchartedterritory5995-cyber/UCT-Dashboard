# R1.1(f) — the remaining nine, in demand order

> ## ✅ ALL NINE READ, 2026-09-11 — and three of them are not what this page assumed
>
> | # | name | reading | pinned? |
> |---:|---|---|---|
> | 1 | `ta.nvi` | **seed = 1**, and nvi *= (1 + close-change) only on bars where volume FELL — 209/209 moved, 190/190 held | no — table function, priced below |
> | 2 | `math.pi` | 3.141592653589793, confirmed on 400 bars | ✅ **YES** — folds to a number, costs no table function |
> | 3 | `year` | ⭐ **already translates** — nothing to add. The clock is EXCHANGE time (settled by `hour`, not by `year`) | n/a |
> | 4 | `alma` | ⛔ **does not exist in Pine v6** — "Could not find {kind} '{fullName}'" | ⛔ must NOT be added |
> | 5 | `math.ceil` | ceil(-2.5) = -2 → toward +∞ | no — priced below |
> | 6 | `math.floor` | floor(-2.5) = **-3** → toward -∞, NOT toward zero | no — priced below |
> | 7 | `ta.barssince` | ⭐ **ONE argument**; the 2-arg form is REJECTED by the vendor; never-true returns **`na`** | ⛔ a REMOVAL, routed |
> | 8 | `ta.correlation` | `na` until the window fills; defined from bar_index `length-1` | no — priced below |
> | 9 | `ta.percentile_linear_interpolation` | `na` until the window fills; 0 and 100 CLAMP to the window's min and max, 610/610 | no — priced below |
>
> **Captures:** `tests/fixtures/vendor/r11-nine-safe-spy-1d-2026-09-11.json` ·
> `r11-nvi-spy-2026-09-11.json` · `r11-alma-spy-2026-09-11.json` ·
> `r11-corr-pct-spy-2026-09-11.json` · `r11-barssince-spy-1d-2026-09-11.json`.
>
> ### ⛔ WHY ONLY ONE IS PINNED, AND IT IS NOT RELUCTANCE
>
> `math.pi` folds to a NUMBER, so it costs no table function. Every other addition
> here declares a new BAR name — and this repo's gates price that deliberately:
> `test_ast_scalars.py::test_the_scalar_floor_is_ITS_OWN_and_folding_it_in_ABORTS_the_recorder`
> and `test_ast_interpret.py::test_ast_table_SPELLS_NO_TABLE_NAME…` go red BY NAME,
> because a new bar name owes a corpus case, and adding one moves every frozen
> per-ast digest and re-freezes a cross-lane oracle. `ceil`/`floor` were built
> across the table and both lanes on 2026-09-11 and BACKED OUT the same hour when
> those two fired. That is the gate working; editing it would be H4. **The
> measurements are banked so the pin, when it lands, lands with its corpus cases.**
>
> ### ⭐⭐ THREE THINGS THIS PAGE GOT WRONG, AND THEY ARE THE INTERESTING PART
>
> 1. **`year` never needed a vendor read at all.** It is listed here as one of the
>    nine; it already translates, because the closed table declares it in its
>    `clock` section and the Pine door binds it. What the capture bought was the
>    TIMEZONE — which this page correctly said was open.
> 2. **`alma` is not a missing name, it is a DEAD one.** The 3 sites are v3-era
>    scripts that do not compile at TradingView either. Adding it would make this
>    engine accept what the vendor rejects.
> 3. **`ta.barssince` is a REMOVAL, not an addition.** This page's row #7 and Group
>    B's arity row are the same function, and the answer is that OUR 2-arg
>    declaration is the wrong one. The page warned that the two fixes are opposite;
>    they are, and the direction is narrow-not-widen.
>
> ### ⭐ AND THE SPLIT RULE WAS TESTED BY A REAL FAILURE
>
> `alma` was given its own file under item 7's rule. It failed TOTALLY — no study,
> no plots, no data, landing as a one-plot stub named after the shared unsaved
> slot. Grouped with `ta.correlation` and `ta.percentile_linear_interpolation` as
> the cheaper packaging, one add would have returned nothing for all three. The
> rule had been argued for a week; this is the first time it was measured.



Group A is eleven names. `time(<timeframe>)` and `ta.valuewhen` are handled separately
(`r11-time-and-valuewhen.md`) because together they are **109 of the 157 sites**. These are the
other nine, ordered by demand.

| # | name | scripts | sites | kind | what has to be read off the vendor first |
|---:|---|---:|---:|---|---|
| 1 | `ta.nvi` | 2 | 25 | series | Negative Volume Index — the **seed value** (100? 1000?) and whether it accumulates on unchanged volume or only on a decrease. A wrong seed is a constant offset that looks plausible forever. |
| 2 | `math.pi` | 1 | 8 | **constant** | none — it is π. One table row, no node. |
| 3 | `year` | 1 | 4 | clock | bare v1-v3 spelling. Which timezone: exchange or UTC? They differ for 5 hours a day. |
| 4 | `alma` | 2 | 3 | function | v3-era bare spelling of `ta.alma`. Arnaud Legoux — needs `offset` and `sigma` defaults confirmed (0.85 / 6 are the usual, but they are *defaults*, not the maths). |
| 5 | `math.ceil` | 1 | 2 | function | behaviour on negatives — toward zero or toward +∞. |
| 6 | `math.floor` | 1 | 2 | function | same question, opposite direction. |
| 7 | `ta.barssince` | 1 | 2 | series | ⚠️ see below — it collides with a Group B row. |
| 8 | `ta.correlation` | 1 | 1 | function | which correlation over which window, and what it returns before the window fills. |
| 9 | `ta.percentile_linear_interpolation` | 1 | 1 | function | the interpolation rule at the boundaries is the whole function. |

## ⚠️ `ta.barssince` and `barssince` are the same function counted twice, in two groups

`ta.barssince` sits here (1 script, 2 sites) and the bare `barssince` sits in **Group B** as an
arity case (7 scripts, 12 sites, all 1-arg against our declared 2). They are the same Pine
function under its dotted and bare spellings, and the two groups disagree about what is wrong
with it — "we lack the name" here, "we have it with the wrong arity" there.

⛔ **Resolve it once, as one question**, or two separate fixes will land on one function and
the second will look like a regression of the first. The vendor reading needed is the same one
`r11-group-b-arity.md` already lists: `ta.barssince(condition)` takes **one** argument, so our
2-arg declaration is probably simply wrong.

## Ordering note

⭐ **Sites, not scripts, orders this list, and one row shows why the distinction matters.**
`ta.nvi` is 25 sites but only **2 scripts**; `math.pi` is 8 sites in **1 script**. Neither
unlocks anything alone — every one of these nine sits in a script with other refusals, so
adding all nine moves the strict count by **zero** unless the rest of those scripts also clear.

⛔ So this list is a **vocabulary backlog, not an unlock plan**. The unlock plan is
`r11-vocabulary-gap.md`'s Group C census (31 scripts blocked solely by a dotted name). Working
this list top-down and expecting 30/266 to move would be measuring the wrong thing — which is
exactly what `lesson_a_refusal_count_is_not_a_progress_metric` warns about.

✅ **Cheapest first, if the goal is throughput rather than unlock:** `math.pi`, `math.ceil`,
`math.floor` are three table rows and two vendor questions between them, and they retire a
third of the list.

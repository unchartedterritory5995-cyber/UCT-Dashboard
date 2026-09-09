# R1.1(f) — the remaining nine, in demand order

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

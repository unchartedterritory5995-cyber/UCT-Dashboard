# R1.1 — the missing names, listed before anything is built

Derived by running the engine's own translator over **`corpus/committed/` (266 scripts)** and
collecting the `token` field of every refusal. Nothing here re-implements name resolution, so
the list cannot disagree with what the engine actually does.

Artifact: `tools/pine_survey/r11_missing_names.json`.

**Baseline reach on this corpus: 30 of 266 strict, 45 of 266 lenient.** Recorded so the next
measurement has something to move against — not reported as progress, because nothing has been
built yet.

---

## ⛔ The headline: "~45 missing `ta.`/`math.` names" is three different gaps wearing one label

The survey's figure came from the 1,443-script wild corpus and counted every distinct token
that reached a vocabulary guard. On the committed corpus the picture separates cleanly, and
**only the first group is a vocabulary gap at all**:

| Group | Distinct | What it actually is | Fixing it means |
|---|---|---|---|
| **A. Real Pine names we lack** | **11** | `ta.`/`math.`/built-in functions Pine defines and we do not | add a node |
| **B. Arity, not vocabulary** | 9 | names we ALREADY support, called with an argument count we reject | widen a signature |
| **C. Not Pine at all** | 17 + 16 | user library namespaces (`zen.`, `mymas.`, `pc.`) and user-type fields (`upVolumes.sum`) | `pine:module` / UDT work — **not** a builtins table |

⛔ **Group C must not be added to a vocabulary table.** `zen.toWhole`, `mymas.ema`,
`pc.totalForTimeWhen`, `kernels.rationalQuadratic` and `PCvc.barIsVisible` are *imported library*
calls, and `upVolumes.sum`, `settings.useDynamicExits`, `direction.neutral` are *user-defined
type* field reads. Declaring them as builtins would make the engine claim to implement functions
that belong to somebody else's script, and it would be silently wrong on every one of them —
the same class of defect as declaring `linreg` and breaking `ta.linreg`.

## Group A — the actual vocabulary gap (11 names, 157 sites)

| scripts | sites | name | note |
|---:|---:|---|---|
| 10 | 63 | `time` | the `time(<timeframe>)` overload — the period-opening timestamp scripts compare with `>` to detect a new day/week |
| 8 | 46 | `ta.valuewhen` | |
| 2 | 25 | `ta.nvi` | |
| 2 | 3 | `alma` | v3-era bare spelling of `ta.alma` |
| 1 | 8 | `math.pi` | a constant, not a function |
| 1 | 4 | `year` | bare clock name |
| 1 | 2 | `math.ceil` | |
| 1 | 2 | `math.floor` | |
| 1 | 2 | `ta.barssince` | |
| 1 | 1 | `ta.correlation` | |
| 1 | 1 | `ta.percentile_linear_interpolation` | |

⭐ **Two names carry two thirds of the demand.** `time(<timeframe>)` and `ta.valuewhen` are 109
of the 157 sites and 18 of the scripts. `math.ceil`, `math.floor` and `math.pi` are trivial and
together cost one script each. The long tail is genuinely long: five names appear in exactly one
script.

## Group B — supported names, rejected arity (9 names, 36 sites)

| scripts | sites | name |
|---:|---:|---|
| 3 | 6 | `vwap` |
| 2 | 6 | `breakout` |
| 2 | 5 | `ta.lowest` |
| 1 | 7 | `ta.highest` |
| 1 | 7 | `pivothigh` |
| 1 | 2 | `barssince` |
| 1 | 1 | `math.max` · `math.round` · `pivotlow` |

These already have nodes. `ta.highest(source, length)` vs `ta.highest(length)` is the usual
shape. Cheapest reach per unit of work in the whole list.

## Group C — not vocabulary (33 names)

**User library namespaces** (`pine:builtin`): `zen.toWhole` · `mymas.ema` · `mymas.jma` ·
`pc.totalForTimeWhen` · `PCvc.barIsVisible` · `kernels.rationalQuadratic`.

**User type fields** (`pine:type`, 16 names): `upVolumes.sum` · `upVolumes.max` ·
`upVolumes.size` · `dnVolumes.sum` · `dnVolumes.min` · `settings.useDynamicExits` ·
`direction.neutral` · `direction_s.neutral` · `mtfResult.alignmentLabel` · `st.signal` ·
`c.score` · `c.trail` · `bull_alert.ehl` · `bear_alert.ehl` ·
`phData.lines.startline.get_y1` · `plData.lines.startline.get_y1`.

**Genuine built-ins refused by namespace**, which belong in the R1.1 conversation after all:
`timeframe.period` (3 scripts, 23 sites) · `timeframe.in_seconds` (10 sites) ·
`timeframe.multiplier` (4 sites) · `syminfo.mintick` · `barstate.isfirst` ·
`chart.bars` / `chart.leftBarIndex` / `chart.rightBarIndex`.

⚠️ `pine:state` reports `[` as its token for 8 scripts and 97 sites. That is the history
operator, not a name — a reminder that `token` is whatever the lexer was looking at, and a
count of "distinct tokens" is not a count of distinct *functions*.

## ⛔ One script hangs the translator, and that is worse than any refusal

**`corpus/committed/parabolic-sar__xoeoPMOWGJ.pine` — 70 lines, 2,270 bytes — makes
`translatePine` never return.** Not slow: non-terminating. It was found only because the runner
names each file on disk *before* entering the translator, which is the one technique that
survives a hang.

Bisected to the exact line. Prefixes 1–60 translate in 3ms; adding line 61 hangs:

```pine
15: float sar = 0.0
22: sar := sar[1]          // self-reference through the history operator
30:     nextsar = sar
59:     sar := nextsar     // and back again — the cycle closes
61: plot(sar, ...)         // asking for `sar` starts the walk
```

`sar` depends on `nextsar` depends on `sar`. The `[1]` makes it a legal Pine *recurrence* — the
previous bar's value — but the resolver does not appear to break the cycle at the history
boundary, so requesting the value walks forever.

⚠️ **A hang is a worse failure mode than a refusal**, because it takes the whole batch with it
and reports nothing. There is a `pine:cycle` guard in the engine already (it fires elsewhere in
this corpus), so the fix is likely to reach the `:=` reassignment path rather than to invent
new machinery.

## Suggested order

1. **Group B arity** — nine names, no new nodes, immediate reach.
2. **`time(<timeframe>)` and `ta.valuewhen`** — 109 sites, 18 scripts, two nodes.
3. **The `pine:cycle` hang** — a correctness and tooling fix, not a reach fix, but every batch
   run is unsafe until it lands.
4. **`timeframe.*`** — `period`, `in_seconds`, `multiplier` are three names and 37 sites.
5. **The trivial three** — `math.ceil`, `math.floor`, `math.pi`.
6. Leave Group C to `pine:module` and the UDT work. It is not vocabulary.

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

---

# R1.1(c) + (g) — re-census after the hang, and what Group C actually blocks

Measured 2026-09-09 over all 266 committed scripts, in-process, after the
`pine:timeout` depth bound landed.

## (c) The three-number metric — and how many scripts the hang masked

⚰ **STALE SINCE 2026-09-12 — the metric is now 31/266 host · 46/266 screener.** Ruling 3.5 took it to 33/47 and ruling R-F to 31/46 (five trailing-stop / Supertrend scripts correctly left the translating set). The producer is `app/src/components/chart/engine/ast/corpusMetric.test.js` and the artifact is `tools/corpus_metric.json`; the numbers below are kept as the reading they were taken at, not as current.

| | before | after |
|---|---|---|
| ok **strict** | 32/266 | **32/266** |
| ok **lenient** | 46/266 | **46/266** |

⭐ **UNMOVED, AND THAT IS THE CORRECT ANSWER.** The hang masked **zero** scripts.
`translate_batch.mjs` forks a child per script, so `parabolic-sar__xoeoPMOWGJ.pine`
could only ever take *itself* down — the process boundary was doing its job, and no
other script's result was ever hidden behind it.

⭐ **What it cost was speed, and it is worth stating that accurately rather than
dramatically.** The full census now runs in **2.2 seconds in one process**. Before,
that single file burned 11-35s of it — so a full in-process sweep would have taken
roughly 14-37s. **Slow, not impossible.** The earlier note here said the hang made
an in-process census "impractical"; that was an overstatement, and the corrected
figure is the one to quote. What the fix genuinely bought is a census fast enough to
re-run without thinking about it, plus a *deterministic* one — see `rails.md` Rule 5
for the same file returning three different refusals before the bound.

⛔ It bought **no** additional passing scripts, and it would have been wrong to expect
any: a script that refuses `pine:timeout` refused before and refuses now.

## (g) How much is Group C actually holding

| | scripts |
|---:|---|
| blocked **solely** by a dotted-name refusal | **31** |
| blocked by a dotted name **and** something else | 34 |
| distinct dotted tokens refused | 56 |

Most-refused dotted names, by site count:

`request.security` (69) · `ta.valuewhen` (46) · `strategy.position_size` (40) ·
`barstate.isconfirmed` (40) · `ta.nvi` (25) · `timeframe.period` (23) ·
`array.size` (14) · `strategy.exit` (13) · `direction_s.neutral` (12) ·
`strategy.entry` (11) · `array.get` (11) · `timeframe.in_seconds` (10)

⚠️ **THE 31 IS AN UPPER BOUND, NOT A BACKLOG.** The count asks "is every refusal on
this script a dotted name?", which lumps together two different problems:

- **a genuine vocabulary gap** — `request.security`, `ta.valuewhen`, `timeframe.period`
  are real built-ins we simply do not carry. Nothing structural about them.
- **a genuine Group C shape** — `direction_s.neutral` is a *user type field*, and
  `zen.toWhole` a *user library namespace*. These are names that must never reach the
  builtins lookup at all.

Only the second kind is what (g) is about. The first kind is R1.1(f)'s list.

## ⛔⛔ (g) The collision rail cannot fail today — and that is the finding

The directive asks for a rail planting a fake import alias that collides with a real
builtin (`import x as ta`, then `ta.sma`) plus the reverse UDT case. Measured, today:

| probe | today's answer |
|---|---|
| `import someuser/lib/1 as ta` + `ta.sma(close, 20)` | `pine:module` **at the import line** |
| user `type Cfg { float mintick }` named `syminfo`, then `syminfo.mintick` | `pine:type` naming `syminfo.mintick` |
| control — real `ta.sma(close, 20)` | ✅ `ok:true` |
| control — real `syminfo.mintick` | `pine:builtin` (a genuine gap) |
| `import … as zen` + `zen.toWhole(close)` | `pine:module`, then `pine:builtin` on `zen.toWhole` |

**The alias can never reach the builtins table, because `pine:module` refuses every
import outright before it gets there.** So the requested rail would go green today —
**vacuously**, for a reason that has nothing to do with resolution order.

⭐ **So the rail has to be written against the resolution ORDER, not the outcome.** A
test asserting "`import x as ta` then `ta.sma` does not fold to our `ta.sma`" passes
now and would keep passing right up until the day imports are supported, then start
silently permitting the collision — a rail that expires without failing, which is
`lesson_an_arming_condition_that_names_a_test_expires` wearing new clothes. What it
must assert instead is that **the alias/UDT scope is consulted and found empty
BEFORE the builtins lookup runs**, so the ordering is checked even while the outer
refusal makes the collision unreachable.

⚠️ And the UDT row is the one to keep: `syminfo.mintick` shadowed by a user type
already refuses `pine:type` rather than being mistaken for the built-in — the right
outcome, reached by the right route, and worth pinning before that route moves.

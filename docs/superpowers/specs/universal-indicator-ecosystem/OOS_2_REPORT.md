# OOS-2 BASELINE REPORT — what happens when a real TradingView indicator meets UCT

**Corpus:** OOS-1, freeze id `5df718c2f342571ac57c32a8cdaf337ae7462eababe5aa2e0a8b3fd2e9f4904d` —
60 externally-authored real TradingView Community Scripts, sourced capability-blind, never
seen by this project before this run. No product code was changed between the freeze and the
first measurement. The unadjudicated first baseline is preserved verbatim in
`OOS_2_BASELINE_RAW.json` (committed at `4a8c23057`) before any reclassification.

**Method:** Layer A (static, deterministic, re-runnable) over the shipped import door, plus
three independent adjudicators who were given each accepted script's Pine source and UCT's
result **but not the desired answer**, and who did not see each other's verdicts.

---

## 1. THE HEADLINE IS NOT ONE NUMBER

| Outcome | n | rate |
|---|---:|---:|
| RAW ACCEPTED | 18 | **30.0%** |
| ASSISTED ACCEPTED (raw + assisted) | 18 | **30.0%** |
| ASSISTED RECOVERY (of the raw shortfall) | 0 | **0.0%** |
| CORRECTLY REFUSED | 38 | 63.3% |
| SILENT FALSE SUCCESS | 3 | **5.0%** |
| INVALID SOURCE | 0 | 0.0% |
| UNKNOWN / NEEDS ADJUDICATION | 1 | 1.7% |
| **TRUTHFUL OUTCOME RATE** (did it tell the truth about *whether* it worked) | 56 | **93.3%** |
| **TRUTHFUL OUTCOME RATE, STRICT** (…and about *why*) | 52 | **86.7%** |

The strict rate deducts four refusals that name the wrong cause (§5). Both are reported
because the protocol's amendment A-1 requires it, and the amendment was written to cost us the
headline rather than absorb the defect.

### The journey, not the parse

Of 60 real indicators: 18 accepted · **6 carry a screenable boolean output (10%)** · 0 can be
screened as a numeric value (the scan gate is boolean-only by construction) · 17 carry
discovered input parameters.

**Parameter discovery is the strongest link in the chain; screener projection is the weakest.**

---

## 2. ASSISTED IMPORT RECOVERS NOTHING OUT OF SAMPLE

Assisted recovery is **0.0%** — not one of the 42 non-accepted scripts is rescued by the
assisted path. This is not a surprise; it is the predicted consequence of a fact already
verified in the code: the engine has exactly **one** machine-appliable offer
(`Resolver.mintickGuardOffer`, `pine.js:5040-5061`), and `pine.blindCorpusDecomposition.test.js:43-47`
asserts as an invariant that every other guard is NO_OFFER *by construction, not by defect*.

The 48-script development corpus shows RAW 27 → ASSISTED 36, a +9 uplift. That uplift is
entirely the mintick offer, and the mintick construct does not appear in this corpus. **Any
future report that quotes an "assisted" number should state which single rewrite produced it.**

---

## 3. ACCEPTANCE FALLS OFF A CLIFF AT THE OBJECT WALL

By the predeclared, source-only visual tiers:

| Tier | n | raw accepted |
|---|---:|---:|
| V0 — value/condition only | 3 | 0.0% |
| V1 — one basic visual series | 1 | 0.0% |
| V2 — multiple static series | 1 | 100.0% |
| V3 — coordinated + conditional appearance | 4 | 75.0% |
| V4 — sophisticated conditional composition | 8 | 50.0% |
| **V5 — object-heavy / stateful graphical** | **43** | **23.3%** |

**V5 is 43 of the 60 scripts.** This is what a modern Pine indicator *is*: 43 scripts make
1,204 calls into `label` / `line` / `box` / `table` / `polyline` / `linefill`, a median of 22
object call sites each. Only 3 of the 43 use objects incidentally (≤3 sites).

By engagement stratum, raw acceptance is high 45% · mid 35% · **long-tail 10%**. The long tail
is the most object-heavy and the most recently published, and it is where a real user's
personal, less-famous indicators live.

By Pine version: v4 50% · v6 26.7% (n=45). **The corpus is 45/60 Pine v6, and v6 is the harder
half** — modern Pine is object- and method-oriented.

---

## 4. THREE SILENT FALSE SUCCESSES — ALL ONE FAILURE MODE

Two independent adjudicators, working on different scripts without seeing each other's
verdicts, converged on the same shape. Total across all 21 accepted scripts:
**18 FAITHFUL · 3 MISLEADING · 0 CANNOT-TELL.**

> **ACCEPTANCE CAN REST ON A CONTENTLESS OUTPUT.**
> Every meaningful series is refused — correctly, with a named guard — and the script is
> accepted anyway because something with no information in it survived.

| Script | What survived | Why it passed the gate |
|---|---|---|
| `mid_engagement__01-zeiierman-trend-pressure` | 2 of 18 outputs: `-max(8, min(42, 20-(7-5)*4))` and `-100 + max(...)` — i.e. **the constants −12 and −88** | `readsBars` hole (below) |
| `mid_engagement__05-supertrend-fibonacci-ote` | 4 outputs: bare `open`/`high`/`low`/`close`. **The selected output is `open`.** | `plotcandle` passthrough |
| `long_tail__02-relative-volume-candles-narrow-ranges` | 4 outputs: bare `open`/`high`/`low`/`close` | `plotcandle` passthrough |

### 4a. The `readsBars` hole — verified by direct probe

`pine.js:8169`:

```js
if (n.type === 'series' || n.type === 'call') return true
```

**Any `call` node returns true immediately, without inspecting its arguments.** Measured:

| tree | `readsBars` | truth |
|---|---|---|
| `max(8, 42)` | **true** | constant |
| `-100 + max(8, min(42, 20 - (7 - 5) * 4))` | **true** | constant |
| `20 - (7 - 5) * 4` | false | constant ✓ |

Because `hidden = authorHid || !readsBars(ast)`, a constant-valued **call** walks straight
through the guard that exists precisely to stop a dead column being offered, counts as
`usable`, and can therefore make a whole script `ok: true`.

This is the same blind spot `pine.community.test.js` already documented for scripts 27 and 28
— *"`X && 0` LOOKS like it reads bars: it contains a call"* — closed there for the `and`/`or`
folding case and **still open in general**.

### 4b. The `plotcandle` passthrough — a direct consequence of Cluster 1

`plotcandle(open, high, low, close, color = <the whole indicator>)` expands to four numeric
columns whose formulas are literally `open`, `high`, `low`, `close`. Those genuinely read bars,
so nothing hides them. But **`plotcandle`'s entire payload is its `color=` argument**, and
presentation is discarded at the door (gap V-02).

So discarding presentation does not merely lose visuals: for a `plotcandle`-driven indicator it
converts the whole indicator into a re-plot of the chart's own price bars, which then passes the
acceptance gate. Mechanically measured across the corpus: **4 scripts hand back bare-OHLC
columns as usable output**, and in 2 of them *every* usable output is bare OHLC.

### 4c. What the adjudicators volunteered in UCT's favour

Both said it unprompted, and it is the most important positive finding in this report:

> Every `var`, `:=`, self-reference, loop-carried value, pivot and `valuewhen` in all 21 accepted
> scripts was **refused with a named guard rather than folded to a plausible number.**

Specific near-misses that did *not* happen: `timeframe.isweekly` was not folded to `false`;
six `:=`-driven alert flags were not collapsed to their `false` initialisers; an 8-way adaptive
filter chain folded to the correct default branch; two genuine stateful ratchets were carried as
real recurrences rather than flattened. **The refusal machinery is sound. The leak is one layer
up: nothing asks whether what was *kept* is worth keeping.**

---

## 5. REFUSAL ACCURACY — 38 refusals, 4 of them misdescribed, 1 silent

- **34 / 38 name the real cause.**
- **4 / 38 mischaracterise it.** They refuse with `pine:character` — *"Pine has no character like
  this one"* — on lines of valid Pine v6 containing no non-ASCII character at all. Isolated by
  direct probe: **a member access on a call result** (`arr.get(0).v`, `a.slice(0,1).size()`)
  trips the lexer's character guard. A member reading that sentence would conclude their script
  is corrupt. Affected: `high_engagement__08`, `high_engagement__17`, `high_engagement__18`,
  `long_tail__15`.
- **1 declines with no message at all** — `long_tail__17-db-seasonal-by-date-range` returns
  `ok:false` with `refusal: null`. Its only `plot()` is the `plot(0)` placeholder that
  table-drawing indicators conventionally carry; the engine correctly detects it reads no bars
  and correctly declines to offer it as a column, then says nothing.

### Primary blockers on the 42 non-accepted scripts

| n | guard | what it means |
|---:|---|---|
| 8 | `pine:function` | an unserved builtin |
| 7 | `pine:no-output` | **the script's only outputs are drawing objects** — the V5 wall, stated plainly |
| 6 | `pine:reassign` | loop/reassignment safety (RISK-043 working as designed) |
| 4 | `pine:character` | **misdescribed** — really `f(...).field` (§5) |
| 3 | `pine:tuple` | `[a, b] = f()` destructuring |
| 3 | `pine:state` | stateful construct outside the execution model |
| 3 | `pine:builtin` | an unserved name |
| 2 | `pine:request` | multi-timeframe |
| 2 | `pine:function-def` | user-defined function shape |

`pine:no-output` at 7 is worth reading twice: seven real published indicators produce **nothing
this engine can even offer**, because everything they draw is a drawing object.

---

## 6. VISUAL PRIMITIVE DEMAND vs SUPPORT

Demand is measured from the source only. Support is code-verified (see `ENDZONE_GAP_REGISTER.md`).

| Primitive | scripts | call sites | support today |
|---|---:|---:|---|
| `plot()` | 33/60 | 195 | CARRIED — but style/colour/width/title dropped (V-02…V-05) |
| `label`/`line`/`box`/`table` objects | **43/60** | **1204** | **ABSENT** — refused `pine:drawing` (V-24) |
| dynamic colour | **40/60** | — | **PARTIAL** — sign-of-zero only (V-12) |
| conditional visibility | 25/60 | — | PARTIAL — via NaN gaps only |
| `plotshape`/`char`/`arrow` | 19/60 | 69 | VALUE ONLY — glyph, anchoring, direction lost (V-22) |
| `fill()` | 17/60 | 35 | **SCHEMA-INERT** — validated, carried, drawn by nothing (V-10) |
| `bgcolor()`/`barcolor()` | 17/60 | 24 | ABSENT — reserved style, refused (V-20/21) |
| `hline()` | 10/60 | 19 | DROPPED at import, though the schema has a first-class `hlines` plot (V-07) |
| `plotcandle`/`plotbar` | 5/60 | 6 | 4 numeric columns, no candle (V-23) |

**Two of the top three demanded capabilities are things UCT can nearly already do.** Dynamic
colour (40/60) needs `colorMode:'column:<key>'` un-inerted; `fill()` (17/60) is validated,
cross-checked and carried by the schema today with no renderer reading it. `hline` (10/60) needs
only that the importer stop dropping it.

---

## 7. CHART, PERSISTENCE AND VISUAL FIDELITY — HONESTLY, NOT YET MEASURED

**TRANSLATES ≠ RENDERS, and this report does not claim otherwise.**

The Layer C environment is built and proven end-to-end this session: an isolated sandbox backend
(verified pinned to a temp directory, never live `C:\data`), admin auth, the real `/charts`
workspace rendering real SPY bars, the Indicators → New formula → Import path reachable, the
import report readable by `data-testid`, and a fixture-delivery route through `/assets/` that
makes byte-exact pasting cheap. One complete paste-to-report cycle was executed.

What has **not** been done, and is therefore reported as UNMEASURED rather than estimated:
per-script chart rendering, pane placement, visual fidelity grading, input-change propagation,
and save → close → reopen persistence for the parity set. That is the first task of the next
wave, and the Complex Pine Visual Parity Set exists to receive it.

### The Complex Pine Visual Parity Set (selected by a rule committed before any result existed)

10 scripts, V4/V5 only, ranked by distinct visual families then depth then SHA-256, capped at 4
per stratum and 1 per author. **7 of the 10 were accepted; 3 were refused** — which is itself the
right shape for an acceptance suite, since it must be able to fail.

Coverage: `plot()` 10/10 · `fill()` 9/10 · objects 9/10 · dynamic colour 8/10 · conditional
visibility 9/10 · shapes 7/10 · bgcolor/barcolor 6/10 · `hline()` 5/10 · candles 2/10.

Notably `mid_engagement__05-supertrend-fibonacci-ote` — the richest script in the corpus at 147
visual call sites — is in the set **and is one of the three silent false successes**. Its import
hands back the raw open price.

---

## 8. WHAT THIS BASELINE DOES AND DOES NOT SUPPORT

**Supported by evidence.** UCT refuses honestly and specifically in the overwhelming majority of
cases; it does not fabricate numbers; its stateful-construct discipline is genuinely good and was
independently praised by two adjudicators who were looking for the opposite.

**Not supported by evidence.** Any claim of the form *"import your TradingView indicators"*. On a
corpus UCT was never tuned against, 30% of real indicators import at all, 10% reach the screener,
5% are accepted on contentless output, and the visual layer that defines what these indicators
*are* is discarded at the door.

The gap between the 48-script corpus's 27→36/48 and this corpus's 18/60 is not a regression and
not a contradiction. It is the difference between a corpus that is **100% V1** and one that is
**72% V5**.

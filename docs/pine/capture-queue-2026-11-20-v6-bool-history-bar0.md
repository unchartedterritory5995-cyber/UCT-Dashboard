# Capture queue: what a Pine v6 bool's history holds before bar 0 (2026-11-20)

Coordinator ruling 2026-11-20 (libchain finding 3). Same procedure as `docs/pine/capture-queue-2026-09-28.md`:
capture from the listing, keep the plotted values as full float64 text, record each capture's own `capturedAtUTC`.
The probes are `vw-v6-bool-history-bar0.pine` and `vw-v6-bool-history-bar0-na.pine`, ours (licence `probe`).

**Why.** A Pine v6 bool is never `na` ("To Pine Script version 6", "Boolean values cannot be na"), so `b[1]` on
bar 0 should read `false`. This engine holds that history as `na`. As a condition the two agree (an `na` condition
reads false), but as `== false`, `!= true`, `not`, or compared with another bool they do not. Measured 2026-11-20,
v6, from the listing, `b = close > 100`, bar 0:

Each form below: runtime lane / host lane / what it reads if v6 hands `false`.

- `b[1] == false ? 1 : 0`: 0 / 0 / 1
- `b[1] != true ? 1 : 0`: 0 / 0 / 1
- `not b[1] ? 1 : 0`: 0 / `na` / 1
- `b[1] == b ? 1 : 0`: 0 / 0 / 1
- `c[1] == false ? 1 : 0` (`var bool c`): 0 / 0 / 1
- `not c[1] ? 1 : 0` (`var bool c`): 1 / `na` / 1
- `b[1] ? 1 : 0`, `b[1] == true`, `b[1] != false`, `b[1] and true`, `b[1] or false`: 0 / 0 or `na` / 0
- `ta.barssince(b[1])`, `ta.valuewhen(b[1], close, 0)`: agree with `false` / - / -

So if TradingView hands `false`, the run draws bar 0 wrong for those five forms (the first `k` bars for `b[k]`).
That is one bar per script, but it is a wrong picture on served scripts. If the capture grades our 0 wrong, the fix
is NUMBER PENDING.

**Census (scoped, 2026-11-20).** Served v6 scripts in the committed coverage map (`attached` or `runtimeAttached`):
137. Ten of them read a bool's history in one of those forms. The census is a static scan of their sources: bools
are names declared `bool` or bound to a comparison or logic, the forms are `== false`, `!= true`, `not`, and
`==` / `!=` against another bool.

- `committed:artemis-oscillator-pro__ea1097ca9e` (`not`): `mtfAligned and not mtfAligned[1]`
- `committed:atr-support-and-resistance__3e9ddb38c4` (`not`): `rsiSupportInput and not rsiSR[1]` (twice)
- `committed:ema-ribbon-trend-filter-strixedge__737f5c58ad` (`not`): `not isBullish[1] and not isBearish[1]`, `isSqueeze and not isSqueeze[1]`, an alertcondition
- `committed:fibonacci-dolphintradebot__d93b208611` (`== false`): `kop == true and kop[1] == false` (an `if` and a `plotchar`)
- `committed:ict-killzones-pivots-tfo__d0b8be94f1` (`not`): `t and not t[1]` (twice)
- `committed:session-highs-and-lows-indicator-smc-sessions-dst-safe__c0ca8cf749` (`not`): `inSess and not inSess[1]`
- `committed:swing-highlow-zigzag-chartprime__c53f5bc4e2` (`not`, `!=`): `trend and not trend[1]`, `trend != trend[1]`
- `committed:trend-duration-forecast-chartprime__2c5c233f31` (`!=`): `trend != trend[1]`
- `reference:auto-length-moving-average-trend-signals-zeiierman__30185ad35b` (`!=`, `not`): `trend != trend[1]`, `confirmedUptrend and not confirmedUptrend[1]`
- `reference:dual-supertrend-ichimoku-and-dmi-color-weighted-by-dgt__6pPzwGaxjU` (`not`): `stBull and not stBull[1]`

Each one can differ only on bar 0, and only if its bool is true there (the edge idiom `x and not x[1]` then draws an
edge on bar 0 under `false` and none under `na`).

**What the committed captures already say (2026-11-20, the committed runtime-on and production snapshots, engine 85).**
Eight of the ten have committed captures (the two `reference:` scripts have none). Every SPY capture among them
starts after the listing (`startsAtBar0` false), so it says nothing about bar 0. The RDDT 1D captures start at the
listing, and bar 0 is compared there (`warmupBars` 0, every bar compared):

- MATCH on bar 0 for every plot: `atr-support-and-resistance` (9), `fibonacci-dolphintradebot` (2), `ict-killzones-pivots-tfo` (7),
  `swing-highlow-zigzag-chartprime` (1), `trend-duration-forecast-chartprime` (1), and `artemis-oscillator-pro` and
  `ema-ribbon-trend-filter-strixedge` (every plot, though the captures DIVERGE elsewhere).
- Objects MATCH (runtime-on) for `atr-support-and-resistance`, `ict-killzones-pivots-tfo`, `swing-highlow-zigzag-chartprime`,
  `trend-duration-forecast-chartprime`, whose affected reads gate drawings.
- `session-highs-and-lows-indicator-smc-sessions-dst-safe`: INCONCLUSIVE, bar 0 not compared.

**This bounds nothing yet.** In each affected expression the two readings differ on bar 0 only when the bool is
true there. `fibonacci-dolphintradebot`'s `kop` is a `var bool` initialised `false`, so on bar 0 both readings agree and its
MATCH cannot tell them apart. For the others, whether the bool is true on bar 0 of those captures was not checked,
so their bar-0 MATCHes either agree with `na` or never met the case. Q-BH0 settles it directly.

| id | probe | chart | question | live | phase |
|---|---|---|---|---|---|
| Q-BH0-a | `vw-v6-bool-history-bar0.pine` | AMEX:SPY 1D | from the listing, bars 0-3 of H01-H10: does a v6 bool's history before bar 0 read `false` (H01, H03-H08, H10 draw 1 on bar 0) or `na` (they draw 0)? | no | - |
| Q-BH0-b | `vw-v6-bool-history-bar0.pine` | NYSE:RDDT 1D | the same rows on a second listing, so a one-chart quirk cannot settle it | no | - |
| Q-BH0-c | `vw-v6-bool-history-bar0-na.pine` | NYSE:RDDT 1D | `na(b[1]) ? -1 : 0` on bar 0; if v6 refuses to compile `na()` of a bool, keep the compile error's text as the answer | no | - |

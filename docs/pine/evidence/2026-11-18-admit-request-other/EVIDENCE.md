# `request-other` admission: graded at engine 74, and HELD (2026-11-18)

Ask (coordinator, parity roadmap unit `admit:request-other`, PR #1766): `request-other` stands in front of
130 sample scripts and every request unit. The roadmap had one community capture ready (fair-value-gap) and asked
for one more. Read what the capability covers, find the best-placed second community capture, grade it at the
current engine number, and add the registry row if the evidence meets the rule; otherwise send capture rows.

Base: `origin/master` `c233623449` (`SCRIPT_ENGINE_VERSION = 74`). Branch `feat/admit-request-other`, stacked
on `feat/admit-obj-linefill` (both append to `evidence-ledger.jsonl`). No engine number.

## 1. The answer

- **A second community script exists and grades MATCH at 74: `pa-zigzag-fibonacci-fan`** ("PA ZigZag
  Fibonacci FAN", RicardoSantos, MPL-2.0). With fair-value-gap the counts are met: 4 captures, 2 scripts, both
  community, every one runtime-on MATCH at engine 74 and drawn by the runtime lane.
- **The row is NOT added: HELD, the same reading as `calc-bars` (U3b).** In all four captures the request is
  the chart's own symbol at the chart's own period: fair-value-gap's `MTF Timeframe` defaults to `"D"`, PA
  ZigZag's `Alt Timeframe` to `'1D'`, both on 1D charts. A run that ignored `request.security` and evaluated
  the expression in place would draw the same picture, so the captures witness the identity fold and nothing
  about another symbol or timeframe. The registry readme holds `calc-bars` on exactly this ground ("ignoring the
  argument draws the same picture and the capture witnesses nothing about it"). Admitting `request-other` on it
  would serve every higher-timeframe read the runtime lane draws on evidence that never measured one.
- **Capture rows sent to patrick-54** (section 5): PA ZigZag at `Alt Timeframe` = 1W and 1M on NYSE:RDDT 1D
  and AMEX:SPY 1D. The runtime lane draws the script with those timeframes written as the input's DEFAULT
  (measured at 73 and 74), but not as a member's moved setting: the four captures grade INCONCLUSIVE because the
  door folds `input.timeframe` to a constant (section 5). That is an engine unit (settings parity for timeframe
  inputs), not a capture.
- **Served to members: 275 / 679 before and after** (no registry change). With the row it would be 276.

## 2. What `request-other` covers

`api/services/pine_capabilities.py::capabilities_of` names it for:

1. any `request.<name>(` call (`_REQUEST_RX`): `request.security`, `request.security_lower_tf`,
   `request.financial`, `request.dividends`, `request.splits`, `request.earnings`, `request.economic`,
   `request.quandl`, `request.seed`, `request.currency_rate`, `request.footprint`, every other `request.*`;
   **the chart's own symbol at the chart's own period included** (over-declared: "the identity request is
   folded by the run, but no capture grades the fold");
2. the v1-v4 bare spellings `security(` and `financial(`;
3. the repaint classifier's reads (`runtime_repaint.RULES["requests"]`): a `request.security` / `security`
   call that is not the identity (`syminfo.tickerid` with `timeframe.period` or `""`), and any identifier that
   starts with `request.`.

What the runtime lane draws of these today (the member door, `memberPaneDefinition.js::runtimeLaneDefinition`
RT2 and `pineRuntimeFrontend.js`): the identity (and an empty symbol); the chart's own symbol at a weekly or
monthly period, look-ahead off, or on at W / M (`runtime/requestSupply.js`). Refused by name: another symbol
(`runtime:request`, "a script drawn bar by bar ... is not handed yet"), a lower timeframe (`lower-tf:*`), a
request whose expression reads this chart's mutable state (`runtime:request-with-state`), look-ahead at any other
period and `gaps` on (`runtime:request`), a Heikin Ashi ticker, and the non-`security` requests (`pine:request`).

## 3. The rule, clause by clause

| clause | fair-value-gap (Fair Value Gap [SpaceManBTC]) | pa-zigzag-fibonacci-fan |
|---|---|---|
| community script | yes | yes (title "F") |
| distinct family | 1 | 2 |
| captures | `fair-value-gap-rddt-1d-2026-11-14`, `-11-15` | `pa-zigzag-fibonacci-fan-rddt-1d-2026-10-02`, `-spy-1d-2026-10-03` |
| runtime-on MATCH at engine 74 (ledger rows, this PR) | MATCH, MATCH | MATCH, MATCH |
| in the committed runtime-on snapshot (A8) | MATCH, MATCH | MATCH, MATCH |
| drawn by the runtime lane (`CAPADMIT_MODE=lanes` door, 74) | runtime | runtime (production draws it on the host lane too: MATCH) |
| the request in the capture | `request.security(syminfo.tickerid, i_tf, …, lookahead_on)`, `i_tf = "D"` on 1D | `request.security(_ticker, tf, zigzag(), …, lookahead_on)`, `tf = '1D'` on 1D |
| witnesses another symbol or timeframe | **no** (identity) | **no** (identity) |

Counts: 4 captures / 2 scripts / 2 community: met. Binding: 0 of 2 scripts.

## 4. The DIVERGE check (what the row would admit)

Over every committed capture, graded at engine 74 on both lanes (`runs` below): a `request-other` row would make
**75 sources (201 captures)** admissible by capability. **11 of them have a capture that DIVERGES** on either lane,
and each would need a kill entry (the DRAW-1 rule) before the row: AOP PRO (artemis-oscillator-pro), ADR Pivots
(SPY 11-15), Dual View HTF Candlestick Patterns, EMA Ribbon Trend Filter, HTF Liquidity Dashboard, Position Size
Calc, VOLD Market Breadth, RS Rating (production DIVERGE; it is served per script on the substituted path), and
the probes UCTPROBE_REQ_REALTIME, UCTPROBE_RS_SEED_RSRATING, UCTPROBE_OTHER_SYMBOL. All eleven are drawn by the
HOST lane today (the `lanes` door at 74), so the DIVERGEs are production pictures the row would not change; the
kill entries would keep route-by-cost from moving them to the runtime lane once the capability is admitted.

## 5. Capture rows (sent to patrick-54, 2026-11-18)

Script `corpus/committed/pa-zigzag-fibonacci-fan__2001.pine`, source sha256
`eac077d8667390748224f9d4f084d828cfc1455c8d451740b14cef22678bc04b`; from the listing, object x table recorded,
every other setting at its default:

| row | chart | settings |
|---|---|---|
| Q-RO-1a | NYSE:RDDT 1D | Use Alt Timeframe? = on; Alt Timeframe = 1W |
| Q-RO-1b | AMEX:SPY 1D | Use Alt Timeframe? = on; Alt Timeframe = 1W |
| Q-RO-2a | NYSE:RDDT 1D | Use Alt Timeframe? = on; Alt Timeframe = 1M |
| Q-RO-2b | AMEX:SPY 1D | Use Alt Timeframe? = on; Alt Timeframe = 1M |

**Taken and graded the same day (patrick-54, run `rozz-2026-11-18`, local; packet sha256 `61a1e407…`): 4 / 4
INCONCLUSIVE on both lanes, and the gap is ours.** The member door folds `tf = input.timeframe('1D', 'Alt
Timeframe')` to a constant: the document's settings are only colours and widths (its `paramManifest` is empty),
so the harness reads "Alt Timeframe (tf) was moved and is not a setting of our document". The variant measured in
section 1 changed the DEFAULT in the source, which the door does fold; a member's moved setting it does not carry.
The engine unit this asks for is settings parity for `input.timeframe` (a coordinator follow-up, after e75); the
four captures re-grade as they are once it lands.

Not requested: fair-value-gap at `MTF Timeframe` = W or M is refused on our side (`runtime:unbound`, host
`pine:object-removal-lost`), so its capture would grade INCONCLUSIVE. With the PA ZigZag rows graded MATCH, one
script binds; by the `calc-bars` reading a second binding community script is still owed, and none exists: of the
215 sample scripts that use `request-other` or `obj:linefill`, the runtime lane draws 7, and among them only
fair-value-gap and PA ZigZag request anything.

## 6. Runs (engine 74, `c233623449`)

All at `c233623449` (engine 74), every heavy step under the machine-wide heavy lock, `--maxWorkers=1`, the
head recorded before and after (the branch commits change only `evidence-ledger.jsonl`). Outputs stay in a local
scratch directory; only identifiers and counts are written here.

| run | result |
|---|---|
| member door, `lanes` mode (every script graded, the runtime pane on; `capabilityAdmission.measure.test.js`'s door, plus whether `compute.objects` is true), over the 253 committed captures and 209 local-only captures that use `obj:linefill` or `request-other`, the 215 sample scripts that do, and 6 timeframe variants | runtime lane 24 rows: fair-value-gap x2, FVG Finder x2, PA ZigZag x2, AlgoAlpha x4 (objects: host program, 64 ops), linear-regression-channel (held) x1, best-sr-indicator (held) x2, the 7 sample scripts, PA ZigZag at W / M / 1D, fair-value-gap at 1D (at W and M: refused `runtime:unbound`); identical to the same measurement at engine 73 |
| vendor harness, runtime-on, every committed capture (`tests/fixtures/vendor`) | 915 graded: MATCH 312, DIVERGE 79, INCONCLUSIVE 504, MATCH_SUBSTITUTED 20; `LANE MEASURED: runtime-on (gate OPEN, runtime lane reached 499 ...) runtime drew 192, declined 307`; 5.4 min. Against the committed snapshot 34 captures move, every one a strategy (W9 broker probes, macd / tradingview-alerts / supertrend strategies) or two `vw-` probes; no `obj:linefill` or `request-other` capture moves |
| vendor harness, production | 915 graded: MATCH 207, DIVERGE 81, INCONCLUSIVE 627; 5.1 min |
| `evidence_engine.py regrade` (both lanes, its own lock) | 4 captures, 4 ledger rows at engine 74 (grader `5500f8f1c291`, this PR): runtime-on 4 MATCH |
| census, both lanes, and the engine door (`run_census.py`, `coverageMapDoorCensus.measure.test.js`), the 11-17 sample manifest | 967 / 967 rows each lane; map: host-only 220 / 679, runtime-on 285 / 679, runtime-attached 88 |
| `parity_roadmap.py facts` + `build` (master's registry) | **SERVED 275 / 679** (allowlisted 1, capability 54, not admitted 10), as at engine 73 |
| the same with a hypothetical row (a temp copy of the registry; the committed file untouched) | `request-other` admitted: 276 / 679 (+1: fair-value-gap; PA ZigZag is already served on the host lane) |

## 7. Addendum, same day: the follow-up captures, graded at engine 75 (still HELD)

patrick-54 took the second-binding-script row (run `adm-2026-11-18`, local; packet `b416f5fa…`; from the listing,
defaults, x table recorded). Filed as ledger rows at engine 75 (`evidence_engine.py regrade`, both lanes) and graded
runtime-on at `394853a21e`:

| capture | production | runtime-on | for this unit |
|---|---|---|---|
| `support-and-resistance-multi-time-frame-rddt-1d-2026-11-18` ("SNR": syminfo.tickerid at W, W, M, look-ahead off) | MATCH, 7 / 7 | MATCH, 7 / 7 | drawn by the HOST lane (the runtime lane refuses it, `runtime:request-with-state`): not runtime-drawn evidence until that wall moves |
| `support-and-resistance-multi-time-frame-spy-1d-2026-11-18` | DIVERGE, 3 of 7 | DIVERGE, 3 of 7 | not evidence: the weekly / monthly reads differ on early SHORT periods (below) |

**The SPY difference is a period-close rule, not the feed.** TradingView's weekly and monthly values in that capture
are folds of its own daily bars (480 / 480 distinct weekly highs, 57 / 57 weekly lows, 159 / 159 monthly highs,
9 / 9 monthly lows). What differs is the BAR a completed period first appears on: TradingView shows a week whose last
session is not a Friday on the NEXT bar through 2001 (every one of the 10 short weeks whose value changes:
1994-03-31, Good Friday 1995 / 1998, 3 July 1997 / 1998, 24 and 31 December 1998, 23 December 1999,
10 September 2001; and the month ending Friday 28 May 1999), and on its LAST bar from 2004 on (every one of 14), while
ours shows every period on its last bar. It is the roadmap's new wall U-HTF-CALENDAR (under U-REQ). Until it lands, a
weekly or monthly capture of a symbol whose history reaches before 2004 is not request-other evidence unless no
plotted value changes on such a period; the captures counted so far (fair-value-gap RDDT, PA ZigZag RDDT / SPY) read the
chart's own period only and depend on none of it.

**The switch year, read 2026-11-18 (Q-HTF-CAL-1a / 1b, packet `39001cc9653b`, promoted as licence `probe`).** Our
probe's own weekly and monthly close with look-ahead off (A02 / A05) on AMEX:SPY 1D (8,509 bars from the 1993 listing)
and NASDAQ:QQQ 1D (6,967 bars from the 1999 listing) settles the gap between 2001 and 2004 above: **TradingView's
calendar begins in 2000 on both exchanges.** Every short week and month through 1999 is shown on the NEXT bar (SPY 13
weeks and 2 months, QQQ 2 weeks and 1 month), every one from 2000 on its LAST bar (46 weeks and 7 months on each,
20 April 2000 the first), except the week of 10 September 2001 (11-14 September closed without notice), shown on the
NEXT bar on both. So the boundary in the rule above is 2000, not 2004, plus that one week; the roadmap entry
U-HTF-CALENDAR carries the year-by-year read.

Counted for `request-other` after the follow-up: unchanged (4 captures, 2 scripts, both the identity request: HELD).
The PA ZigZag 1W / 1M captures (`rozz-2026-11-18`) reach the run through the timeframe setting (#1831) and DIVERGE
there on 9 of 10 items, so no binding capture exists yet.

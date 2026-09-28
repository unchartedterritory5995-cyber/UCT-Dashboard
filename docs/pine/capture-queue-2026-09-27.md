# Capture queue — 2026-09-27 vocabulary wave

Branch `pine/vocabulary-wave`. Seven probes under `tools/visual_conformance/probes/vw-*.pine`,
written for the parent session to run on the live TradingView rig with
`tools/vendor_harness/tv_capture.js` (procedure: `docs/pine/VENDOR-HARNESS.md` on master —
visibility gate, scratch layout, **Create new ▸ Indicator**, "Add to chart" binding gate,
`__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`). Every probe keeps inputs
at their defaults, plots each quantity under its own title, and carries a `bar_index`
control plus the discriminator channels that prove the capture could have answered.

⛔ Read a probe's header before capturing it: several need TWO charts (1D and intraday),
and one needs the symbol's FULL history loaded. A capture that does not span what the
header names answers nothing while looking conclusive (`r11-time-session`, 2026-09-11).

The door census these probes serve is in `PARITY-PROGRAMME.md` → "2026-09-27 — THE
VOCABULARY WAVE". "Last wall" below means: substitute a correct-type value for the name
(never delete a binding) and the script ATTACHES at the member door
(`memberPaneDefinition`, objects-only flag on AND off — identical for every script here).

## Priority order

| # | probe | class | what it settles | last-wall scripts it could unblock |
|---|---|---|---|---|
| 1 | `vw-time-session.pine` | C | `time(tf, session[, tz])` on a **daily** bar, on straddling 60m bars, day-suffix and zone argument | **1** — `opening-range-initial-balance-opening-price__4a7416ab01` (sole last wall) |
| 2 | `vw-time-tf.pine` | A-partial / C | `time("W")` in holiday-Monday weeks, `time("M"/"3M"/"12M"/"60")`, `timeframe.in_seconds` per code, `input.time`'s default value | 0 as a last wall; first wall of 2 (`smart-money-concepts-by-welotrades`, `zigzag-ma-pattern-recognition`) and inside 4 more; `input.time` is the sole last wall of `session-hilo__WM2g5GtC4h` (**1**, blocked by a ruling, below) |
| 3 | `vw-nvi-pvi.pine` | C (ruling input) | `ta.pvi` seed + rule (unread), and the fetch dependence of the `nvi` level measured instead of argued | **2 jointly** — `smart-money-interest-index-algoalpha__effdd7852c`, `smart-money-volume-index-algoalpha__6663950b80` (both need nvi AND pvi); **refused by ruling** today |
| 4 | `vw-int-cast.pine` | C | `int(x)` on a fractional float: truncate, floor or round | 0 (first wall of `smarter-snr__ac98ab25d5`, whose next wall is `pine:window`) |
| 5 | `vw-clock-vwap.pine` | B confirm + A re-read | the two identities SHIPPED on this branch (`field(time)`, `ta.vwap(hlc3)`) | 0 — confirmation of shipped behaviour |
| 6 | `vw-mintick.pine` | C (data) | the vendor's `syminfo.mintick` across price regimes and asset classes | 0 (first wall of 2, inside 2) |
| 7 | `vw-alma.pine` | B (not built) | `ta.alma` warm-up, `floor`, orientation, `na` in the window | 0 (masked by a library import in its one script) |

## Per probe — what it measures and what our implementation must match

### 1. `vw-time-session.pine` — the session clock on a daily bar
**Capture:** AMEX:SPY **1D** (≥ 300 bars, spanning both DST changes), AMEX:SPY **60**
extended OFF, AMEX:SPY **60** extended ON.
**On disk already:** 5m, extended ON — `na` outside, the bar's own `time` inside, window
half-open `[09:30, 16:00)` (`r11-time-session-spy-5m-2026-09-11.json`).
**Unread, and each is a fork in the implementation:**
- S03–S08: on a **1D** bar, is `time(tf, "0930-1600")` the bar's time (S04 = 0) or `na`?
  And for a window that does NOT contain 09:30 (`"1000-1100"`, S07)? If S07 is `na` while
  S05 (`"0930-1000"`) is not, membership is the bar's OPEN time; if both are non-`na`, it is
  overlap. The engine's current refusal assumes a daily bar has "no inside to be in" — S03
  decides whether that is TradingView's answer or ours.
- S09/S10 + S18: the day suffix — `:1234567` (all days) vs `:23456` (Mon–Fri) against
  `dayofweek`.
- S11–S14: the zone argument. The corpus form is a FIXED `"GMT-4"` (not DST-aware), so in
  EST months the window shifts an hour against New York — S11 vs S13 across November.
- S15: an overnight window, S16/S17 the IB window (`0930-1030`) that straddles 60m bars.

**What we must match** before `time(<session>)` can be admitted: S03/S05/S07/S09/S10/S11
on the **1D** capture, bar for bar. If a daily bar is always inside a window containing its
open time, the translation is a membership test over the engine's `hour`/`minute`/
`dayofweek` clock (no new column) — but only for zone arguments the capture shows how to
honour; `"GMT-4"` needs its own DST-shifted rule, read off S11, not inferred.

### 2. `vw-time-tf.pine` — periods beyond "D", and two constants
**Capture:** AMEX:SPY **1D**, ≥ 800 bars (must include holiday Mondays), plus a 60m capture
for T06.
**On disk already:** `time("W")` on 1D = the forming week's open, equal to the first daily
bar of the week (`r11-time-tf-spy-1d-2026-09-11.json`, 610 bars, summary only — per-bar
rows were not kept).
**Unread:** T01 in weeks whose Monday is a holiday (is the weekly open Tuesday's bar time,
delta 0 on Tuesday, or a Monday with no bar, delta −1?); T02–T04 for M/3M/12M (does the
monthly open sit on the first TRADING day?); T06 on 1D (an intraday period on a daily chart);
T10–T15 `timeframe.in_seconds` per code (the reference gives `"M"` = 2 628 003 s; the door
folds only the chart's own period today); T16 `input.time` at its default.
**What we must match:** a `weekopentime`/`monthopentime` clock column (both lanes — this is
a NEW table name, so it owes a corpus case and a Python twin, the `dayopentime` precedent in
`8a4b8ddd1`) must reproduce T01–T02 on every bar, holiday weeks included; the new-period
idiom T07–T09 must follow from it. `timeframe.in_seconds(<literal>)` must equal T10–T15.

### 3. `vw-nvi-pvi.pine` — input to a ruling, not a build
**Capture:** AMEX:SPY 1D **twice** — full history loaded to 1993 (`startsAtBar0: true`), and
only the last ~1,000 bars.
**On disk:** nvi seeds at 1 and multiplies by `1 + Δclose/close[1]` only when volume fell
(`r11-nvi-spy-2026-09-11.json`).
**Unread:** `pvi` (P02/P04/P05) — the ruling calls it "the exact mirror" from TradingView's
published example, not from a capture; and whether P01 on the same date differs between
the two captures (the fetch dependence `_functions_excluded.nvi` reasons from). P06/P07
are the corpus's own quantity, `x - ta.ema(x, 255)`, so a decision can size the drift.
**What we would have to match** if the ruling were ever reopened: P01/P02 on every bar at
the vendor's own depth — which a bounded fetch cannot do unless P01 is depth-independent.
The ruling stands until the owner reopens it.

### 4. `vw-int-cast.pine` — truncate, floor or round
**Capture:** AMEX:SPY 1D, ≥ 200 bars. A compile failure on any line is itself the reading.
**What each row decides:** I01–I05 constants whose answer differs under every candidate rule
(table in the probe header); I06–I08 the same on a series, where exactly one of
`int(x) - trunc(x)`, `- floor(x)`, `- round(x)` must be 0 on every bar; I09 `int(na)`.
**What we must match:** if I06 is all-zero, `int(x)` becomes `idiv(x, 1)` (declared: "rounded
toward zero"); if I07, `floor(x)`; if I08, `round(x)` — each already a table function, so no
new name. Until then the door keeps refusing a fractional argument (`pine.js`, the `int`
branch).

### 5. `vw-clock-vwap.pine` — confirm what shipped
**Capture:** AMEX:SPY 1D (≥ 400 bars, spanning a year boundary) and AMEX:SPY 5m, extended ON.
**What we must match (already built):** V01–V06 exactly 0 on every bar (the engine now reads
`year(time)` as `year`, etc.); V07 exactly 0 and V08 NOT all-zero (the engine reads
`ta.vwap(hlc3)` as `vwap()` and refuses every other source). V09–V12 are the raw columns the
vendor harness compares bar by bar against the member door. If V01–V06 is ever non-zero,
the identity is wrong and `clockFieldAt` must go back to refusing — the rail
`pineVocabularyWave.test.js` names both halves.

### 6. `vw-mintick.pine` — a data value, per symbol
**Capture:** 1D, ≥ 5 bars each, on SPY, AAPL, a sub-$1 US listing, a $1–$5 name, BRK.A,
SP:SPX, CME_MINI:ES1!, FX:EURUSD, BINANCE:BTCUSDT.
**What we would have to match:** M01 per symbol. The engine holds no tick size
(`symbolScope.json::unserved`); a serving rule ("US equities ≥ $1 → 0.01") is a proposal
only this table can justify, and it must list every class it does NOT cover.

### 7. `vw-alma.pine` — priced, not built
**Capture:** AMEX:SPY 1D, ≥ 300 bars. Alone in its file (the bare-`alma` probe failed to
compile and took every plot with it — bare `alma` must NEVER be added).
**What we must match** if built: A01/A02 to float precision, first non-`na` at A03, A05's
`na` behaviour. It is a new table function (both lanes), and its one corpus script is
masked by a library import, so it unblocks nothing today.

## Blocked by a RULING, not by a missing capture — for the owner

| name | evidence on disk | ruling that blocks it | scripts |
|---|---|---|---|
| `barstate.isnew` | `barstate-full-spy-1d-closed-2026-09-10.json`: `1` on every historical bar, `0` on the newest bar of a closed chart | `closedTable.json::_barstate.refused.isnew` — "requires per-tick evaluation" | first wall of 2; last wall of 0 (next walls `pine:request`, `pine:reassign`) |
| `input.time` | none needed for the default value (T16 confirms it) | `pine:input-kind` — "under the threshold", item (c) | sole last wall of `session-hilo__WM2g5GtC4h` (1) |
| `ta.nvi` / `ta.pvi` | nvi seed + rule; pvi unread | `_functions_excluded.nvi` / `.pvi` — fetch-dependent level | joint last wall of 2 |
| `time(<session>)` on daily bars | 5m only | the refusal text: "This engine screens daily bars" | sole last wall of 1 |

## CAPTURED — 2026-09-27, the parent session (rig layout 01f1AcIj)

Seventeen captures under `tests/fixtures/vendor/`, every one verified by
`verify_capture.mjs --assemble` (VERDICT PASS), every embedded source byte-identical to
its probe on this branch (sources fetched from the branch's own commit `4b21c2474` and
sha-checked in the page before they ran). Depth was forced with **Go to date**, never
the `All` button.

| probe | capture | bars | what it covers |
|---|---|---|---|
| `vw-time-session` | `vw-time-session-spy-1d-2026-09-27.json` | 8472 | the **1D** leg — full SPY history 1993→, every DST change |
| `vw-time-tf` | `vw-time-tf-spy-1d-2026-09-27.json` | 8472 | ≥ 800 bars incl. every holiday Monday |
| `vw-nvi-pvi` | `vw-nvi-pvi-spy-1d-full-2026-09-27.json` | 8472 | FULL history (starts at SPY's first bar, 1993) |
| `vw-nvi-pvi` | `vw-nvi-pvi-spy-1d-truncated-2026-09-27.json` | 1040 | the same chart with ~1,000 bars loaded — the fetch-dependence ratio |
| `vw-int-cast` | `vw-int-cast-spy-1d-2026-09-27.json` | 300 | ≥ 200 |
| `vw-clock-vwap` | `vw-clock-vwap-spy-1d-2026-09-27.json` | 8472 | the **1D** leg, spans every year and month boundary |
| `vw-alma` | `vw-alma-spy-1d-2026-09-27.json` | 8472 | ≥ 300 |
| `vw-mintick` | `vw-mintick-<sym>-1d-2026-09-27.json` ×10 | 374–1040 | the nine symbols named, plus a second sub-$1 name |

⛔ **STILL OWED — the intraday legs:** `vw-time-session` on AMEX:SPY **60** with extended
hours OFF and ON, and `vw-clock-vwap` on AMEX:SPY **5m** extended ON. The 1D legs above
answer S03–S11 and V13–V14 on their own; the straddle rows (S16/S17) and the intraday
clock rows need those charts.

### `syminfo.mintick`, read off the captures (M01; constant on every bar of every capture)

| symbol | last close (M03) | mintick | pricescale / minmove |
|---|---|---|---|
| AMEX:SPY | 771.35 | 0.01 | 100 |
| NASDAQ:AAPL | 341.07 | 0.01 | 100 |
| NYSE:BRK.A | 758505.68 | 0.01 | 100 |
| NASDAQ:SNDL | 1.40 ($1–5) | 0.01 | 100 |
| NASDAQ:NKLA | 0.183 (sub-$1) | 0.01 | 100 |
| OTC:AITX | 0.003 (sub-cent) | 0.0001 | 10000 |
| SP:SPX | 7743.41 (index) | 0.01 | 100 |
| CME_MINI:ES1! | 7803.75 (future) | 0.25 | 4 |
| FX:EURUSD | 1.13902 (forex) | 0.00001 | 100000 |
| BINANCE:BTCUSDT | 84432.01 (crypto) | 0.01 | 100 |

⭐ **Price regime does not decide it for a listed US name:** a $0.18 NASDAQ listing is
0.01 like a $758,505 one. Only the sub-cent OTC name, the future and the forex pair differ.
So "US-listed equities and ETFs → 0.01" is supported by this table; OTC, futures, forex
and any crypto pair other than BTCUSDT are NOT covered by it and must stay unserved.

## READINGS — 2026-09-28 (the intraday legs, and what the 09-27 captures say)

✅ **The intraday legs are no longer owed.** `vw-time-session` on AMEX:SPY 60m with extended
hours OFF and ON is on disk (`harness/vw-time-session-spy-60-{rth,ext}-2026-09-28.json`,
commit `932f951cc`); `vw-clock-vwap` on AMEX:SPY 5m extended ON is
`harness/vw-clock-vwap-spy-5-ext-2026-09-28.json` (300 bars, 04:00–19:55 ET, crosses a
session boundary). Independent 1D re-captures of `vw-alma`, `vw-int-cast`,
`vw-clock-vwap` and `vw-nvi-pvi` (full) on 2026-09-28 matched the 09-27 files value for
value on every common bar (max |diff| 0, no `na` mismatches) and were NOT committed —
they add a replication, not a reading.

Every reading below cites its capture; row numbers are the probe's plot titles.

**`time(tf, session)`** (`vw-time-session-*`) — membership is the bar's OPEN time in a
half-open window `[start, end)`, on 1D and on 60m alike; a fixed `"GMT-4"` is not
DST-aware (in on 215 EDT days, `na` on 85 EST days of 300); `"America/New_York"` and
`syminfo.timezone` are in on all 300; `":23456"` admits every weekday; `"2000-0000"` is
`na` everywhere.

**`time(<tf>)` period opens** (`vw-time-tf-spy-1d-2026-09-27.json`, 8472 bars):
- T05 `time(timeframe.period)` − `time` = 0 on every bar; T06 `time("60")` on a 1D chart =
  the bar's own time (0 on every bar).
- ⭐ **The period open is the FIRST TRADING BAR of the period**, for weeks and months:
  since 2000, a week whose Monday is a holiday opens on its Tuesday bar (T01 = 0, 133 of
  134 weeks; one −2); a month whose 1st is a weekend or holiday opens on its first
  trading bar (T02 = 0, 395 of 404 months).
- ⚠️ **Before 2000 the vendor's own data anchors to the CALENDAR start instead** (T01 = −1
  on all 30 pre-2000 holiday-Monday weeks; T02 = −1…−3 on 9 January/April months,
  1994–1999). A 5,000-bar daily fetch starts in 2006, so it never reaches that era; a
  rule fitted to it would be wrong for every modern bar.
- T10–T15 `timeframe.in_seconds`: `"1"` 60 · `"60"` 3600 · `"D"` 86400 · `"W"` 604800 ·
  **`"M"` 2628003** · **`"12M"` 31536036** (exactly 12 × `"M"`, not 365 days).
- T16 `input.time(timestamp("18 May 2022 00:00 +0000"))` / 86 400 000 = 19130 — the
  timestamp itself, in ms.

**`int(x)` on a fractional float** (`vw-int-cast-spy-1d-2026-09-27.json`) — it COMPILES,
and it **truncates toward zero**: `int(2.7)` 2, `int(-2.7)` −2, `int(2.5)` 2,
`int(-2.5)` −2, `int(3.5)` 3. On the series, `int(x) − trunc(x)` is 0 on every bar while
`− floor(x)` and `− round(x)` are non-zero on ~150; `int(na)` is `na`. ⇒ the door may
read `int(x)` as `idiv(x, 1)`, per section 4.

**`ta.alma`** (`vw-alma-spy-1d-2026-09-27.json`) — A05: one `na` in the source makes the
result `na` for exactly `length` bars (9), then it matches the clean series exactly. It
POISONS the window; it neither skips nor carries.

**Clock fields and `ta.vwap`** (`vw-clock-vwap-spy-1d-2026-09-27.json`, 1000-bar 1D
re-capture, and the 5m extended leg) — V01–V07 exactly 0 on every bar of both (1D: five
years, twelve months; 5m: every hour 04–19 and every minute); V08 non-zero on 931 of 1000
daily bars. ⭐ With extended hours ON, `ta.vwap` re-anchors on the **first bar of the
extended session (04:00 ET)** — vwap equals that bar's hlc3 exactly — not at 09:30.

**`ta.nvi` / `ta.pvi`** (`vw-nvi-pvi-spy-1d-full-2026-09-27.json`) — both seed at exactly
1 on SPY's first bar (1993-01-29); P03/P04 (the step rules, nvi on falling volume, pvi on
rising) are 0 to ~1e−16 on every bar. `pvi` has drifted to ~0.004 by 2026 — that is its
level, not a defect.

⛔⛔ **THE "TRUNCATED" CAPTURE DOES NOT MEASURE FETCH DEPENDENCE, AND NO CHART CAPTURE
CAN.** `vw-nvi-pvi-spy-1d-truncated-2026-09-27.json` starts at `bar_index` 7432 and equals
the full capture on all 1040 common bars (max |diff| 0.0): TradingView computes the study
from bar 0 whatever the chart has loaded (a second 1000-bar capture on 2026-09-28 read the
same). The dependence is between the VENDOR and US. Sized from the full capture: a
5,000-bar fetch seeds at 2006-11-08, where TradingView's nvi is 9.0732 and pvi 0.348444 —
so our NVI would read **9.07× low** and PVI **2.87× low** on every later bar, and the
corpus quantity `x − ta.ema(x, 255)` scales by the same factor. The ruling stands, now
measured; reopening it would mean fetching the full history for these scripts.

**`syminfo.mintick`** — a 2026-09-28 re-capture of nine symbols agrees with the table above,
and the capture's own symbol block confirms **mintick = minmov / pricescale on every
symbol** (ES1! minmov 25 / pricescale 100 = 0.25). It is symbol METADATA: constant across a
symbol's whole history (SPY 0.01 from $43 to $778; AITX 0.0001 from $0.003 to $0.14).
Serving it needs the symbol's `pricescale`/`minmov`, not its price.

## BUILT — 2026-09-28 (branch `pine/vocab-2`), each held to its capture bar by bar

Rail: `app/src/components/chart/engine/ast/pineVocabularyWave.test.js` — it translates the
source the vendor ran (`capture.source.text`) and compares every output on every bar.

- **`int(x)`** reads `idiv(x, 1)` (a constant folds to its truncation). I01–I09, 300/300 bars.
- **`timeframe.in_seconds`**: `"M"` corrected from 30 days to **2628003**; `"<n>M"` (n ≤ 12)
  answers n × M. T10–T15 on all 8472 1D bars and every 60m bar. Codes with no measured
  length (e.g. `"30S"`) still fall through to the namespace refusal.
- **`time(tf, session[, tz])`** on the chart pane (`sessionClockOf` in `pine.js`): S03–S14 and
  S16–S18 on every bar of the 1D (8472 + 300) and both 60m captures. ⭐ The value inside is
  **not** always the bar's own `time`: it is the open of the chart-period bar on a grid anchored
  at the session start — a 10:30 hourly bar in `"1000-1100"` answers 10:00 (S08 = −1800 on 43
  bars), and on extended-hours bars `"0930-1600"` answers the :30 before (S04, 114 bars). On
  every daily row the two coincide. Still refused by name: another timeframe than the chart's
  own, W/M charts, overnight/full-day windows (S15 — no captured bar opens after 20:00, so the
  capture cannot tell "never" from "20:00–24:00"), several windows, any zone other than
  `America/New_York` / `syminfo.timezone` / `GMT±H`, an unsuffixed session before v5, and the
  SCREEN lane (its stored daily bars carry a date, not an opening instant).
- **Payoff:** `opening-range-initial-balance-opening-price__4a7416ab01` now translates and
  attaches at `memberPaneDefinition` (objects-only flag off and on). ⚠️ It attaches but its
  level outputs are `na` on every bar: `OR_t and not(OR_t[1])` is Pine v5's implicit
  float→bool cast, which the door passes through as a bare `&&`/`!` that propagates `na`
  instead of reading it as false. That — not the session clock — is its next wall.


# Live intraday Breadth

**Date:** 2026-08-05
**Branch:** `feat/breadth-live`
**Status:** P1 + P2 built on the branch; not deployed

## Problem

Breadth is a once-a-day photograph. `breadth_collector.py` runs at 4:15 PM ET,
computes ~86 metrics, and pushes one row. Between the close and the next
afternoon there is no way to ask "where is breadth *right now*" — which is
exactly the question during a session.

## Why this is cheap (measured, not assumed)

The collector takes ~54s because it downloads a year of daily bars per ticker to
derive moving averages, 52-week levels and stage classification. **Those change
once a day.** Split the work:

| Step | Cost | Frequency |
|---|---|---|
| Reference levels from `bars.db` (windowed query) | **2.76s**, 0.5 MB | once per session day |
| Full-market snapshot (`get_full_market_snapshot`) | **0.58s**, 13,067 tickers | per refresh |
| Compare + aggregate | milliseconds | per refresh |

A live refresh is **~0.6s**, comfortable at a 60s cadence.

⚠️ The naive levels query took **597s** because it read all 12.7M daily bars.
The windowed form (`ts >= cutoff`, ~1M bars) is 200× faster. Keep the window.

Production `bars.db` carries the full universe; the local dev copy does **not**
(102 of 2,720 for a current session), so it cannot reconcile counts. Pull
production's instead — it is reachable from the R2 snapshot rail
(`api/services/data_sync.py`, bucket `uct-bars-snapshots`, ~4 GB gz / 14.65 GB
extracted). Stream it and extract only `bars.db`: the repo's own
`download_snapshot()` reads the whole body into memory.

## Architecture

**`api/services/breadth_live.py`** (web pod):

- `reference_levels()` — universe comes from the newest breadth snapshot's
  `universe_list` (2,720 tickers) so the live read covers **exactly** the same
  names as the EOD row. Levels are built from `bars.db` and cached per session
  day, keyed on the last completed session so a new day invalidates naturally.
- `compute_live()` — one full-market snapshot compared against those levels.
  Cached ~60s.

**`GET /api/breadth-monitor/live`** → `{as_of, session_date, session_live,
metrics, raw_metrics, basis_shift, accuracy, carried, carried_from, row,
universe_count, measured, bars_coverage, degraded, superseded,
provisional: true}` — the anchored numbers and the raw ones side by side, so
the correction applied is inspectable rather than implied.

**Storage.** The collector remains the ONLY writer of `breadth_snapshots`; this
module never writes it. Nothing intraday is persisted at all yet — a separate
intraday store is P3. The permanent daily series stays authoritative, which is
deliberate after the NAAIM incident, where provisional data reaching a permanent
series went unnoticed for 93 sessions.

## Metric parity — the part that must be exact

A live number that doesn't reconcile with the EOD row is a different metric
wearing the same name. Definitions are mirrored from the collector verbatim:

| Metric | Collector definition (must match) |
|---|---|
| `pct_above_5/10/40/50/100/200sma` | `close > rolling(n).mean()`, % of **valid** names, 1 dp |
| `pct_above_20ema` | **EMA** `ewm(span=20, adjust=False)` — NOT an SMA |
| `up/down_4pct_today` | `count_period_return(closes, 1, 0.04, ±1)`, `>=` threshold |
| `up/down_20pct_5d`, `25pct_month/quarter`, `50pct_month`, `magna_±` | same helper, `bars` = 5/21/**65**/21/34 |
| `new_52w_highs` / `new_20d_highs` | `close >= rolling(n).max() * 0.999` — window **includes today**, computed from **closes** not intraday highs |
| `new_52w_lows` / `new_20d_lows` | `close <= rolling(n).min() * 1.001` |
| `new_ath` | `count_nd_highs(closes, min(252, len-1))` — a 252-day high; equals `new_52w_highs` in practice |
| `near_52w_high` | `(rolling(252).max() − close) / max <= 0.05`, from **closes** |
| `stage2_count` | `c > SMA50 > SMA150 > SMA200` and `SMA200 >= SMA200[-22]` |
| `stage4_count` | strict inverse |
| `adv_decline` | `#(chg > 0) − #(chg < 0)` |
| `up_vol_ratio` | `sum(vol where chg>0) / sum(vol where chg<0)` |
| `mcclellan_osc` | `EMA19 − EMA39` of the daily net-advance **series** — needs history, not just today |

Live analogue of a rolling window that includes today: levels store the prior
`n−1` bars, and "at a new high" becomes `live_price >= prior_max * 0.999`.
That reduction is exact, not an approximation — when today IS the max the test
is trivially true, and it is also true against the smaller prior max.

Also live, and worth having because the Monitor's MA-stack columns read them:
`spy_close`/`qqq_close` and their four above-MA flags. The equity universe
excludes ETFs, so those two get their own history read.

**Not intraday** — surfaced with their own date, never as a live value:
`cboe_putcall` (EOD print), `aaii_*` and `naaim` (weekly), `cnn_fear_greed`
(daily), `atr_ext_7` (needs intraday high/low), the VIX family, `sp500_close`,
`uct_exposure`.

## The price basis — found by the gate, not by reading code

The collector downloads with yfinance `auto_adjust=True`, so its history is
**dividend-adjusted**. `bars.db` (Massive/Polygon) is **split-adjusted only**.
Measured on 2026-07-09 across 31 names, comparing each ticker's close 200
sessions back:

| group | median yfinance ÷ bars.db |
|---|---|
| dividend payers (KO, XOM, VZ, O …) | **0.9702** |
| non-payers (NVDA, TSLA, PLTR …) | **1.0000** |

So every long moving average sits ~2–3% lower on the collector's side and more
names read as "above" it. The error grows with the window exactly as
accumulated dividends predict — `pct_above_200sma` off by 3.8 points,
`pct_above_5sma` by 1.1.

This is not fixable by being more careful. Matching it would mean rebuilding
yfinance's adjustment factors for 3,700 names; changing the collector would
silently reprice 149 rows of permanent history.

**So the published number is anchored to the last stored row:**

```
anchored(now) = stored(prior close) + [ live(now) − live(prior close) ]
```

The bias only moves on ex-dividend dates, so it cancels in the change.
Measured: median `pct_above_*` error falls from **2.00 points on the level to
0.20 on the delta**. Where there is no bias the anchor is a no-op, so it is
safe in both regimes. Every response publishes `basis_shift` per metric — the
divergence is a number on screen, not a secret.

**Anchoring is applied only where the mechanism says it helps** — metrics whose
level reaches back ≥ 21 sessions. A metric built from ONE day-over-day change
carries almost no dividend bias (a name is touched only on its ex-date), so
subtracting yesterday's error from today's just injects noise. Replaying four
fully-covered sessions, every metric at or above that threshold improved when
anchored and every one below it got worse:

| anchored | raw → anchored | left raw | raw → anchored |
|---|---|---|---|
| `pct_above_200sma` | 2.73% → 0.43% | `pct_above_5sma` | 0.15% → 0.30% |
| `stage4_count` | 9.34% → 1.58% | `up_4pct_today` | 0.93% → 2.18% |
| `up_50pct_month` | 10.86% → 2.27% | `down_4pct_today` | 0.73% → 3.36% |
| `near_52w_high` | 7.39% → 1.99% | `adv_decline` | 0.97% → 2.02% |
| `up_25pct_quarter` | 3.84% → 1.06% | `up_vol_ratio` | 1.71% → 6.21% |

The threshold follows the mechanism; the data agreed. It was not fitted.

**Both sides must have counted the same population.** A percentage is
coverage-invariant where the missing names are few; a count scales directly with
how many you saw. Anchoring a count injects an error of roughly the coverage
drift while removing a 6–8% price-basis bias, so it is worth doing while drift
stays well under that bias — measured, it still helps at 1.9% drift (5.44% →
4.23%) and at 1.4% (6.26% → 4.73%). Counts are therefore anchored within **3%**
headcount drift, **two-sided**: seeing 1.4% MORE names breaks it exactly as
seeing 1.4% fewer does, and a one-sided floor waved 2026-07-28 through.

Percentages get a looser **5%** bound rather than none: at 72% coverage even
`pct_above_200sma` went the wrong way when anchored, because the names bars.db
carries are the actively-viewed ones — bigger, more liquid, likelier to be above
their averages. A missing quarter of the market is not a random sample. Beyond
that bound nothing is anchored, `anchor_withheld` names every field affected,
and the payload carries `degraded: true`.

## The gate

`GET /api/breadth-monitor/live/reconcile?date=YYYY-MM-DD` (PUSH_SECRET) replays
the live path for a past session — levels as of D−1, "price" = D's actual close
— and diffs both the raw and the anchored form against the stored row. `passed`
follows the **anchored** one, because that is the number on screen.

**No live value goes on screen until reconciliation passes.** Tolerance:
`pct_above_*` within 1.0 point, counts within 3 or 3%, index MA flags exact.
A wider gap means the live number is misleading, not merely imprecise.

### Where the gate stands

- **Unit parity: proven.** `tests/test_breadth_live.py` holds a verbatim copy of
  the collector's eleven metric functions and asserts the live path reproduces
  them exactly on frames with gaps, part-way listings and deliberate ties. A
  drift check re-reads the real collector and fails if the copies fall behind.
  Mutation-tested: **24 injected defects, 24 killed**, unmutated control green
  either side, every mutation proven to have applied.
- **Reconciled against production bars.** Six sessions replayed. The four whose
  headcount matched the collector within ~0.5% **pass every metric**, while the
  raw path still fails 5–8 per session — so the gate is not a rubber stamp. The
  two at 1.4–1.9% drift land 2 and 3 metrics outside their envelopes (down from
  7 raw each); the offenders differ each session, which is edge noise rather
  than a systematic defect. `bars_coverage` ships in the payload so a consumer
  can tell a clean day from a marginal one.
- **End-to-end.** The endpoint runs in **4.6s cold, instant warm**, against a
  13,067-name snapshot and a 2,720-name universe.

### A note on how the coverage bound was set

It was first written at 0.5%, from reading 2026-07-31 as "anchoring made it
worse". That reading predated the ≥ 21-session lookback rule — short-window
metrics being anchored was what had actually gone wrong. Re-measured afterwards,
anchoring helps at that coverage, and the tight bound was costing live counts a
6–8% bias for no reason. The lesson is the ordinary one: a threshold set from a
judgement is only as good as the configuration it was judged in.

### One deliberate deviation

A prior close of exactly 0 makes the collector's `pct_change()` yield `+inf`,
which its `adv_decline_count` counts as an advancer; its own
`count_period_return` guards the same case with `replace(0, nan)`. Zero is bad
data, not a gain, so the live path excludes it and reports the occurrence in
`_zero_prev_close` rather than letting it inflate advancers. Pinned by a test
that asserts BOTH behaviours so the difference stays a decision.

## Surfaces

All four read the same hook, so none can disagree about whether a reading is
live, and all four vanish the moment the collector writes the day.

- **Monitor today-row** — gold rail, a pulsing clock instead of a date, carried
  fields dimmed and italic like a stale AAII survey, `approximate` metrics
  marked, drill-down off.
- **Views / heatmap** — the date cursor shows `LIVE · 1:44 PM`. Drill is
  disabled by stripping `drillKey` from the metrics passed down, which is what
  turns off each view's own `clickable = !!m.drillKey` without eight components
  needing to learn about liveness. A second guard in the container refuses the
  call outright, for a future view that wires onClick directly.
- **Data Charts** — the live point extends every line to now, marked with a dot
  at the tip only, plus a dashed `LIVE 1:44 PM` vertical. Kept out of the legend:
  it is an annotation, not a metric the user chose to plot.
- **Dashboard tile** — the exposure rating it leads with is pushed by the
  morning wire and is NOT derivable intraday, so nothing above it becomes live.
  What is live is participation: `% above the 50-day now`, below a rule, with
  its own timestamp. It reconciles to within a point — the tightest grade the
  gate measures — which is why it is the one shown.

### Two windows that had to be right

`session_started` is deliberately NOT `market_open`. Keying on "open" left a
half-hour hole: at 16:00 the provisional row vanished and the collector's row
does not land until ~16:30. The estimate is REPLACED by the authoritative row,
never withdrawn ahead of it. Before the open is excluded for the opposite
reason — most of the universe has no pre-market trade, so the snapshot falls
back to yesterday's close and breadth reads exactly unchanged: true, and useless.

A weekday past 09:30 is not necessarily a trading day. Rather than carry a
market calendar, the guard asks the tape: on a real session most of the universe
has volume, so `traded_share < 20%` means a holiday.

### Two numbers, not one

`universe_count` is names that PRINTED today; `measured` is names that also
carried enough history for the moving-average family. On a healthy `bars.db`
they are the same population — against a thin one they read 2,720 and ~100, and
a consumer seeing only the first would believe the sample was 27× what it was.
Past 5% coverage drift the read is flagged `degraded` and no surface renders it:
at that point it is not a fresher view of the metric, it is a different metric.

## Later

**P3:** intraday store + day-path sparkline.


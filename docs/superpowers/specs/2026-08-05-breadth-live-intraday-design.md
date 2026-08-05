# Live intraday Breadth

**Date:** 2026-08-05
**Branch:** `feat/breadth-live`
**Status:** P1 in progress

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

Production `bars.db` coverage was sampled before designing: 25/25 universe
tickers had daily bars current to the session. The local dev copy does **not**
(102 of 2,720) — do not attempt reconciliation against local bars.

## Architecture

**`api/services/breadth_live.py`** (web pod):

- `reference_levels()` — universe comes from the newest breadth snapshot's
  `universe_list` (2,720 tickers) so the live read covers **exactly** the same
  names as the EOD row. Levels are built from `bars.db` and cached per session
  day, keyed on the last completed session so a new day invalidates naturally.
- `compute_live()` — one full-market snapshot compared against those levels.
  Cached ~60s.

**`GET /api/breadth-monitor/live`** → `{as_of, session_date, metrics,
universe_counted, provisional: true, stale_fields: {...}}`

**Storage.** The collector remains the ONLY writer of `breadth_snapshots`.
Intraday readings go to a separate store. The permanent daily series stays
authoritative — this is deliberate after the NAAIM incident, where provisional
data reaching a permanent series went unnoticed for 93 sessions.

## Metric parity — the part that must be exact

A live number that doesn't reconcile with the EOD row is a different metric
wearing the same name. Definitions are mirrored from the collector verbatim:

| Metric | Collector definition (must match) |
|---|---|
| `pct_above_5/10/40/50/100/200sma` | `close > rolling(n).mean()`, % of **valid** names, 1 dp |
| `pct_above_20ema` | **EMA** `ewm(span=20, adjust=False)` — NOT an SMA |
| `up/down_4pct_today` | `count_period_return(closes, 1, 0.04, ±1)`, `>=` threshold |
| `up/down_20pct_5d`, `25pct_month/quarter`, `50pct_month`, `magna_±` | same helper, `bars` = 5/21/63/21/34 |
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

**Counts are anchored only when both sides counted the same population.** A
percentage is coverage-invariant; a count scales with how many names you saw.
If `live(prior).universe_count` is below 98% of the stored count, the gap is a
headcount difference rather than a price-basis offset, and subtracting it would
invent a number — so counts fall back to raw and `anchor_withheld` says so.

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
  Mutation-tested: **19 injected defects, 19 killed**, unmutated control green
  either side.
- **Percentages: reconciled on real data.** Five sessions replayed against the
  stored rows — 32 of 35 anchored percentage readings inside tolerance; the
  three misses are short-window MAs on one high-volatility day, 1.1–1.5 points.
- **Counts: pending.** They must be reconciled against a `bars.db` holding the
  full universe.

### One deliberate deviation

A prior close of exactly 0 makes the collector's `pct_change()` yield `+inf`,
which its `adv_decline_count` counts as an advancer; its own
`count_period_return` guards the same case with `replace(0, nan)`. Zero is bad
data, not a gain, so the live path excludes it and reports the occurrence in
`_zero_prev_close` rather than letting it inflate advancers. Pinned by a test
that asserts BOTH behaviours so the difference stays a decision.

## Surfaces (P2, after the gate)

Monitor today-row · Views tiles · Data Charts final point · Dashboard tile —
each with an "as of 2:47 PM ET" stamp and provisional styling, replaced by the
authoritative row at 4:15 ET.

## Phases

1. **Service + endpoint + reconciliation harness + Monitor today-row.**
2. Views tiles, Dashboard tile, Data Charts live point.
3. Intraday store + day-path sparkline.

# Screener: live relative volume ("volume vs usual by now")

Status: **approved 2026-10-15 (approach A, plus the chart header RVOL switched to the same
number); built on `feat/screener-live-rvol`.** Approach B (per-stock curves) was built
next on `feat/screener-rvol-per-stock` — see *Approach B, as built* at the end. Written 2026-10-15 after
the owner asked for the screener to be live like the charts, never a delayed scan.

Where it lives: `api/services/screener/volume_curve.py` (nightly curve, table
`screener_volume_curve`, `GET /api/screener/volume-curve`), `live_tier.LIVE_COLUMNS` (`rvol_live`),
`app/src/lib/volumeCurve.js` (the browser mirror the chart header uses).

## The problem

Relative volume is the most-used intraday scanning signal ("what is trading heavy right now"),
and in the screener it is the one important number that is still nightly.

- `vol_ratio` is computed once a night by `technicals.volume_ratio`: the newest **completed**
  session's volume over the mean of the 30 sessions before it. During the session a member
  filtering `Volume vs avg >= 3` is reading **yesterday's** heavy names.
- `live_tier.py` rejects simply recomputing it live (its LIVE_COLUMNS note): today's volume so far
  over a full-day average is a **different quantity**. At 10:00 ET a name trading three times its
  usual pace has done roughly a quarter of a normal day, so the raw ratio reads about 0.8× and the
  filter misses it.
- The chart header already shows exactly that raw ratio as "RVOL"
  (`app/src/components/chart/headerFields.js`, case `'rvol'`: `q.volume / m.avg_vol_20d`), so the
  chart and any live screener number would disagree all morning.

## What "live" should mean

**Volume vs usual by now** = today's volume so far ÷ the volume this stock usually has done by
this minute of the session.

That is what TradingView's and most professional scanners' intraday RVOL mean. A 3× name reads
about 3× at 10:00, at 13:00 and at the close, which is what makes it filterable all day.

## Approaches

**A. One market-wide time-of-day curve (recommended first step).**
Build a single "share of the day's volume done by minute m" curve each night from the 5-minute
bars already stored for the active set (~800 names, about 20 sessions). Live:

    rvol_live = today_vol / (avg_volume_30d × curve(minute_now))

Inputs the live tier already has every minute (`today_vol` from the full-market snapshot) plus one
nightly level (`avg_volume_30d`, already a snapshot column) and one shared curve. No per-symbol
intraday fetch, so it fits the live tier's no-per-row-fanout rule. Weakness: one U-shaped curve for
every stock. A name whose volume is unusually front- or back-loaded reads a little high or low at
some times of day.

**B. Per-stock curves where we have the history, the market curve elsewhere.**
Same formula, but for the names with stored 5-minute history (the active set) the curve is that
stock's own. Better for the liquid names members scan most; more nightly work and more to test.
A natural second step after A, using the same column.

**C. Raw today ÷ average (rejected).** It looks live but reads low all morning, which is the exact
failure the live tier already documents.

## Shape of the change (for A)

- **New column `rvol_live`**, label "Volume vs usual by now". `vol_ratio` keeps its meaning,
  because two saved screens key off it (`>= 3`, `>= 1.5`). During the session the Focus layout
  shows the live column. After the close it equals the completed-day ratio, apart from the curve
  reaching 1.0.
- **The nightly builds the curve** after the snapshot (seconds; a few hundred names × 20 sessions
  of 5-minute bars) and stores it beside `screener_build_runs`.
- **The live tier computes it** each minute for every row with `today_vol` and `avg_volume_30d`.
  It joins `LIVE_COLUMNS` through the spec change that list requires, with the reason stated.
- **The first 15 minutes are suppressed.** Before ~09:45 ET the curve's share is tiny and the
  ratio swings wildly, so the column reads blank ("too early") rather than 40×.
- **The chart header's RVOL** switches to the same number so the chart and screener agree.

## Cost and risk

Light. One extra division per row per minute, one small nightly table, no new provider calls.
Main risk is the curve on half-days and holidays: the curve must be built from full sessions only,
and an early-close day must scale to its own length.

## Decision needed

1. Approve A as the first step (and B later)?
2. OK to add `rvol_live` to the live columns, and to change the chart header's RVOL to match?

## Approach B, as built (2026-10-15, `feat/screener-rvol-per-stock`)

- **Nightly** (`volume_curve.build_nightly`): the same 20 full sessions of the top-300 liquid
  names. A name with at least `PER_TICKER_MIN_SESSIONS` (15) complete sessions also gets its own
  curve from the same `build_knots` (median per 5-minute knot, running maximum, pinned 0 and 1),
  blended toward the market's knots by `sessions / 20` (`blend_knots`), stored as 79 knot shares
  in `screener_volume_curve_ticker` keyed by the market build id, in the same transaction. Only
  the newest build's rows are kept and read.
- **Live tier**: `run_sweep` reads `volume_curve.ticker_live_shares(now)` ONCE per sweep (one
  query) into a dict, beside the market share; each row uses its ticker's own share when present,
  else the market share. No market share (before 09:45 ET, no curve) blanks both. Receipt:
  `ticker_shares`, `rows_on_ticker_curve`. AST rail: the per-row path reaches `volume_curve` only
  for `rvol`.
- **Endpoint**: `GET /api/screener/volume-curve?ticker=SYM` or `?tickers=A,B,C` (up to 500) adds
  `ticker_knots` from the same cached payload.
- **Every RVOL display is this number**: the chart header (one request per chart symbol), the
  Watchlist column (ONE batch request for the list; past 500 symbols the tail reads the market
  curve) and the terminal `SecurityHeadline` (`· RVOL 2.4x`), all through
  `lib/volumeCurve.rvolForSymbol` over `avg_vol_30d`, label RVOL, tooltip "Volume vs usual by
  this time of day". The 20-session full-day ratio is gone from all three.

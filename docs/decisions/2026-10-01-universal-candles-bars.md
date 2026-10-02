# Universal Candles + Bars — symbols and Breadth (2026-10-01)

## What changed

A secondary series whose data has a **legitimate OHLC** may now be presented as
**Candles** or **Bars** (the member-facing words, exactly), in any pane: price, own pane, or another
pane. Eligibility follows DATA CAPABILITY. Pane placement and source family names play no part.

    DATA SOURCE → SERIES → DATA CAPABILITY → PRESENTATION → PANE

* `presentation.js`: `bars` joins `candles` in `PLOT_STYLES`. `OHLC_PLOT_STYLES = ['candles','bars']`
  is the single list every gate reads (`availableStyles`, `sourceCapability.SCALAR_STYLES/OHLC_STYLES`,
  the binder's payload gate).
* `pool.js`: user `bars` → author `ohlcBars` → pool key `bar` → LWC `BarSeries`, with
  `upColor/downColor/thinBars/openVisible: true`. These are the options `StockChart`'s primary
  `case 'bars'` uses. No new renderer is involved.
* `binder.js`: the existing candle payload (`{kind:'ohlc', bars}`) feeds both series types. An OHLC
  binding now carries `valueAt`/`lastValue` from the bar **close**. Before this, a candle chip had
  no hover value at all.
* `symbolProjection.clipBarsToDomain`: applies the same mixed day-key rule `projectSymbolField`
  got on 2026-09-30. Index bars (`/api/bars/SPX`, unix-midnight `t`) used to draw **nothing**
  as Candles on a date-keyed chart.

## Breadth: an ATTESTED family

Breadth was refused Candles because `breadth_symbols` serves a close-to-close **body**
(`o = yesterday`, `h/l = max/min(o, c)`) wherever no observed OHLC exists. That gate was correct,
but it covered too much ground. Most UCT breadth days do carry an **observed** OHLC:

* `intraday_recon`: the minute-file replay back to 2008. Open is the first RTH bucket; high and low
  are the sampled extremes, widened to the EOD close.
* `intraday_recon_1m`: V2's 1-minute OHLC, 2026-03-23 onward.
* `live`: the intraday accumulator.

`close_recon`, `intraday_recon_1m_body`, collector-only days, the provisional tail and the
developing candle are **bodies**.

So the server marks each observed bar with `ohlc: 1` (`breadth_daily_ohlc.OBSERVED_OHLC_SOURCES`).
A W/M period is marked only when every day in it is. No value moves, and the mark is additive and
fail-closed: an old payload or an unmarked series stays scalar. On the client
(`ohlcCapability.ATTESTED_OHLC_FAMILIES`), Breadth is capable only when the loaded bars contain a
marked bar. An unmarked bar keeps its time and close and is handed to the renderer as
**whitespace**, never as a body. Nothing is synthesised.

`history()` / `universe_history()` keep their exact shape. Provenance is opt-in via
`with_source=True`, and only the chart builder asks for it.

## Audit

The machine-readable audit is in `docs/charts/audits/2026-10-01-breadth-ohlc-audit.json`. It covers
62 published series (44 UCT + 18 US) and was read through the real builder against a production
store snapshot:

* **29 OHLC**: the 7 MA breadth series, the 12 momentum counts, NH/NL/NH20/NL20/ATH, A/D net,
  McClellan osc, and Stage 2/4.
* **33 scalar**:
  * all 18 US series (close_recon bodies);
  * ratios R5/R10, UV ratio, PH/PL, HVC, Health Score (close_recon bodies);
  * the collector-only series: XR, X, AD cumulative, EW, SC, Fear/Greed, Put/Call, AAII spread.

UCTNRH has a single observed bar in the snapshot. In production it gains V2 coverage from
2026-03-23.

UCTA5 parity: 1,853 of 1,853 observed served bars equal their store row exactly. No observed bar
breaks an OHLC invariant (H ≥ max(O, C), L ≤ min(O, C), H ≥ L).

## Unchanged

* The primary chart's chart-type clamp. `primaryChartTypeFor` still treats breadth as scalar,
  because the primary chart has no per-bar whitespace path.
* Scalar semantics (Line reads the close), the default style at creation (Area for non-technical
  series), Breadth methodology and authority, and every stored layout. There is no migration.

## Today's developing bar (2026-10-02)

The live accumulator (`breadth_daily_ohlc.update_intraday`) holds today's observed OHLC. Its open
is the first anchored, non-degraded sample; high and low are the extremes so far; close is the
latest sample. On 09-29, 09-30 and 10-01 this was proven equal to the first, max, min and last of
roughly 390 per-minute samples in production.

The serve-time developing bar reads that row through `live_row` (one primary-key read). It keeps
the live value as its close, widens high/low to include that close, and is marked observed. This
applies only when the series' sealed history is already attested, so a body-only series never
flips capability during the afternoon. With no row, the bar is the unmarked body, as before.

## Known limits

* The newest **sealed** session not yet validated by V2 (the provisional tail) stays blank in
  Candles/Bars. Its V2 OHLC appears automatically once the producer validates it.
* A developing week or month is marked only if every day in it is. Because the provisional day
  usually precedes today, the current week is usually unmarked, except on a Monday.
* V1 history highs and lows are **sampled** (13 buckets) extremes, not tick extremes.

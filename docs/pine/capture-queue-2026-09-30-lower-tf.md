# Capture queue — 2026-09-30 C27, a timeframe below the chart's own

Branch `pine/c27-lower-tf`. One probe under `tools/visual_conformance/probes/` and three bar-only
captures, for the parent session to run on the live TradingView rig with
`tools/vendor_harness/tv_capture.js` — same procedure as `docs/pine/capture-queue-2026-09-28.md`
(visibility gate, **Create new ▸ Indicator**, "Add to chart" binding gate, `__uctVH.capture({...})`,
chunks, `verify_capture.mjs --assemble`).

The mechanism and the refusals these settle are in
`docs/pine/vendor-harness/objects-triage-2026-09-28.md` § C27 and
`app/src/components/chart/engine/lowerTf.js` (the header states every rule once).

## Why these are owed

`lowerTf.js` reads `request.security(own, "60", expr)` on a D/W/M chart as `expr` evaluated on the
60m series and read at each chart bar's LAST intrabar; `request.security_lower_tf` as the array of
every intrabar. Three of its rules are witnessed on committed vendor bars (the bucketing, the daily
bar not being the intraday aggregate, the chart session); two are not, so every such read is
refused at the member door as `lower-tf:unwitnessed`:

- **(i) which intrabar** a lower-timeframe `request.security` answers on a 1D chart — documented:
  the last one, look-ahead off; never captured.
- **(ii) which session's intrabars** a 1D chart's request reads — documented: the chart symbol's
  (regular) session; never captured. The two readings differ on ~94 % of days (the daily close
  equals the last regular-session 60m close on 190 of 2,951 SPY sessions).

## Priority order

| # | capture | settles | scripts it would move |
|---|---|---|---|
| Q-L1 | `vw-lower-tf.pine` on AMEX:SPY **1D** (and **1W**) | (i) and (ii); look-ahead on; `240` bucketing | unblocks the whole lane: ema-ribbon rows 6–8, artemis 15/60/240, and every `request.security` below a daily chart in the corpus |
| Q-L2 | NYSE:RDDT **15**, **60**, **240** bars (extended hours OFF, any trivial study, as much history as loads) | the intraday bars the harness would hand ema-ribbon's rows | `ema-ribbon-trend-filter-strixedge` rows 6–8 + bias/confluence cells, graded value for value |
| Q-L3 | NYSE:RDDT **5** bars (extended OFF, full history) | the bars for `liquidity-heatmap`'s `"5"` pivots — only after its `resolutionInMinutes` (`timeframe.*` inside a request) and `lookahead_on` walls clear | liquidity-heatmap labels |

## Q-L1 — `vw-lower-tf.pine`

**Capture:** AMEX:SPY **1D**, inputs at defaults, as much history as loads (the dates graded are
the ones `vw-bool-cast-spy-60-2026-09-28` holds, 2015-01-02 → 2026-09-28), and AMEX:SPY **1W**.

**What we must match** (the replay already computes these from TradingView's 60m bars):

| row | shipped reading (unserved) | what flips it |
|---|---|---|
| L02 `request.security(tickerid, "60", close)` | each day's LAST regular-session 60m close — NOT the daily close | a different value on any complete day ⇒ rule (i) is wrong |
| L03 `… "60", time` | the 15:30 ET bar's open (12:30 on a half-day TradingView applies) | 19:00 ⇒ extended session (ii) |
| L04 `… "60", ta.ema(close, 9)` | Pine's EMA over the 60m closes, read at the day's last 60m bar | a daily EMA ⇒ the child is not on the intraday series |
| L09 `array.size(security_lower_tf(…, "60", close))` | 7 (4 on an applied half-day) | 16 ⇒ extended session |
| L10 first element of `… "60", time` | 09:30 | 04:00 ⇒ extended |
| L07/L08 look-ahead on | unmeasured (refused `lower-tf:lookahead`) | the capture IS the reading |
| L13/L14 `ticker.modify(…, session.extended)` | the control: 16 buckets, 19:00 last bar | if equal to L09, (ii) cannot be read from this probe |
| L15/L16 `"240"` | TradingView's bucketing of 240 on the regular session (09:30, 13:30?) | refused `lower-tf:not-served` until the store serves it or it is built from 15/30 |

If L02 equals the replay on every complete day and L09/L10 read the regular session, flip
`LOWER_TF_WITNESS.requestValue` / `.requestSession` to this capture's id in `lowerTf.js` — and
only then build the product half (the tree node, the supply through `secondaryBars.js` at
`LOWER_TF_SOURCE[code]`, the Python mirror, per § C27 "What serving needs").

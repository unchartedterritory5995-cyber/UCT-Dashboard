# Capture queue: Q-IHTF-1, a higher intraday timeframe read (e101, NUMBER PENDING)

Owner of the queue: FRED RS (the TradingView rig). Builder: DEEPVUE. Coordinator GO: TRADINGVIEW, 2026-11-27 23:31Z.

⛔ **NOT RUN YET.** TradingView automation was HALTED on 2026-11-27 23:24Z (automated runs signed the owner out of his
own TradingView session). This row waits for the owner to say TradingView is free. Nothing in this unit is served
before it grades: the capability `request-intraday-htf` is closed (`app/src/components/chart/engine/intradayHtfWitness.json`).

## What it settles

`request.security(syminfo.tickerid, "60", x)` on a 15 or 5 minute chart. The engine resamples the chart's own bars into
60 minute buckets on the chart's own grid (`interpret.js::periodStamps`):

- regular hours: buckets from the 09:30 open, the last one short (15:30-16:00; 12:30-13:00 on a 13:00 half day);
- extended hours: New York clock hours (the 09:00 bucket spans the open).

The 60 minute GRID is already measured for a 60 minute chart (`vw-time-session-spy-60-{rth,ext}-2026-09-28`), and the
engine's rule is held equal to it (`intradayHtfReads.test.js`, every 15 minutes over 2024-2027). What no capture shows:

1. that a REQUEST read from a lower chart uses the same buckets (H01/H02: each bucket's `time` and `time_close`);
2. the merge's alignment, look-ahead off and on (H06 / H08), and the bucket's own OHLCV (H03-H07);
3. 120 and 240 minutes (H09-H13): the engine anchors them at the open with a short last bucket, unmeasured;
4. 30 minutes (H14);
5. the stateful read's history start (H15 `ta.ema(close, 50)`, the write-capability eval's w02) and a windowed one (H16).

## The captures (probe `tools/visual_conformance/probes/vw-ihtf-grid.pine`)

| capture | chart | why |
|---|---|---|
| `vw-ihtf-grid-spy-15-rth` | AMEX:SPY 15m, extended hours OFF | the base case |
| `vw-ihtf-grid-spy-5-rth` | AMEX:SPY 5m, extended hours OFF | a second base (12 bars to an hour) |
| `vw-ihtf-grid-spy-15-eth` | AMEX:SPY 15m, extended hours ON | the clock grid |
| `vw-ihtf-grid-rddt-15-rth` | NYSE:RDDT 15m, extended hours OFF | a second symbol (and the community-script half is a separate row) |
| `vw-ihtf-grid-btcusd-15` | a 24-hour symbol (e.g. BITSTAMP:BTCUSD) 15m | proves the rule is not hard-coded to 09:30: the engine WITHHOLDS this chart by name (`request:htf-intraday-session`), and the capture says what TradingView's buckets are there, for a later unit |

Keep the chart's FIRST bars in each capture (H15's history start) and the newest bars settled. The SPY window must hold
the 2026-11-27 half day (close 13:00) and a daylight-time change week (2026-11-02).

## Ship gate

Every bucket's open, high, low, close, volume, time and time_close, and H15 / H16, equal to the bar on the captures,
with the runtime pane on; then a community script's capture (the registry's rule: two MATCH captures of two scripts,
one a community script) before `admitted: true`. A code that does not grade stays out: the door reads the admission
for the whole capability, so 120 / 240 that disagree are removed from `INTRADAY_HTF_CODES` before admission, never
served on a guess.

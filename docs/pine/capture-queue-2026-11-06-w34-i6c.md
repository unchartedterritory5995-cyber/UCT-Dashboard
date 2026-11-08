# Capture queue: W34-I6c v4 per-bar window lengths (2026-11-06)

Spec: `docs/pine/W34-I6-SPEC.md` section I6c (`origin/docs/pine-w34-i6-spec` @ `9be8910111`).

The v4 serve is at the REFERENCE tier, as W4-T8's v5/v6 serve is: the v4 reference declares
`length (series[integer])` for `highestbars`, `lowestbars`, `highest`, `lowest`, `sma`, `wma`, `stdev`, `sum`,
`dev`, `median` (https://www.tradingview.com/pine-script-reference/v4/#fun_highestbars), and `integer` (no
qualifier) for `ema`, `rma`, `atr`, `hma`, `kc`, `kcw`, which keep their refusal. The row below turns
REFERENCE into VENDOR. Until it MATCHes, the live OBJECT door keeps master's answer for a PER-BAR length
(`runtime:history-dynamic-offset`, "the length of `<fn>` is only known while the bar is running, so the ring
it needs cannot be sized before bar 0"), exactly as W4-S1 gates v5/v6. It does NOT keep master's answer for a
FIXED-length v1-v4 bare `highestbars`/`lowestbars`: this lane flips that sign to Pine's non-positive offset at
every door (the translator's vendor-measured v1-v4 re-route).

| id | probe | symbol / tf | refusal kept (object door) | unblocks | settles | owner |
|---|---|---|---|---|---|---|
| W4-S1-v4 | `vw-w4-series-length-v4.pine` (written 2026-11-07; sibling of W4-S1's `vw-w4-series-length.pine`), text below | `AMEX:SPY 1D`, `NYSE:RDDT 1D` | `runtime:history-dynamic-offset` | `zigzag-multi-time-frame-with-fibonacci-retracement` (sole, a drawing script: object door) | that v4 reads a per-bar length (last `len` bars), the value on bar 0, the SIGN of v4 bare `highestbars`/`lowestbars` under a per-bar length (non-positive, as the translator's v1-v4 re-route to `ta.highestbars` says), and `na` / `nz` handling | I6c (REFERENCE -> VENDOR) |
| W4-S1 (inherited) | `vw-w4-series-length.pine` (`W4-BREAKDOWN.md`; written 2026-11-07 from that row) | `AMEX:SPY 1D`, `NYSE:RDDT 1D` | as W4-S1 | the v5/v6 reference the v4 rail is graded beside | as W4-S1 | T8 |

Probe text (written for this queue; no licence-held text):

```
//@version=4
study("vw-w4-series-length-v4", max_bars_back = 1000)
len = bar_index % 7 + 1
plot(sma(close, len), "sma")
plot(highest(high, len), "highest")
plot(stdev(close, len), "stdev")
plot(highestbars(high, len), "highestbars")
plot(lowestbars(low, len), "lowestbars")
zz = bar_index - valuewhen(bar_index % 5 == 0, bar_index, 1) + 1
plot(highestbars(high, nz(zz, 1)), "zz_highestbars")
plot(lowestbars(low, nz(zz, 1)), "zz_lowestbars")
plot(len, "len")
```

Not served here, refused by name, no capture row needed by this lane:
- the one-argument v4 form `highestbars(length)` / `lowestbars(length)` with a per-bar length:
  `resolve:window` ("a window must be a whole-number literal"), as in v5/v6;
- a v4 length past the ring (the declared `max_bars_back`, else 5,000), `na`, fractional or below 1: stops
  the run by name (`runtime:history-dynamic-offset`), as T8.

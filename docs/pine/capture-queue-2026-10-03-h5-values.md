# Capture queue - 2026-10-03 H5, `format.volume` and `timeframe.*` inside a request

Branch `pine/h5-host-values`. Two new probes (never compiled here), for CAP3 (the sole
browser user) to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js`,
same procedure as `docs/pine/capture-queue-2026-09-28.md`.

## Why

- H5 reads `str.tostring(x, format.volume)` only where captures pin it
  (`pineTextFormat.js::volumeNumberText`): a magnitude in millions or billions, three
  decimals, the third non-zero. Below one million (`K`? no suffix?), a trailing zero
  (`3.100M` or `3.1M`?), an exact tie, a unit roll-over and 10^12 are WITHHELD.
- liquidity-heatmap's 14 label guards read `request.security(<own>, "3" | "240",
  timeframe.multiplier * ...)`. This engine refuses `timeframe.*` read inside a request
  (`pine.js`: "answers for that request's context, which no capture has measured").

## Q-H5

| # | capture | settles |
|---|---|---|
| Q-H5a | `vw-h5-format-volume.pine`, AMEX:SPY **1D** (any bar count), the table's 17 cells | H01-H16: `format.volume` below a million, trailing zeros, a tie, roll-over, negative, 10^12. H00 is the control (`3.126M`) |
| Q-H5b | `vw-h5-request-timeframe-text.pine`, AMEX:SPY **1D**, >= 200 bars | T01-T04: the requested timeframe's metadata inside a request (W, M, 240, 3). T00/T05 controls |

A compile failure or runtime error is a reading: record the message and the row.

## What lands when it is captured

- Q-H5a: widen `volumeNumberText` to exactly the renderings shown (e.g. `K`, trimmed
  zeros), each row a unit case in `strTostringFormat.vendor.test.js` section H5.
- Q-H5b: if T01/T02 are 10080 / 43830 on every bar, the identity "a request's
  `timeframe.*` is the requested timeframe's" can be served for W / M (a constant per
  request). T03/T04 also need the intraday store gate (`lower-tf:store-unmeasured`), so
  liquidity-heatmap's guards stay refused until both are settled.

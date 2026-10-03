# Capture queue - 2026-10-02 H3, `ta.vwap(source)` and v4 bare `alma` (Q-H3a, Q-H3b, Q-H3c)

Branch `pine/h3-host-collections`. Two new probes under `tools/visual_conformance/probes/`, for the
parent session to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js` - same
procedure as `docs/pine/capture-queue-2026-09-28.md` (visibility gate, **Create new > Indicator**,
"Add to chart" binding gate, `__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`).

## What H3 serves, and what grades it today

`ta.vwap(source)` for a bar price (`open` / `high` / `low` / `close` / `hl2` / `hlc3` / `ohlc4` /
`hlcc4`) is now `vwapOf(source)`: the same session accumulator as `vwap()` (one `computeVWAP`, its
ET-day boundary and all) weighting that price. One committed capture grades it bar for bar:
`vw-clock-vwap-spy-5-ext-2026-09-28`, whose V08 + V09 is TradingView's `ta.vwap(close)` on every
5-minute extended-hours bar (`vendorHarness.h3VwapSource.test.js`, `tests/test_ast_vwap_of.py`;
191 bars of one full session after the leading partial one, worst difference under 1e-6). The other
six prices are served by construction (the same accumulator, a different input column) and have no
capture of their own; a daily chart has only the group-B aggregate (40 SPY bars, min/max of
`ta.vwap(close) - ta.vwap`). A computed source (`ta.vwap(ta.sma(close, 5))`) stays refused by name:
what TradingView's session sum does with an `na` term is unmeasured.

Bare `alma` stays refused. `r11-alma-spy-2026-09-11` read a COMPILE FAILURE for bare `alma`, but the
probe was `//@version=6`; the corpus sites are `//@version=4` scripts (highlow-channel-swing,
relative-volume), where the v4 reference manual lists `alma(series, length, offset, sigma)`. Nothing
committed says what v4 `alma` computes, so the refusal stands until Q-H3c reads it.

## The captures

| # | capture | settles | what it would move |
|---|---|---|---|
| Q-H3a | `h3-vwap-source` on AMEX:SPY 1D (several hundred bars) | S02-S08 bar for bar: every served bar price on a daily chart, where each bar is one ET session | upgrades six served sources from "by construction" to vendor-graded on daily; S09 reads the unserved computed-source case (warm-up `na` terms) |
| Q-H3b | `h3-vwap-source` on AMEX:SPY 5 (regular session) | the same rows across several 09:30 resets on a regular-session chart | the session reset for a chart with no pre/post-market bars |
| Q-H3c | `h3-alma-v4` on AMEX:SPY 1D | whether v4 bare `alma` compiles (A01), and if so A03-A06 = 0 on every bar against the reference implementation written out in the probe; A07 the first non-`na` bar | would let `alma` be served for v4 (`highlow-channel-swing` attaches with it: source-rewrite trial in section H3), with the probe's own subtraction as the oracle |

S00 / A00 are the bar-index controls. Nothing is refused waiting on Q-H3a/b; they upgrade the evidence
behind what is served. Q-H3c gates a refusal.

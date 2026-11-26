# builtin4: six of Pine's own `ta.*` indicators, against TradingView (tier c)

2026-11-26. The entries are in `api/data/named_indicators.json`; tiers (a) and (b) are in their own evidence blocks
and `tests/test_named_indicators_values.py`. This file is tier (c): TradingView's OWN values, captured and compared bar
by bar.

**Method.** One witness script (Pine v6) plotting TradingView's own functions: `ta.tr`, `ta.wvad`, `ta.swma(close)`,
`ta.linreg(close, 25, 0)`, `ta.linreg(close, 14, 0)`, `ta.iii`, `ta.cog(close, 10)`, `ta.cog(close, 7)`. It was captured on two
daily charts by the TradingView rig (`tools/vendor_harness/batch_capture.py`, run `builtin4-2026-11-26`):

- AMEX:SPY, 8,515 bars;
- NYSE:RDDT, 674 bars (a short history, to show warm-up).

These are TradingView's ta.* FUNCTIONS, the same computations TradingView's built-in indicators of these names call. Four
of the six (iii, wvad, swma, cog) have no standalone indicator in TradingView's dialog, so a witness script is the way to
read TradingView's own values for them. The coordinator approved the method on 2026-11-25. Each entry's tree at the
witness's settings was run through the server's evaluator on the captured bars (`grade_builtin4.py`), and compared with
TradingView's value on every bar where both have one, equal within one part in a billion. The captures are vendor data
and are **not** in this repository.

**Result.**

| entry | TradingView's own | SPY | RDDT | grade |
|---|---|---|---|---|
| True Range | ta.tr | 8,514 of 8,514 | 673 of 673 | EQUAL |
| Williams Variable Accumulation Distribution | ta.wvad | 8,514 of 8,514 | 674 of 674 | EQUAL |
| Symmetrically Weighted Moving Average | ta.swma(close) | 8,512 of 8,512 | 671 of 671 | EQUAL |
| Least Squares Moving Average, length 25 | ta.linreg(close, 25, 0) | 8,491 of 8,491 | 650 of 650 | EQUAL |
| Least Squares Moving Average, length 14 | ta.linreg(close, 14, 0) | 8,502 of 8,502 | 661 of 661 | EQUAL |
| Intraday Intensity Index | ta.iii | 8,514 of 8,514 | 674 of 674 | EQUAL |
| Center of Gravity, length 10 | ta.cog(close, 10) | 8,506 of 8,506 | 665 of 665 | EQUAL |
| Center of Gravity, length 7 | ta.cog(close, 7) | 8,509 of 8,509 | 668 of 668 | EQUAL |

### The Intraday Intensity Index: the volume MULTIPLIES

TradingView's v6 reference page prints `((2 * close - high - low) / (high - low)) * volume`. An older engine note
(`docs/pine/evidence/2026-11-02-w1`, from an export fixture) said TradingView's computed values divide by volume instead.
This capture settles it for Pine v6: the multiply form is equal on every bar of both charts, and the divide form matches
35 of 8,514 (SPY) and 0 of 674 (RDDT). So the entry is the multiply form, which is also Bostian's own. The engine's
`ta.iii` (which divides) is an engine defect, assigned to the engine side on 2026-11-26.

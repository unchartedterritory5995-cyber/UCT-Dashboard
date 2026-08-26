# The thinkScript corpus — 24 real published scripts, unmodified

⭐ **THESE ARE TEST INPUTS, AND THEY ARE SOMEBODY ELSE'S CODE.** Every `.ts` file here
was copied verbatim from a public forum post or a public repository on 2026-08-25 and is
exactly as published: original comments and header lines, casing, spacing, typos, even
the en-dashes one author pasted into an expression as minus signs. Nothing
here is authored, edited, cleaned up or truncated by this repo. **Attribution — poster,
in-code author, exact post/file URL and the terms seen — is in `SOURCES.md` beside this
note.** Three GitHub files are MIT, one is Apache-2.0; the twenty forum files carry the
poster's copyright under useThinkScript's Terms of Use with no explicit licence, and the
sources that forbid redistribution (tosindicators.com, the Schwab Learning Center's
"all rights reserved" examples) were read but not copied.

## Why it exists

The corpus is a MEASUREMENT set for a thinkScript → engine translator: the translator is
scored against what the community actually writes, not against the examples its author
thought of. It mirrors `tests/fixtures/pine/` — numbered files, one `SOURCES.md` entry
each, committed rather than fetched (⛔ a gate that needs the network is a gate that
skips).

## The buckets (file numbers)

- **A · 01–06 — classic indicator studies** rewritten by the community: Supertrend, MACD,
  ADX/DMI, RSI, Bollinger+RSI, VWAP. `input`/`def`/`plot`, `MovingAverage`/`AverageType`,
  `TrueRange`, `Highest`, `crosses above/below`, `[1]` offsets, `SetDefaultColor`/
  `SetPaintingStrategy`/`AssignValueColor`, `declare lower/upper`.
- **B · 07–11 — momentum / volume / oscillator studies**: TTM-squeeze watchlist, relative
  strength z-score vs SPY, above-average price/volume, RSI-Laguerre with fractal energy,
  money flow index.
- **C · 12–16 — Stock Hacker scan / study-filter snippets** (the most valuable): single
  boolean plots for volume×price, 52-week high, inside bar, pre-market gap-up, and a bare
  `RSI() crosses above 30` condition with no plot at all.
- **D · 17–20 — state and iteration**: `CompoundValue` vs a `BarNumber()`-guarded
  if/else, `fold … with … do`, a `CompoundValue` counter using `is greater than`, and
  `switch/case` over an enum input.
- **E · 21–24 — constructs a formula engine will likely REFUSE**, so the refusals are
  measured too: `addOrder` strategy, `AggregationPeriod.DAY` secondary aggregation with
  defs shadowing `open/high/low`, `getTime`/`RegularTradingStart`/`addVerticalLine`/
  `HighestAll` with a future offset, and account functions `GetQuantity`/`GetAveragePrice`/
  `GetOpenPL` with `AddCloud`/`AddLabel`.

Several files straddle buckets on purpose (06 and 10 carry `alert`/`Alert`, 08 uses
`close(symbol=)`, 15 uses `getTime`); the bucket is the file's primary intent.

## What they are NOT

- ⛔ **Not shipped.** Nothing under `tests/` reaches the Vite bundle or is served.
- ⛔ **Not a source of product code.** No line of these scripts is to be copied into the
  translator; they are read, translated and thrown away by a test.
- ⛔ **Not to be "fixed".** A script that fails to translate because of an en-dash or a
  capitalised `Def` is a true measurement; correcting the fixture would hide it.

Reversing the decision to commit third-party code costs one command: delete this directory
and re-fetch from the URLs in `SOURCES.md` if it is ever needed again.

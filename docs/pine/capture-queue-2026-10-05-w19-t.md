# Capture queue - 2026-10-05, W19-T (text values and inputs)

Branch `pine/w19-t-text-inputs` (base `integrate/wave18-2026-10-04`, `d488943c20`). What W19-T served is in
the triage doc, section W19-T. Procedure: `docs/pine/VENDOR-HARNESS.md` (visibility gate, **Create new >
Indicator**, "Add to chart" binding gate, `__uctVH.capture`), inputs at defaults. None of these needs market
hours.

## 1. The four scripts W19-T attaches (each is ungraded until captured)

Every one stays behind GT's starter allowlist until its capture grades. Census state: runtime (both build
flags on, every script graded), 50-library store.

| id | script (as written) | chart | lane | why this chart |
|---|---|---|---|---|
| Q-W19T-1 | `corpus/committed/macd-with-filter-visual-backtest-module-sample__kuNU8uQsIH.pine` (sha256 `f02e75e8fa3a...`) | NYSE:RDDT 1D from the listing; AMEX:SPY 1D | runtime | W1 (`mafilt_type = input("EMA", options = [...])` read at its default) |
| Q-W19T-2 | `corpus/committed/williams-fractal-trailing-stops__UOOIN5REYl.pine` (`c8fea2dc5ec4...`) | NYSE:RDDT 1D; AMEX:SPY 1D | runtime (its two `plotshape` rows are WITHHELD at the door) | W1 (`inputWilliamsFlipInput = input(defval = "Close", options = [...])`) |
| Q-W19T-3 | `corpus/committed/scalping-strategy-with-williams-r-macd-and-sma-1-minute-only__e247952471.pine` (`166b61b134f8...`) | AMEX:SPY **1** (the script's own question: `isOneMinute` true) and AMEX:SPY 1D (false: the warning label path) | host | W2 (`str.tostring(timeframe.period) == "1"`) |
| Q-W19T-4 | `corpus/committed/session-hilo__WM2g5GtC4h.pine` (`40d6c9771dc9...`) | AMEX:SPY 1D (bars across 2022-05-18 .. 2023-01-01, the default range) and AMEX:SPY 60 | host | W3 (`input.time(defval = timestamp('18 May 2022 00:00 +0000'))`, `'01 Jan 2023 00:00 +0000'`) |

## 2. Probes for what W19-T left refused

| id | probe / chart | settles | scripts it would move |
|---|---|---|---|
| Q-W19T-a | `tools/visual_conformance/probes/vw-w19t-format-time.pine` (one table, 8 rows); **AMEX:SPY 1D** and **AMEX:SPY 60** (extended OFF) | what `str.format_time(t, fmt[, tz])` prints: the fibonacci format, the default format, a zone argument vs the exchange zone, a fixed instant vs `time` | fibonacci-retracement-mtflog (`str.format_time(start, "dd.MM.yyyy - HH:mm")` in a label). ⛔ Not a completer alone: with the call peeled its next wall is `ta.max(x)` (one argument, `pine:arity`), an H2 builtin |
| Q-W19T-b | `tools/visual_conformance/probes/vw-w19t-timestamp-spellings.pine` (7 rows + control); **AMEX:SPY 1D** and **BITSTAMP:BTCUSD 1D** | the `timestamp("...")` spellings T16 did not read: no zone, `GMT+10` with seconds, ISO, `+0100`, and an `input.time` of one | machine-learning-knn-based-strategy (`timestamp('01 Jan 2000 00:00:00 GMT+10')`; also needs H1's `ta.cci` role order), candlestick-patterns-on-backtest (input.time default; next walls `pine:statement`, `matrix.new`) |
| Q-W19T-c | none new: `vw-rt11-builtins` already holds it | bare v4 `tostring(<text>)` (Q-RT11a read only `str.tostring`, v6) | nothing in the corpus today |

`str.tostring(<number>)` inside a text predicate (smarter-snr: `str.length(str.tostring(syminfo.mintick)) - 2`)
needs no new probe: its formatting rule is the object runtime's measured one (C43, H5); what is missing is a
bind-time fold of `syminfo.mintick` through it, which is engine work (H2 + T), not a capture.

A runtime or compile error is a reading: record message and row.

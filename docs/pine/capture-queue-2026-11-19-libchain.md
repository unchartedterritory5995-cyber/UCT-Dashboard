# Capture queue: the libraries chain (2026-11-19)

Filed for coordinator patrick-2b by the libraries-chain engine work (U-FGS, U-FN, U-TYPES, admit:method-def,
U-LIB; `docs/pine/PARITY-ROADMAP-2026-11-18.md` sections 5 and 7). Probes only: no engine change rides on this
file, and no engine change is built on a row here until its capture is read.

Every chart is a daily chart with the inputs at their defaults (no probe has an input it needs set). A line
that does not compile is a reading: record the error text and the line, remove only that row, and capture
the rest. Captures are read after the close.

## U-FGS: a function body reading a global

The runtime lane refuses a global's history, a window over a global and `ta.change` of a global inside a
function body by name (`runtime:function-global-state`). The committed
`vw-udt-fn-global-history-rddt-1d-2026-11-16` already reads the rule for history: a global seen inside a
function is its value AT THE CALL, and its history is per call site (G03 reads the value before a later `:=`,
G05 the previous CALL's value). These rows give that capture a second symbol, and ask the same question of
windows, `ta.change`, a read inside a block of the body, and v5.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-FGS-1 | `tools/visual_conformance/probes/vw-udt-fn-global-history.pine` | AMEX:SPY 1D from the listing | no | every plot on every bar (A00, G01, G03, G04, G05, G06) | U-FGS: the second symbol for the implicit-parameter rule |
| Q-FGS-2a | `tools/visual_conformance/probes/vw-fn-global-window.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar (A00, W01-W14) | U-FGS: windows and `ta.change` over a global; W08, a read in a block of the body; W13 / W14, a plain or pure global's history in a function called on some bars |
| Q-FGS-2b | `tools/visual_conformance/probes/vw-fn-global-window.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol |
| Q-FGS-3a | `tools/visual_conformance/probes/vw-fn-global-window-v5.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar (A00, V01-V04) | U-FGS under v5 rules: breaks-and-retests-hg__ddba061af8, bolingger-bands-inside-bar-boxes__3294017d4f |
| Q-FGS-3b | `tools/visual_conformance/probes/vw-fn-global-window-v5.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol |
| Q-FGS-4 | `corpus/committed/breaks-and-retests-hg__ddba061af8.pine` | AMEX:SPY 1D from the listing | no | every plot on every bar; every box (left, right, top, bottom, colours) and every label (bar, price, text) | U-FGS sole script: breaks-and-retests-hg__ddba061af8 (its other daily capture is committed) |

## U-LIB: the first library links

`TradingView/ta/7` (a v5 library) is the first link: kalman-psar-backquant__0a389f529b is a v5 script on it,
so no cross-version rule applies, and its only runtime wall is the library. `TradingView/ZigZag/7` is v5 too,
imported by TradingView's own v6 built-ins; the committed LB1 capture (`lib-v5-in-v6-rddt-1d-2026-11-16`)
reads a v5 library keeping v5 rules inside a v6 script. Q-LIB-2 reads the numbers those built-ins draw from.
Neither probe copies a library line: each imports it.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-LIB-1 | `corpus/committed/kalman-psar-backquant__0a389f529b.pine` | AMEX:SPY 1D from the listing | no | every plot on every bar | U-LIB `TradingView/ta/7`: kalman-psar-backquant__0a389f529b (its other daily capture is committed) |
| Q-LIB-2a | `tools/visual_conformance/probes/vw-zigzag7-in-v6.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar (A00, Z01-Z06); the line and label counts (0 expected) | U-LIB `TradingView/ZigZag/7` in a v6 script |
| Q-LIB-2b | `tools/visual_conformance/probes/vw-zigzag7-in-v6.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol |

## Rows with no committed source (named in prose only)

These are requests for the capture session; none of them is a target this queue can build, because their
source is not in git.

- **Q-FGS-5 (licence-held reference scripts, out of git).** auto-length-moving-average-trend-signals-zeiierman
  and breaks-and-retests-with-volatility-stop-hg, each on NYSE:RDDT 1D and AMEX:SPY 1D from the listing, at the
  engine U-FGS ships with (their ledger rows were graded at engine 54). Record every plot on every bar and every
  drawing. They are U-FGS's other two sole scripts.
- **Q-LIB-3 (licence-held TradingView built-ins, out of git).** Auto Fib Extension, Auto Fib Retracement and Auto
  Pitchfork, each on NYSE:RDDT 1D and AMEX:SPY 1D from the listing, defaults. Record every line, label and
  linefill: count, both endpoints (bar index, time, price), text, colours. They are the importers of
  `TradingView/ZigZag/7`.
- **Q-LIB-4 (community importers of `TradingView/ta/11`, sources not in git).** A runtime registry row for a
  library version needs at least one COMMUNITY importing script graded MATCH, and the sample's six `ta/11`
  importers are all TradingView built-ins. Found by a search on 2026-11-19, each read from TradingView's public
  script endpoint at its current published version (all v6, MPL-2.0 by their own header, importing `ta/11` and
  no other library, no `request.*`):
  - Normalised Volume Oscillator [BackQuant] (`PUB;73fe20978a414bb197848c941bf183b8`, 112 lines, no drawings);
  - Market Extreme Zones Index [MisinkoMaster] (`PUB;786327ae221c46048686356dca5d5404`, 98 lines, no drawings);
  - RSI Median Deviation [PaulWegelin] (`PUB;1dc8725eaf7841a9b1b642c84c74c970`, 219 lines, no drawings).

  Each on NYSE:RDDT 1D and AMEX:SPY 1D from the listing, defaults; record every plot on every bar.
- **Q-MD-1 (conditional).** Nothing is asked until the `CAPADMIT_MODE=lanes` measurement reads whether the
  runtime lane draws the committed method-def MATCH captures (zero-lag-ma-trend-levels-chartprime,
  ict-killzones-pivots-tfo, pro-trading-art-double-top-bottom). If it does not, the request is
  volatility-trend-score-backquant on AMEX:SPY 1D from the listing.

## Built probes

Each probe's sha256 is the queue's (`python tools/vendor_harness/evidence_engine.py queue`), read off the
committed file; a capture records the source it ran, so a capture of an edited probe never closes its row.

- `vw-fn-global-window.pine`: `bd342ce9524268983f9f26fa7a1675a44f58ebdbf5e2d72732b8946bff11eb68`
- `vw-fn-global-window-v5.pine`: `7e7ce17a7524f62ba15ffc58d14dbeeaec6540fb4030e6966e7fab2ab4ce7dcb`
- `vw-zigzag7-in-v6.pine`: `4d1e4ee0a29c71fdd5ba0a2bab6c728fec31a083f163e63437a03a396ef28bba`

Sources already committed, for the rows that name them:

- `vw-udt-fn-global-history.pine`: `c2ac43f3728fddd4ee9b414777dc9507805ea95efaddedf68474063d98037dd6`
- `corpus/committed/breaks-and-retests-hg__ddba061af8.pine`: `ab681bc10a54911ae9feafb63866aab838e3edecc189d839dcc8441166f69466`
- `corpus/committed/kalman-psar-backquant__0a389f529b.pine`: `b8e4a504a5314605ae620a60e32a795b8bea7533e5c004e3649de3787692e8ad`

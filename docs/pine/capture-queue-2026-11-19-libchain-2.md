# Capture queue: the libraries chain, second set (2026-11-19)

Filed for coordinator patrick-2b by the libraries-chain engine work (U-LIB L2 `TradingView/ta/7`,
admit:method-def). Probes only: no engine change rides on this file. The first set is
`capture-queue-2026-11-19-libchain.md`.

Every chart is a daily chart with the inputs at their defaults (no probe has an input it needs set). A line
that does not compile is a reading: record the error text and the line, remove only that row, and capture
the rest. Captures are read after the close.

## U-LIB L2: the second importing script for `library:TradingView/ta/7`

A library version is admitted on two importing scripts graded MATCH with the runtime pane on, one of them a
community script (U15). Measured 2026-11-19 at engine 80, with `TradingView/ta/7` linked from a scratch store:
kalman-psar-backquant__0a389f529b (community, v5 on a v5 library) is drawn by the runtime lane and its committed
RDDT capture grades MATCH (all 3 items), and the admission evidence carries the version's pin. The sample's other
importers stop elsewhere (machine-learning-rsi-bullvision at conditional history, the TFlab script at its own
libraries, the v6 built-in at the v5-in-v6 gate). This probe is the second importing script; the member door draws
it on the runtime lane.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-LIB-5a | `tools/visual_conformance/probes/vw-ta7-import.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar (A00, L01-L03) | the `library:TradingView/ta/7` row: kalman-psar-backquant__0a389f529b |
| Q-LIB-5b | `tools/visual_conformance/probes/vw-ta7-import.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol |

## admit:method-def: a script the runtime lane draws

Measured 2026-11-19 at engine 80: the six committed captures whose scripts declare a `method` and grade MATCH are
drawn by the HOST lane (`capabilityAdmission.measure.test.js`, CAPADMIT_MODE=lanes), so none is evidence for a
runtime capability. The one method-def script the runtime lane draws, volatility-trend-score-backquant__0794882a37,
is INCONCLUSIVE on its committed RDDT capture: four items MATCH and one untitled plot cannot be paired by the harness.
This probe declares two methods on a `var` user type, and the member door draws it on the runtime lane.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-MD-2a | `tools/visual_conformance/probes/vw-method-def-runtime.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar (A00, M01-M03) | admit:method-def, beside volatility-trend-score-backquant__0794882a37 |
| Q-MD-2b | `tools/visual_conformance/probes/vw-method-def-runtime.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol |

## Built probes

Each probe's sha256 is the queue's (`python tools/vendor_harness/evidence_engine.py queue`), read off the
committed file; a capture records the source it ran, so a capture of an edited probe never closes its row.

- `vw-ta7-import.pine`: `68c431e19c2d2fa862f74ce89759f12934a69903a6bf682061b55e61429bfbaf`
- `vw-method-def-runtime.pine`: `db1db7b4c721e677744219217103d56e81c9067f7ec9ec8e71aaec5a122052b8`

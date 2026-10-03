# Capture queue — 2026-10-03 RT6, per-bar colour on the runtime lane

Branch `pine/rt6-runtime-colour`. For CAP3 to run on the live TradingView rig with
`tools/vendor_harness/tv_capture.js` (procedure as `docs/pine/capture-queue-2026-09-28.md`).
⚠️ The probe is not compiled on TradingView yet: if a row does not compile, the error names the line — split it out.

The rules are in `docs/pine/vendor-harness/objects-triage-2026-09-28.md` § RT6.

| id | probe / script | chart | question | what the engine does today | what the capture changes |
|---|---|---|---|---|---|
| Q-RT6a | `tools/visual_conformance/probes/vw-rt6-runtime-colour.pine` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D | C01/C02: a `var` colour switched by state, and `color.new(<it>, 40)`, per bar; C03–C05: what `color.new(na, t)`, `color.new(c, na)` and `color.rgb(na, …)` are; C06 a plot point whose colour is `na`; B01/G01 a runtime `barcolor` / conditional `bgcolor` | C01/C02/C06/B01/G01 carried from the run (`colorPacked`); C03–C05 read as `na` (draw nothing) — `runtime/colours.js`, not witnessed | a witness for each row; C03–C05 settle the `na` operand rule `color.new` / `color.rgb` now follow |
| Q-RT6b | `corpus/committed/kalman-price-filter-backquant__47a601e4bc.pine` | NYSE:RDDT 1D from the listing | plot `Kalman` value + per-bar colour, and the `barcolor` | runtime document draws both; held to a hand replay (`vendorHarness.rt6RuntimeColour`) | first TradingView grade |
| Q-RT6c | `corpus/committed/deadband-hysteresis-filter-backquant__3fb3d09595.pine` | NYSE:RDDT 1D from the listing | plot `DBHF` + per-bar colour, `barcolor` | as Q-RT6b | as Q-RT6b |
| Q-RT6d | `corpus/committed/nadaraya-watson-rational-quadratic-kernel-non-repainting__2d248c3125.pine` | NYSE:RDDT 1D from the listing | the kernel estimate + its rate colour | as Q-RT6b | as Q-RT6b |
| Q-RT6e | `corpus/committed/atr-stepped-pdf-ma-loxx__9b90a3f7bb.pine` | NYSE:RDDT 1D from the listing | the stepped MA + `contSwitch` colour | as Q-RT6b | as Q-RT6b |
| Q-RT6f | `corpus/committed/parabolic-sar__xoeoPMOWGJ.pine` | NYSE:RDDT 1D from the listing | SAR value + `trend > 0 ? colup : coldn` (v4 palette) | as Q-RT6b (value and colour both replayed) | as Q-RT6b |

fvg-trend is not queued: `fvg-trend-rddt-1d-2026-09-27` already grades its plot colour MATCH and its
`bgcolor(…, transp=90)` agree on 631 bars.

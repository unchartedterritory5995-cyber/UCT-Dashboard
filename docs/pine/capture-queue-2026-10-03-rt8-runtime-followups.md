# Capture queue — 2026-10-03 RT8, the runtime lane's follow-ups

Branch `pine/rt8-runtime-followups`. For CAP3 to run on the live TradingView rig with
`tools/vendor_harness/tv_capture.js` (procedure as `docs/pine/capture-queue-2026-09-28.md`).
⚠️ The probes are not compiled on TradingView yet: if a row does not compile, the error names the line — split it out.

The rules are in `docs/pine/vendor-harness/objects-triage-2026-09-28.md` § RT8.

| id | probe / script | chart | question | what the engine does today | what the capture changes |
|---|---|---|---|---|---|
| Q-RT8a | `tools/visual_conformance/probes/vw-rt8-runtime-followups.pine` rows W01-W03 | NYSE:RDDT 1D from the listing | `ta.wma`'s first answer when finite values PRECEDE a gap: on its n-th finite input (rule A, W01 bar 26) or when its window holds n-1 finite values (rule B, bar 28)? | rule A on the runtime lane (`runtime/vm.js` OP.WINDOW `ffill`), from one witness (trend-targets-algoalpha RDDT, where A and B agree). The HOST lane's `rolling` FFILL answers on the first finite bar whose filled window is full (W01: bar 20; W03: bar 50, bar 0's 0 carried through 1-49), where rule A answers W01 on bar 26 and W03 on bar 58 | settles A vs B; W03 decides whether the host lane's `wma` warm-up must move too |
| Q-RT8b | same probe, rows S01-S04 | NYSE:RDDT 1D from the listing | a `plotshape` / `plotchar` whose colour changes per bar, on a runtime document: the per-bar colorer values; S02/S04: what TradingView draws on a bar whose shape colour is `na` (glyph hidden? text kept?) | withheld by name ("a shape whose colour changes per bar is not carried by this lane yet") | the evidence the marker layer needs to carry a per-point colour (`markerPrimitive.markersFor`) |
| Q-RT8c | same probe, rows F01-F02 | NYSE:RDDT 1D from the listing | a per-bar fill colour on a runtime document, one edge `display.none`; `na` bars | carried (RT8): the band on a hidden anchor row, coloured by the run (graded on atr-trailing-stop-by-ceyhun's capture with the script forced onto the runtime lane) | a direct grade with no forcing |
| Q-RT8d | `tools/visual_conformance/probes/vw-rt8-v4-fill-transp.pine` | NYSE:RDDT 1D | a v4 `fill`'s style transparency: absent (default?) and written (`transp = 60`) — read `styleState` / the fill's drawn alpha | a v4 fill on a runtime document is withheld by name | the rule to carry v4 fills |

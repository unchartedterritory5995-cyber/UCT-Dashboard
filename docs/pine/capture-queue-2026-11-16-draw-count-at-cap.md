# Capture queue: DRAW-1, what TradingView holds when a drawing family reaches its max count (2026-11-16)

Branch `feat/pine-coverage-drawings` (unit DRAW-1). Procedure: `docs/pine/capture-queue-2026-09-28.md`.
The owner runs every capture; no builder opens TradingView. The probe was not compiled on TradingView when it
was written. A runtime or compile error is itself a reading: record its text and the line or bar it names.

The reference says of `max_boxes_count`, `max_lines_count` and `max_labels_count`: "The count is approximate;
more drawings than the specified count may be displayed." `objectPool.js` C7 measured one exact rule on probes
that draw on every bar (`vw-object-gc-a..d`): a create that takes a family past `cap + 5` deletes the oldest
until `cap` remain. `inside-bar-boxes-rddt-1d-2026-11-14` draws only on some bars, and TradingView held 52 boxes
at cap 50 where our replay of that rule holds 50 (the 50 paired boxes agree on every graded field). This queue
row measures the held count against the number made, per bar, for a script that does not draw on every bar.

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-DRAW-CAP-1 | `tools/visual_conformance/probes/vw-draw-count-at-cap.pine` rows C00-C06 | AMEX:SPY 1D | per bar, the live count of boxes, lines and labels (`*.all.size()`) against the number the script has made, at cap 20, when creation is sparse (every 3rd bar, plus a second box every 7th) | both lanes run C7's batch rule; a family whose live count reaches its cap is drawn under the guard `obj:count-at-cap` (see the DRAW-1 evidence) |
| Q-DRAW-CAP-2 | `tools/visual_conformance/probes/vw-draw-count-at-cap.pine` rows C00-C06 | NYSE:RDDT 1D | the same, on a chart that starts at the listing (666 bars), the chart inside-bar-boxes was captured on | as above |

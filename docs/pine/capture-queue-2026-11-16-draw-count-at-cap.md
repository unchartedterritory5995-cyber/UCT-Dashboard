# Capture queue: DRAW-1, what TradingView holds when a drawing family reaches its max count (2026-11-16)

Branch `feat/pine-coverage-drawings` (unit DRAW-1). Procedure: `docs/pine/capture-queue-2026-09-28.md`.
The owner runs every capture; no builder opens TradingView. The probe was not compiled on TradingView when it
was written. A runtime or compile error is itself a reading: record its text and the line or bar it names.

The reference says of `max_boxes_count`, `max_lines_count` and `max_labels_count`: "The count is approximate;
more drawings than the specified count may be displayed." `objectPool.js` C7 measured one exact rule (probes
`vw-object-gc-a..d`, and every committed capture whose label or line collector ran): a create that takes a
family past `cap + 5` deletes the oldest until `cap` remain. One capture disagrees: `inside-bar-boxes-rddt-1d-
2026-11-14` made 158 boxes on both sides and TradingView held 52 (ids 107-158) where the rule holds 50
(109-158); the 50 paired boxes agree on every graded field. Its shape: a `var box` assigned on sparse bars, and
the next bars move the previous bar's box through the variable's history (`box.set_right(myBox[1], ...)`).
sonarlab-order-blocks (boxes held in arrays) and parabolic-sar (labels never held, sparse) follow the rule.
This queue row measures the held count against the number made, per bar, with each family in one shape.

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-DRAW-CAP-1 | `tools/visual_conformance/probes/vw-draw-count-at-cap.pine` rows C00-C06 | AMEX:SPY 1D | per bar, the live count (`*.all.size()`) against the number made, at cap 20, one create every 3rd bar: boxes in inside-bar-boxes' shape (`var box`, then `set_right` through `[1]`), labels held in a `var` and never read through history, lines never held | host lane: C7 for every family. Runtime lane: C7 for labels and lines; the box family is withheld by name once its collector runs (`objects:count-at-cap`, DRAW-1 evidence) |
| Q-DRAW-CAP-2 | `tools/visual_conformance/probes/vw-draw-count-at-cap.pine` rows C00-C06 | NYSE:RDDT 1D | the same, on a chart that starts at the listing, the chart inside-bar-boxes was captured on | as above |

What lifts the carve-out: if the box rows follow C7 on both charts, the box shape is not what moved
inside-bar-boxes, and the carve-out stays until a probe reproduces 52; if they hold more than C7 and the
label and line rows follow it, the shape is named and the store can model it (then sonarlab-order-blocks,
withheld pending this probe, is drawn again).

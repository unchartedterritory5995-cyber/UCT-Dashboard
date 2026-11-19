# Capture queue: an hline written out in full, and a fill between anchors the author hid (2026-11-19)

Same procedure as `docs/pine/capture-queue-2026-09-28.md`: capture from the listing, keep the plotted values as full
float64 text, and record each capture's own `capturedAtUTC`. Both probes are ours (licence `probe`).

**Why.**
- An `hline` is a metaInfo BAND, not a plot. Until 2026-11-19 `tv_capture.js` recorded only plots, so no committed
  capture holds an hline's level, colour, style or width, and the harness cannot grade one. The capture tool now
  records `study.bands` / `bandDefaults` / `bandState` (and `filledAreas` / `filledAreaDefaults` / `filledAreaState`
  for fills); these rows are the first to hold them.
- A script whose only translating outputs are series the author hid (`display.none`, or an untitled `fill()` anchor)
  is refused as `pine:hidden-only` (ruling 1.2: no column is offered). What the pane may DRAW for it, the fill between
  two hidden anchors and whether an untitled anchor with no `display` is drawn as a line, has no capture. Engine 75
  measured one untitled anchor (`display: 15`, drawn); this probe asks for the pair and for a fill between hidden ones.

| id | probe | chart | question | live | phase |
|---|---|---|---|---|---|
| Q-HLINE-1 | `vw-hline-written.pine` | NYSE:RDDT 1D | H1-H7: each hline's level, colour (incl. a transparency and a fully transparent colour), line style and width, as `bands` / `bandDefaults` / `bandState` record them; H5 (price only) gives TradingView's own defaults | no |  |
| Q-FILL-HID-1 | `vw-fill-hidden-anchors.pine` | NYSE:RDDT 1D | F1 (both anchors `display.none`), F2 (both untitled, no `display`), F3 (one of each): is each fill drawn, in what colour, and is each anchor drawn as a line (`styleState[...].display` / `visible`)? | no |  |

**What each answer moves.**
- Q-HLINE-1 gives `compare.mjs` the key shapes a `bands` case grades (level, colour, style, width per band), and
  grades the engine's hline rows against them. Today an hline row's presentation is ungraded on every capture.
- Q-FILL-HID-1 says what a member pane may draw for a `pine:hidden-only` script: the fills and which anchors,
  graded MATCH before anything about that shape is served.

## The scripts the ONCE-EMPTY LIST rule draws (ruling (B), #2014; coordinator condition, 2026-11-19)

A test of a `var` list nothing has written yet, at the top of a `barstate.islast` block, runs no step on the host lane's
one recompute, so these scripts' last-bar clean-up loops no longer refuse them. They are drawn on the host lane's
capability licence; no committed capture grades them yet. Capture each from the listing, inputs at defaults (corpus
`reference/`, licence-held: the capture is graded locally and not committed if the licence says so).

| id | script | chart | question | live | phase |
|---|---|---|---|---|---|
| Q-ONCE-1a | `reference/camarilla-levels-intraday__bfb5a2b8db` | NYSE:RDDT 1D, AMEX:SPY 1D | do the levels and labels drawn on the last bar match TradingView's (objects, by family and price)? | no |  |
| Q-ONCE-1b | `reference/rsi-support-resistance-by-dgt__ZkkLVEb1ak` | NYSE:RDDT 1D, AMEX:SPY 1D | the lines and linefills drawn on the last bar, beside its plots | no |  |
| Q-ONCE-1c | `reference/support-resistance-fibonacci-retracement__06a1a2c80d` | NYSE:RDDT 1D, AMEX:SPY 1D | the lines and labels, including the 6 list reads (B) now carries | no |  |

**What each answer moves.** MATCH keeps the script drawn. **DIVERGE applies the REACH kill rule by source hash**
(the script is withheld by name until the divergence is understood), per the coordinator's condition on ruling (B).

# Guide overlay geometry: root cause and the shared fix

> SIMULATED: source reading plus jsdom rails. The real-browser evidence (screenshots and pixel measurements, before and
> after) is pl-auto's, on branch `agent/pl/guide-overlay-geometry`. Written 2026-11-09 from master `fdd4d73bd1`.

## The owner's report
1. The gold ring around a chart does not run cleanly from top to bottom.
2. The ring on a widget's resize corner lags while the member drags it.

## How a target is found and measured (master)
- **Finding it.** `GuideOverlay.jsx` runs `tick()` on `setInterval(tick, POLL_MS)`, with `POLL_MS = 120`
  (`placement.js:4`). Each tick:
  - re-finds the step's element (`targets.findTarget`);
  - measures it (`targets.rectOf`);
  - puts the result in React state (`setFound`).
  - The ring is a `position: fixed` div whose `top`, `left`, `width` and `height` come from that state.
- **Coordinate system.** `rectOf` uses `getBoundingClientRect()`: viewport CSS px with transforms and browser zoom
  already applied. A `position: fixed` ring at those numbers lines up only if no ancestor of the ring is transformed.
  The ring is portalled to `document.body`, so that holds. Zoom (`ctrl +`) changes both sides equally. **Not a cause.**
- **Clipping.** `rectOf` → `clipOf(el)` finds the **nearest** ancestor whose `overflowX` / `overflow` is
  `hidden|clip` and intersects **horizontally only**. The top and bottom are always the element's own:
  `top: r.top - pad, height: r.height + pad * 2`. Two gaps follow:
  - **Vertical clipping is never applied.** Confirmed by reading the code (targets.js `rectOf`, master).
  - **Only the nearest clipping ancestor counts.** A clip further out (the board cell, `ChartsWorkspace.module.css`
    `overflow: hidden` / `auto` boxes) is ignored on both axes.
  - `auto` and `scroll` containers are not treated as clips at all.

## (1) "Not clean top to bottom": cause
- The chart's anchor is `data-guide="chart.plot"` (`StockChart.jsx` ~20596): the chart library's container, styled
  `width: 100%; height: 100%` (`StockChart.module.css .chart`).
- Its box is the **plot container**, not the visible chart cell. It does not include the chart's header or toolbar
  row, and it can extend past the cell's bottom edge, which the cell clips, while panes are being laid out or with a
  volume or indicator pane.
- Because `rectOf` never clips vertically, the ring's top and bottom follow the plot container's own box, not what the
  member sees. Its sides are clipped to the nearest horizontal clip, and its top and bottom are not.
  - So the ring can run past the cell's bottom, or start below the header, while its sides look right.
- Status: the mechanism is confirmed in source and pinned by a rail. Rail 1 sets a plot taller than its cell: on master
  `rectOf` returns the unclipped height; with the fix the ring stops at the cell's bottom.
- **Still to measure (pl-auto):** the real chart's ring against its cell, edge by edge, before and after.
- **A second possibility, also for pl-auto to check:** a ring meant for the whole chart cell anchored on the inner
  plot. If the owner wants the whole cell including its header, that is a target choice (which anchor a step names),
  not geometry. This branch does not change any step's target.

## (2) "Lags a drag": timing
On master, two delays add up:
1. **Sampling.** The ring moves only when `tick()` runs: every 120 ms, so up to 120 ms late.
2. **Smoothing.** `.ring { transition: top 120ms, left 120ms, width 120ms, height 120ms }` (`GuideOverlay.module.css`):
   each new position is approached over another 120 ms.

- Worst case, about 240 ms behind a moving handle, and it never catches up while the drag keeps moving.
- Animating `top`/`left`/`width`/`height` also forces layout on every animation frame. The ring's
  `box-shadow: 0 0 0 9999px` dim then repaints the whole viewport each frame.
- The resize handle (`widget.resize.<dir>`, ChartsWorkspace.jsx ~3690) is a 10–14 px box. Its ring was a padded
  rectangle with an 8 px radius, so it did not sit evenly on the corner.

## The shared fix (every walkthrough; no step changed)
- **`guide/ringGeometry.js`** is the one module for the ring's geometry:
  - **`RING`** constants: `pad` 4, `radius` 8, `stroke` 2, `handlePad` 6, `handleMax` 24.
  - **`visibleBox(el)`**: the element's box intersected with **every** clipping ancestor (`hidden|clip|auto|scroll`),
    on **each axis separately**. It stops at a `position: fixed` ancestor.
  - **`isHandle(el)`**: a dragged control of 24 px or less on both sides (a `resize` anchor, or a resize, grab or move
    cursor). **`ringRect`** rings it as a **circle centred on the handle's own centre**.
  - **`trackRing(el, onRing, { holder })`**, event-driven:
    - a `ResizeObserver` on the control and on its board cell (a cell resized from its corner moves the control);
    - `scroll` (capture) and `resize` on the window;
    - a `requestAnimationFrame` loop that runs **only** while a pointer drag is in progress or the rectangle changed in
      the last `STILL_FRAMES` (6) frames, then stops;
    - one read per frame, and one write;
    - `stop()` removes every listener, the observer and any pending frame.
- **`targets.rectOf`** now uses `visibleBox`, so the card's placement and the ring use the same measurement.
- **`GuideOverlay.jsx`:**
  - `tick()` still finds the step's element and runs the step logic (`waitFor`, lost, pause) on `POLL_MS`. That
    interval is cleared with the step's effect, as before.
  - The ring is placed by `trackRing` through `applyRing`: `transform: translate3d(x, y, 0)` plus width and height,
    written straight to the ring node. React never writes over it, because the style prop is a constant.
  - It hides (opacity 0) when nothing of the control shows. It is removed when the control unmounts, because the tick
    drops the target.
  - The tracker stops when the step changes, when the walkthrough ends, and when the overlay unmounts.
- **CSS:** `.ring` keeps `pointer-events: none`. The positional transition is gone: only `opacity 80ms`, with
  `will-change: transform`.

## Rails (`src/agent/agentGuideRingGeometry.test.jsx`, 11 tests, SIMULATED)
1. **Static alignment:**
   - a control is its box ± `RING.pad`;
   - a plot taller and wider than its cell is clipped on both axes;
   - a resize corner gets a circle on its centre;
   - a fully clipped control gets no ring;
   - `applyRing` writes a transform, never top or left.
2. **Moving target:**
   - each frame of a drag puts the ring on the handle's new centre (one frame, not 120–240 ms);
   - the loop stops once still;
   - an idle control schedules no frames.
3. **Unmount:** the ring is told null and no frame follows.
4. **Cancel (the real overlay, panel harness):**
   - the ring sits on the control by transform and follows it on the next frame;
   - after Exit there is no ring and no requested frame.
5. **Pointer-through:**
   - `.ring` is `pointer-events: none` with no positional transition;
   - a press on a highlighted handle reaches the handle, not prevented.

One existing rail read the ring's `style.top`: `agentGuideWatchlistCreate.test.jsx` `ringIsOn`. It now reads the
transform's y. Same check, same numbers.

## For pl-auto (real browser; before = master `fdd4d73bd1`, after = this branch's head)
- **Chart ring:** start a chart walkthrough whose step rings `chart.plot` (for example "how do I zoom in"). Measure
  the ring's border box against the chart cell's visible box, edge by edge, in px.
- **Resize corner drag:** ring `widget.resize.se` ("how do I resize a widget"), then drag the corner 300 px. Per frame,
  record the distance between the ring's centre and the handle's centre: master versus branch.
- **Other targets:** a toolbar button, a menu row and a settings row. Ring box against control box (expect `pad` 4 on
  every side, clipped where the control is clipped).

## Round 2: pl-auto's real-browser findings (fdd4d73bd1 vs 871f899c0b) and the fixes (`d2d69e3b93`, rails `869b750056`)
Real browser (pl-auto): corner-drag centre error max 10.4 → 2.6 px; reflow lag max 806 → 132 ms; static fit at `pad` on
every target type; tracking stops after done / exit / Escape. Still open, each fixed here (SIMULATED until pl-auto
re-measures):

1. **The walkthrough ended itself 136–444 ms into a corner drag** (both trees). Cause: a step with no `waitFor` was
   treated as done `POLL_MS * 2` (240 ms) after the press on its control.
   - Fix: a control the member drags (`ringGeometry.isDragControl`: a `resize` anchor, or a resize, grab or move
     cursor) is done when the drag **ends** (`pointerup` / `pointercancel`).
   - Rail 6 holds an edge, then a corner, for 600 ms: the step stays, and it moves on or ends only on release.
2. **Reflow and drag lag above tolerance** (max 15.3 px / 132 ms; drag lag max 142 ms).
   - `trackRing` now measures **inside the ResizeObserver callback**. That runs after layout and before paint, so the
     ring is written in the same frame; the next rAF frame was one frame late.
   - It also observes the board (the cell's parent) and the control's offset parent, so a reflow that moves a cell
     without resizing it is seen.
   - Measured only by pl-auto: the remaining lag maxima may be main-thread work during the chart's own re-render,
     which no observer can beat.
3. **The 120 ms poll kept ticking after the walkthrough's chart closed** (17 ticks in 2 s).
   - Fix: the interval runs only while the step's control is on screen.
   - While it is gone, a `MutationObserver` on the page looks again on the next frame after a change: nodes added or
     removed, or `hidden` / `aria-hidden` / `aria-expanded` / `open` / `class` changes. Each deadline (LATE_MS,
     LOST_MS, PAUSE_MS) gets one timer.
   - Rail 7 removes the chart: 600 ms with no measurement at all. When the chart comes back, the ring returns.
4. **A whole-chart step left the cell's header and toolbar uncovered.**
   - Fix: `ringGeometry.ringElementOf` rings a `chart.plot` step's **whole board cell**: `[data-grid-cell-id]`, else
     `[data-widget-id]`.
   - The card keeps off the cell. The step's target and its click detection are unchanged.
   - Rail 8: the ring is the cell box ± `pad`.

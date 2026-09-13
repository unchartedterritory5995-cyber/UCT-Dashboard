# G3-15 clearance sweep — deployed build, after #109 merged

`python tools/hub_chip_clearance.py --base https://uctintelligence.com`, run 2026-09-12
against master `9b51eaf1a` (PR #109 merged and deployed; `/api/health` uptime had reset).

⭐ **The instrument was proven able to print BOTH verdicts before this run**, which is the
only reason a green row means anything:

```
SELF-CHECK PASS — 6 verdict cases plus the arithmetic, including the two that matter:
an empty sweep reads as a FAILURE, and a chip whose rects look clear while a point inside
it resolves to another element is still caught.
  fixture[clear]       chipRight=166 overlapX=-8 samples=60 -> PASS
  fixture[overlapping] chipRight=118 overlapX=40 samples=60 -> FAIL
✅ FIXTURE CONTROL PASS — in real Chromium the sweep returns PASS on clearing boxes and
FAIL on the 40px overlap the device measured.
```

## The run

```
G3-15 chip clearance — https://uctintelligence.com, widths [360, 375, 430]
  routed modes derived from registry.js: 9 — ['breadth','calendar','chart','flow','home','journal','notebook','scan','wire']
  [ok] signed in as smoke@uctintelligence.internal
  ✗ breadth  @360: 56/56 points inside the chip resolve to something else (x=154->span, ...)
  ✓ calendar @360: 57 points, all chip; chip.left 24 is -222px clear of the button
  ✓ chart    @360: 57 points, all chip; chip.left 24 is -222px clear of the button
  ✓ home     @360: 57 points, all chip; chip.left 24 is -222px clear of the button
  ✗ notebook @360: 10/57 points resolve to something else (x=25->Log a trade, ...)
  ✗ journal  @360: 10/57 points resolve to something else (x=25->Log a trade, ...)
  ✓ wire     @360: 56 points, all chip; chip.left 28 is -218px clear of the button
  ✓ flow     @360: 57 points, all chip; chip.left 24 is -222px clear of the button
  ✓ scan     @360: 57 points, all chip; chip.left 24 is -222px clear of the button
  ✓ breadth  @375: 56 points, all chip; chip.left 47 is -214px clear of the button
  ✓ calendar @375: 57 points, all chip; chip.left 35 is -226px clear of the button
  ✓ chart    @375: 58 points, all chip; chip.left 24 is -237px clear of the button
  ✓ home     @375: 58 points, all chip; chip.left 24 is -237px clear of the button
  ✗ notebook @375: 10/58 points resolve to something else (x=29->Log a trade, ...)
  ✗ journal  @375: 10/58 points resolve to something else (x=25->Log a trade, ...)
  ✓ wire     @375: 56 points, all chip; chip.left 43 is -218px clear of the button
  ✓ flow     @375: 58 points, all chip; chip.left 24 is -237px clear of the button
  ✓ scan     @375: 58 points, all chip; chip.left 24 is -237px clear of the button
  ✓ breadth  @430: 56 points, all chip; chip.left 102 is -214px clear of the button
  ✓ calendar @430: 57 points, all chip; chip.left  90 is -226px clear of the button
  ✓ chart    @430: 59 points, all chip; chip.left  78 is -238px clear of the button
  ✓ home     @430: 61 points, all chip; chip.left  60 is -256px clear of the button
  ✗ notebook @430:  3/58 points resolve to something else (x=84->Log a trade, x=92->Log a trade, x=100->div)
  ✗ journal  @430:  4/59 points resolve to something else (x=77->Log a trade, x=85->Log a trade, x=93->Log a trade, x=101->div)
  ✓ wire     @430: 56 points, all chip; chip.left  98 is -218px clear of the button
  ✓ flow     @430: 61 points, all chip; chip.left  61 is -255px clear of the button
  ✓ scan     @430: 65 points, all chip; chip.left  24 is -292px clear of the button

  27 (mode, width) pairs measured
⛔ G3-15 FAILS on 7 count(s).
```

## Reading it — two different properties, and the tool asks the broader one

⭐ **G3-15's own property PASSES 27/27: in NOT ONE sampled point, at any mode or width, did
the chip resolve to the Actions button.** Every passing row states the clearance explicitly
(214–292 px). The overlap the row was opened for is gone.

⛔ The 7 failures are a DIFFERENT element covering the chip, and they are recorded as **G3-18**:
`journal` / `notebook` are covered by the Journal's own bottom-left **"Log a trade" FAB**
(`JournalLogFab.jsx`, `position: fixed`, whose docstring still calls its placement
*"non-colliding — see B5"*), and `breadth @360` by a `span`.

⚠️ **Believed to PREDATE #109, and NOT measured on the pre-fix build.** The chip's left edge at
max width is `100vw − inset − maxWidth`, and since `maxWidth = 100vw − (inset + EDGE_OFFSET)`
the inset cancels: the left edge lands at `EDGE_OFFSET = 24` both before and after the fix.
Moving the anchor 48px inward shortened the chip without moving its left edge. That is
reasoning from the source, not a measurement — master has moved past the pre-fix build.

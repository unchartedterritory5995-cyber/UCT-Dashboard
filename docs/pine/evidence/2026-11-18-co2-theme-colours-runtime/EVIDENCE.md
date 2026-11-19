# CO-2: `chart.fg_color` / `chart.bg_color` on the runtime lane (engine NUMBER PENDING)

This is coordinator's order item 6, as revised. The two theme colours resolve on the runtime lane through the SAME
theme reference the host reader uses (`objectTheme.js`, since engine 65). That covers them:

- as values;
- in `color.new(…, t)` at any t;
- as `text_color`.

There is one authority and no second copy of the theme. The rail checks that the runtime lane and the host reader
resolve the same colour, for light and dark.

## What TradingView does

The two are the colours of the chart the script runs on: its background, and the high-contrast foreground that reads
against it. The light-theme capture `vw-theme-colours-spy-1d-2026-10-01` reads `#0f0f0f` on `#ffffff`.

The host reader carries each as a reference (`chart.fg_color`, `chart.bg_color@40`) and resolves it where it is drawn,
against the member's own chart (`chartThemeOf`, `resolveThemeColour`). It never uses TradingView's values (C37).

## What changed

**The carrier.** The runtime lane holds a colour as a number, the packed `0xTTBBGGRR` integer, so it cannot hold a
reference string. The reference now rides as a number above every packed colour:

- the formula is `THEME_PACKED_BASE` (2^32) + 256·which + transparency, which is exact in a float64;
- `objectTheme.packedThemeColour` and `themeColourOfPacked` convert between the reference and the number;
- that number is never read as components.

**Where the colour leaves the run, it becomes the same reference again:**

- **An object's colour slot** (`colours.js::packedToObjectHex`). The render state (`objectRenderState.toRenderState`)
  then paints it, exactly as it paints a host object's reference.
- **A per-bar colour column** (`pool.js::packedPointColour`). It is resolved against the chart's theme, which the
  binder hands to every colour plan it draws a run's column with (`pool.withPackedTheme`). The call sites are a plot's
  points, its markers, a band's fill, a `bgcolor` / `barcolor` paint, and a computed candle. The theme also joins the
  plan's signature, so a theme change repaints.
  - A plan with no theme, or a theme that cannot answer (a gradient background), draws that bar in no colour, never a
    guess. That is the rule `withThemeColour` already follows.

**The front end** (`pineRuntimeFrontend.js`) lowers the two names to the carrier number and reads them as colours
(`holdsColour`). A script's own binding of either name wins.

**`color.new(theme, t)`** sets the reference's transparency at any whole t, fixed or computed per bar, clamped as every
transparency is. A t that is not a whole number stops the run by name. Its paint is the exact transparency, and a
reference carries a whole one (the host reader's own rule, `pine.js::themePlotColourOf`).

**What stops by name.** In each of these cases the chart's colour is not in the computation:

- **A colour comparison** that meets the theme colour. Only in a script that names one, each operand takes an
  internal step (`colours.js::COLOUR_COMPARABLE`, whose name has a space, so no Pine source can call it). That step
  stops the run where the operand is a reference. Every other script's comparison is lowered exactly as before (railed:
  the program holds no such step).
- **A `color.from_gradient` endpoint.**
- **A fractional `color.new` transparency.**

## Rails and mutants

`runtime/__tests__/themeColoursRuntime.test.js` checks the runtime lane against the host reader, on a light chart
(`#131722` on `#ffffff`) and a dark one (`#d1d4dc` on `#131722`):

- **Labels drawn by the runtime drawing build:**
  - `textcolor = chart.fg_color`;
  - `color = chart.bg_color`;
  - `textcolor = color.new(chart.fg_color, 40)`;
  - a name bound to it;
  - a `var` seeded with it.

  The reference string is equal, and the drawn colour is equal. The light and dark charts differ.
- **A `bgcolor` column:**
  - `color.new(chart.bg_color, 80)`;
  - a transparency the bar computes (`close > open ? 20 : 60`);
  - a choice between the theme colour and a fixed one.

  Each bar is the host reference resolved. With no theme handed in, a bar holding the reference has no colour. The
  plan's signature carries the theme.
- **The stops:** a comparison, a gradient endpoint, a fractional t. The CONTROL is a script that never names the theme,
  whose colour comparison has no extra step.
- **The carrier:** it lies above every packed colour, it round-trips, and out-of-range numbers are null.

`__tests__/themeColoursRuntimeBinder.test.js` puts a runtime-lane row through the binder with a fake chart: a
`for`-loop running total that the host lane refuses. The plot's points and its `bgcolor` wear the chart's colours on a
light chart. When the chart turns dark, the same bars repaint, and only the theme-coloured ones change.

Re-pinned:

- `ast/objectColourNodes.test.js`: `2 ** 32` is now the carrier of `chart.fg_color`; the out-of-range control is past
  the carrier's range.
- `builder/memberPane/draw1KeepHost.test.js`: trend-levels-chartprime's drawing build now stops at its next wall
  (`runtime:call-text-state`, not `pine:builtin` at `chart.fg_color`), and the door still declines it the same way.

Mutants N1-N10 are in `ci/mutants/co2-theme-colours-runtime.json`. Each was made on a saved copy, watched turn its rail
red, and then restored from that copy and confirmed byte-equal.

## Blast radius (the 679-script coverage-map sample, every wall peeled, under the heavy lock)

Measured with master's front end and this branch's, over the same tree. 15 scripts move:

- **Three now build at step 0 on the runtime lane:**
  - `committed:market-structure-by-leviathan`: host-clean. Its captures grade MATCH on both lanes already.
  - `committed:swing-highlow-zigzag-chartprime`: its captures grade MATCH on both lanes already.
  - `committed:volatility-coil-edge-bullbyte`: refused on both lanes before (`pine:reassign` / `runtime:colour`).
    Its three captures grade on this PR's run.
- **Twelve still refused at the same first wall.** Their `pine:builtin` / `runtime:colour` walls at the theme colours
  give way to the next walls by name.

The PR's own pine-heavy run is the corpus diff for all three. A capture that moves away from MATCH stops this work, and
a newly drawn capture that grades DIVERGE is killed by the REACH rule.

## Corpus diff (this PR's pine-heavy run 44482355116, head 106ffa1def, against train e81's run 44452719465)

e81 is the newest train already in this PR's base (5c2aa89822).

- **Production lane:** 938 captures, none moved.
- **Runtime-on lane:** 3 captures moved, none away from MATCH, all of them volatility-coil-edge-bullbyte. Each went
  INCONCLUSIVE -> DIVERGE, with 1 of 5 compared items diverging: TradingView paints the script's "Signal Bar BG"
  background (`bgcolor plot_0`), and the runtime lane does not draw it. The three captures:
  - RDDT daily, 2026-11-14;
  - RDDT daily, 2026-11-17;
  - SPY daily, 2026-11-17.
- **market-structure-by-leviathan and swing-highlow-zigzag-chartprime:** their captures grade MATCH, unchanged.

Under admission, the door now draws volatility-coil-edge-bullbyte on the runtime lane. `capabilityEvidenceLane.test.js`
went red on that: the door answers `runtime` where the reach report said refused. Its captures DIVERGE, so it is killed,
by the coordinator's instruction of 2026-11-19 and the standing ruling of 2026-11-16 (an admitted script with a DIVERGE
capture is killed by source hash):

- **`api/data/pine_runtime_killlist.json`:** the entry, sha256 `e8c92f7b…` of
  `corpus/committed/volatility-coil-edge-bullbyte__604f0fd1c6.pine`. It is held to the SPY capture's DIVERGE grade, and
  its liftWhen is the background drawn and a re-grade to MATCH.
- **`docs/pine/vendor-harness/runtime-on/verdicts.json`:** the three records, spliced verbatim from run 44482355116.
- **The reach report:** drops the three captures, because a killed script is not admitted. Its populations follow:
  - captures admitted 561 -> 558, refused 146 -> 143;
  - committed scripts admitted 118 -> 117, refused 33 -> 32.

  The reference population is counted from the local reference cache and is not re-measured here; no rail reads it.
- **`capabilityEvidenceLane.test.js`:** records the change.

Members see what they see today. The script was refused before (`pine:reassign` on the host lane, `runtime:colour` on
the runtime lane), and it is refused now, by name.

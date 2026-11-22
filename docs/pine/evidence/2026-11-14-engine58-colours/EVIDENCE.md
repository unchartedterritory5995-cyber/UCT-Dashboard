# Engine 58: colours found by fresh TradingView captures

Branch `fix/pine-engine58-colours`, on `origin/master` (engine 54). Engines 55 (#1264), 56 (#1265) and
57 (#1294) merge first; this branch takes 58 and its history line says it follows 57. Sources: the
S3/S4 investigator report (section B: C1/C2, C3, C4), the S1 evidence probes (PR #1286, merged:
`tests/fixtures/vendor/transparency-defaults-by-version-rddt-1d-2026-11-14.json`,
`vw-cs1-transp-v{1,2,3}`, `vw-cs1-palette-v{1,2}`) and the S2-S6 capture sessions. The S2-S6 captures
are licence-held in `%LOCALAPPDATA%/uct-vendor-batch/runs/*/captures`; only their verdicts and the
hex values quoted below leave that store. The rule throughout: never draw a colour TradingView does not
draw; exact where a capture witnesses the rule, otherwise withheld BY NAME, never a made-up default.

## What changed

### C1: v1, v2 and no pragma draw the v3 (web) palette
`pinePalette.js`: `PALETTE_BY_VERSION[1] = [2] = V3` (the same frozen object) and `paletteFor(null)` reads
v1 (`NO_PRAGMA_VERSION`); only a version outside 1..6 keeps the v5 table (`UNMEASURED_FALLBACK`).
Witnessed for all 17 names at no pragma and v2 by `vw-cs1-palette-v{1,2}` (committed), and on every
named colour in the S2-S6 v1/v2 captures. Both lanes resolve names through this one table.

### C2: the v1-v3 default transparencies (one authority, the translator)
`pine.js::outputPresentation` + `legacyPlotDefault`:
- a v1-v3 (or unannotated) `plot` / `plotshape` / `plotchar` with no `transp` draws at 35 (alpha `a6`),
  on every colour form (named, a per-bar rule, no colour: the door supplies the `#2962FF` hue) and
  every style (S1: line, `columns`, `stepline` all 35);
- the 35 is a STYLE transparency and folds into an OPAQUE colour only (the vendor's own rule,
  `compare.mjs::withStyleTransparency`; witnessed at v3 by the S4 `accumulationdistribution-volume-adv`
  capture: `#65D25B66` under styleState 35 drawn at `66`): a colour with its own alpha keeps it, a
  mixed rule takes 35 on its opaque leaves only;
- `bgcolor` and `fill` (plot-plot) with no `transp` draw at 90 at v1-v3 too (S1); `hline` is opaque
  (S1: no transparency key); `barcolor` 0;
- an explicit `transp = N` is exact (v2 Bollinger `transp=0`: `#008080ff`); v4+ plots unchanged;
- a positional `transp` (index 5 of `plot` / `plotshape` / `plotchar` in v1-v4) is now read
  (`seriesPositionalSignature`); a `transp` that is not a literal is folded by the one alpha reader
  (`alphaNumberOf`) and, when it does not fold, the colour is withheld by name (`pine:colour-unread`);
- the door's own `version === 3` copy of the default (`memberPaneDefinition.js:144`) is deleted;
- the runtime lane's legacy test (`pineRuntimeFrontend.js::transpOf`) is the host's
  `isLegacyPineVersion` (it excluded `null`), and its per-bar colour door
  (`memberPaneDefinition::runtimeRowColour`) applies 35 to a v1-v3 row instead of withholding it,
  and a v1-v3 runtime `bgcolor` / `barcolor` takes 90 / 0.
- Still withheld by name (`pine:colour-default-unwitnessed`): a v1-v3 gradient (a v5+ form anyway).

### C3: an unread author colour is never drawn in the sheet gold
The chain was `colorDynamic -> rowColour -> $<key>Color -> chromeInputsFor` default `#c9a84c`. Now
(`memberPaneDefinition::pineRowPresentation`, one function for host rows and runtime static rows):
- a colour the translator cannot read (`colorDynamic`, `colorDynamicArity`, an unread `transp`) is
  withheld by name, `colorWithheld: {code: 'pine:colour-unread', reason}` on the row and the built plot,
  drawn in the chart's NEUTRAL INK (`WITHHELD_COLOUR_INK` = `chart.fg_color`, the chart's own text
  colour, resolved where it is drawn; coordinator ruling 2026-11-15, see "Review fixes"); its value
  column, legend value and data window stay; the member reads "colour not reproduced: <reason>" (no
  guard id) and can pick a colour in its settings;
- `plotarrow` (its `colorup` / `colordown` are not carried) and a candle role that names no colour are
  withheld by name too;
- a rule row's series colour (what a bar the rule gives no colour falls back to) is none, marked
  `colorWithheld.points`; hidden condition columns and anchor rows carry no colour;
- a palette / gradient marker picks each glyph by the per-point rule (`markerPrimitive.markersFor`
  `colourAt`), not the series colour.
Made exact:
- `color.new(<a rule>, T)` with `T` fixed before bar 0 sets every leaf's alpha to `1 - T/100`
  (`colourNewOverRule`; `volume-weighted-bands` `#5cf0d766`); a colour whose constant selectors fold
  is left to the ruling-1 pass, so every colour that pass carried keeps its shape;
- a bar-invariant rule needs no displacement (`displacedPresentation`; fikira-pivots, `offset=-ofs`);
- `chart.fg_color` / `chart.bg_color` (and `color.new` of one) on a plot is a theme reference
  (`chart.fg_color@85`) resolved against the chart in `pool.planBindings` (`withThemeColour`; an
  unanswerable theme draws no colour); the harness grades its hue theme-relative (the C37 rule) and
  its ALPHA byte exactly (`compare.mjs::alphaOnlyColour`).

### C4: one transparency reader
`colourTransparencyOf` (object lane) now asks `colourHelperTransparency` (plot lane) with its leaves on
(`paintLeaves`), so it opens a generic `input(<colour>)`: probe5's four forms all paint `#ff5d0080`.

### The harness
- `compare.mjs`: `COLOUR_WITHHELD_POINT`: a bar our side withheld by name is counted, not compared; a
  plot with any is INCONCLUSIVE with the code. A theme reference is compared on its alpha byte only.
- `ourSide.js`: a plot withheld whole reports `colors: null` with the name (INCONCLUSIVE; values are
  still graded), and is never theme-relative even though it draws in the theme ink.
- `paintColours.js` / `comparePaints`: a paint we withheld where TradingView paints no bar is
  "neither side draws" (undrawn), the rule `notDrawn` already follows.

## Review fixes (2026-11-15: the independent review of #1330 at `1bf2c63760`, and S11)

Each item has a rail in `app/src/components/chart/engine/__tests__/engine58Review.test.jsx` (the server
half in `tests/test_definition_colour_trust.py`), and each rail was mutation-proved: one mutant per rail,
applied to a saved copy, run, restored from the copy and checked byte-identical (sha256). Results:
both controls green (vitest, pytest); 26 mutants (R1a-R1d, R2a-R2c, R3a-R3d, R4a-R4c, R5, R5b, R6, R7a-R7c, A1-A3, B, C, D), every one red, every file restored byte-identical. Two further mutants (the `var` seed in `colourConditional` and in `settledColourNode`) changed no answer: those two branches were dead given the one-colour seed rule and were removed rather than kept unproven (see A below). Runner: `mutate_review.py` (scratch, ENG58-ONLY).

1. **(HIGH) Theme references are presentation colours.** `PRESENTATION_COLOUR` gains
   `chart.(fg|bg)_color(@N)` on both sides (byte-equal sources, `test_the_grammar_is_the_browser_s`), so a
   document with a theme plot passes `definition_colour_errors` and saves; before, it was refused (422) and
   an upgraded saved script looped on "Updated accuracy available". `safeCssColour(s, theme)` resolves a
   reference against the chart (`objectTheme.resolveThemeColour`), never writes one raw; the legend chips get
   the chart theme (`StockChart` `readoutChipOpts.theme`). A settings swatch has no chart theme to hand and
   shows its default for a reference.
2. **(HIGH/MED) Legend text is never invisible.** The chip and legend row write their text ink through
   `inkCssColour`: a colour that draws nothing (`#00000000`, a withheld rule row's series colour) gives the
   legend's own readable ink (`legendInk.js`). (The rule's per-bar colour is not used for the chip.)
3. **(MEDIUM) `transp =` folds into an opaque colour only.** One rule for a series output's style
   transparency, the v1-v3 default and an explicit `transp` alike (`pine.js::foldStyleTransparency`): an
   own-alpha colour keeps its alpha (`plot(x, "T", #FF000080, 1, plot.style_line, 70)` draws `80`), an
   opaque one takes it (`color.new(c, 0)` is opaque), a rule takes it on its opaque leaves, a theme
   reference as its own `@N`, a gradient only with opaque ends (else withheld by name).
4. **(MEDIUM, coordinator ruling) No `//@version` and v4+ syntax is refused by name.** TradingView compiles
   a no-pragma script as v1, which has no `ta.*`, `color.*`, `input.*`, `indicator()` or `var`; the member
   door refuses such a script (`pine:version-missing`, "This script has no `//@version` header but uses newer
   Pine syntax (...); add the header TradingView expects (e.g. `//@version=5`)"), on both lanes, before
   either is tried. No version is guessed. `isPreV4PineVersion` is strict (`undefined` throws, `null` is v1).
   The unannotated palette pin now uses v1 forms (`study`, bare `red`).
5. **(Coordinator ruling, owner delegation) Whole-withheld colours draw in the neutral ink**, named, as
   above; the harness grades the colour INCONCLUSIVE and still grades the values. A rule row's bars where
   the rule gives no colour still draw nothing (Pine's `na`).
6. **(LOW)** Theme references graded on their alpha byte (above). Withheld-bar counts: published here after the harness re-run at the rebase (the per-plot `colorWithheld` bar count, both lanes).
7. **(LOW)** A `transp` (or the `T` of `color.new(<rule>, T)` / `color.new(chart.fg_color, T)`) that reads
   an input is withheld by name instead of baked at the input's default (`alphaReadsInput`); literal
   arithmetic still folds.
8. **(LOW)** The engine-58 history line is rewritten to what 58 now does.

S11 (root-cause investigation 2026-11-15):
- **A.** A never-reassigned `var` whose seed is one colour whatever the bar IS that colour in the plot and
  paint lanes (`neverReassignedVarSeed`, the one predicate the object lane's C37 read also uses, in
  `staticColourOf` and the transparency reader; the branches asked for in `colourConditional` and
  `settledColourNode` were mutation-dead and removed): money-flow-index's
  `bgcolor`, inside-bar-setup's `barcolor`s. A `:=` anywhere, or a seed that reads the bar, stays withheld.
- **B.** A paint's `show_last` folds as its `offset` does (`input.int(377)`, `3 * len` = 600).
- **C.** The harness change above (dot-dynamics).
- **D.** The theme reference rides on `plotshape` / `plotchar` too (market-trend-levels' Signal).

The "Measured" numbers below are from before these fixes; the harness and census are re-run at the rebase
(onto engines 55 and 56; this branch now merges before 57), with the engine number moved to master+1.

## Measured (2026-11-15, after merging `origin/master`; re-run after the disk-full period)

Before = this branch's engine files swapped back to `origin/master`; after = this branch. Same harness
(`vendorHarness.corpus.test.js`, `--maxWorkers=1`, under the heavy lock), same captures, both lanes
(`VENDOR_HARNESS_RUNTIME_ON` 0 = host translator, 1 = runtime). Verdicts are per capture file.

| Set | Lane | Before (MATCH / DIVERGE / INCONCLUSIVE) | After | Colour-only DIVERGE captures |
|---|---|---|---|---|
| committed fixtures (466) | 0 | 159 / 61 / 246 | 159 / 57 / 250 | 6 -> 0 |
| committed fixtures (466) | 1 | 190 / 62 / 214 | 190 / 56 / 220 | 6 -> 0 |
| licence-held S1-S6 + probes (275) | 0 | 140 / 90 / 45 | 176 / 43 / 56 | 45 -> 0 |
| licence-held S1-S6 + probes (275) | 1 | 155 / 96 / 24 | 192 / 48 / 35 | 46 -> 0 |

- Every move is out of DIVERGE: no capture went MATCH -> anything, and none went to DIVERGE.
- Held set: 36 (lane 0) / 37 (lane 1) captures DIVERGE -> MATCH, 11 DIVERGE -> INCONCLUSIVE (withheld by
  name). By plot: 204 / 207 DIVERGE -> MATCH, 5 DIVERGE -> INCONCLUSIVE.
- Fixtures: 4 (lane 0) / 6 (lane 1) captures DIVERGE -> INCONCLUSIVE, all of them colour-only before
  (`vw-cs1-transp-v{1,2,3}`, `smart-money-volume-index-algoalpha`, and on the runtime lane
  `vw-rt6-runtime-colour-{rddt,spy}`). By plot: 9 DIVERGE -> MATCH, 13 DIVERGE -> INCONCLUSIVE.
- Host parity: `pine_runtime_host_parity.mjs --write` regenerated for identity 58 (every digest moves
  with the identity); `--check` HP-1 GREEN, 166/166.
- Reproducibility: a first full run (2026-11-14, before the merge; 381 fixtures) gave the same moves and the
  same colour-only counts. The one difference is `accumulationdistribution-volume-adv`, INCONCLUSIVE then and
  MATCH now on both held lanes (the opaque-only fold of the 35, `e81e0eb794`, landed between the runs).

### Census: every source through the member door
1,892 sources (679 corpus and built-in samples, 1,213 captured scripts), each built by
`memberPaneDefinition` before and after; 872 build a pane (297 samples, 575 captures), the rest are
refused at the door identically both sides (no source changed door status or lane). Per door plot
(5,706), with "visible" meaning a plot the member sees:

| Before -> after | Visible | Hidden |
|---|---|---|
| unchanged | 2,735 | 661 |
| colour or alpha changed (mostly the v1-v3 palette and the 35 default) | 357 | 33 |
| gold -> exact (a rule read per point, a theme reference) | 55 | 0 |
| gold -> withheld by name (`pine:colour-unread`) | 48 | 112 |
| a rule's gold series colour -> none (each bar still coloured by the rule) | 661 | 97 |
| gold -> none (hidden condition column, anchor row) | 0 | 947 |

The sheet gold `#c9a84c` appears 1,920 times in the before census and **0 times** after.
The first census (2026-11-14, before the merge and before `e81e0eb794`) still had 112 hidden rows
drawn gold (anchor rows); `e81e0eb794` gives anchor rows no colour, which is the larger "gold -> none"
count here. The corpus also grew between runs (new `s11` / `s12` capture sessions).

## Honesty flags
- **The member sees a line drawn in no colour** where the colour is unread (160 door plots in the census
  sources went gold -> withheld, 48 of them visible) and, outside the census, the owner's `uncharted-volume-v2`
  Volume histogram (`vcolornew`, reassigned in an `if`). Before, it was drawn in the gold no script
  chose. R-G ("keep the line") is honoured for the value, not the colour.
- `bbtrend` (S5) flips DIVERGE -> INCONCLUSIVE, not MATCH: its colour is a `switch` value, which the
  colour reader does not open yet.
- `ytc-swing-highs-lows` (S4-3): its colour now agrees; it stays DIVERGE on one VALUE bar (bar 46,
  `Swing High` vendor 1 vs ours `na`), with and without `max_bars_back`. Not a colour.
- The runtime lane's v1-v3 per-bar plot colour (35) is served by `runtimeRowColour`; no capture in the
  graded sets reaches that path, so it is railed only through the shared translator rule.
- v1 here means "no pragma": the S1 v1 probes are unannotated.

## Open notes
- Engines 55, 56, 57 merge first. Host parity is regenerated for 58 on today's master (`bac95ecd70`);
  after they land: rebase, resolve the `scriptEngineVersion.js` history line, re-run
  `node tools/pine_runtime_host_parity.mjs --write` and `--check`.

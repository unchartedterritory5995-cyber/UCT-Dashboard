# UCT Relative Strength — Phase 1 visual review

Branch `feat/uct-rs-phase1`, captures from HEAD f684c400b0 (capture_report.json; the task brief said a21d598a74). Desktop 1440x900 and phone 390x844 at 2x, OLED and light app themes. Three reviewer roles (creative director, UX researcher, data-visualisation engineer), each finding voted by three skeptics (pixel check, spec check, sandbox check). Duplicates across roles are merged below; the vote tallies are the union.

Capture folder: `C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/`
Measurement crops and script: `.../scratchpad/rs/review/` (measure.py, crop_*.png) and `.../scratchpad/rs/skeptic/zoom_desk.png`.

## 1. Verdict

First turn-on matches plan section 6.2 in substance but not in the legend: the pane sits under Volume at the declared 0.18 share (87 px at 900 px tall), the line is info blue, the MA is dashed neutral, the new-high dots ride the line, nothing in the pane reads as gain/loss or buy/sell, and the only visible plan deviations are the chip (reads `UCT Relative Strength 0.2477`, never `UCT RS · SPY`, so the benchmark is not on the chart) and the still-visible RS axis numbers (a documented section 20 deferral, but the axis tag rounds to 0.25 while the legend says 0.2477). On brand: yes for everything RS owns (palette, typography, voice, gold rationing could not be exercised because no before-price high fired in the window); the one off-brand pixel is pre-existing library chrome (a green check marking the added row) and the settings inspector cuts seven RS labels to an ellipsis, which contradicts the build record's "labels fit the inspector column". Phone: the pane renders, the line and dot are legible, and the overlays in the captures are admin-only hub chrome a member will not see, but at rest the pane has no name, no benchmark and no collapsed chip (a platform-wide phone-shell convention, not an RS regression), so "name the benchmark" fails on both surfaces until the legend fix lands and the phone question is answered at platform level.

## 2. Confirmed findings, ranked, by surface

Severity after skeptic votes. "Keep" means the finding survives at the stated severity; "lowered" means the skeptics agreed the condition is real but is a documented deferral or platform behaviour.

### 2.1 Legend (desktop pane readout)

#### L1. Benchmark absent from the pane legend — MAJOR (keep 6, lower/refute 3; three roles raised it)

Images:
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_desktop_oled_widget.png)
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_desktop_light_widget.png)
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_desktop_oled_reload.png)
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_desktop_oled_settings.png)

Observed: the pane row reads `| UCT Relative Strength 0.2477`. The string `SPY` appears nowhere on the canvas in any desktop frame; it is printed only inside Chart Settings (group header `UCT RS (SPY)`, Benchmark dropdown `S&P 500 (SPY)`). One indicator carries three spellings across surfaces (`UCT Relative Strength`, `UCT RS (SPY)`, `UCT RS` in the phone toast). Cause: `paneReadoutLabel` (engine/readout.js ~1028-1053) replaces the primary plot's chip label with `def.meta.name` and re-attaches only `chip.suffix`/`frameSuffix`, so `legendParams: ['benchmark']` (nativeRegistry.js ~3826) never reaches the pane; `chipLabel` (~236-300) would print `UCT RS(SPY)`.

Expected: plan 6.2(3) and 6.6, one-line chip `UCT RS · SPY`; platform 7 `shortName + params`.

Why it stays major despite the section 20 deferral: section 20 says "today `UCT RS(SPY)` plus the raw ratio" and defers only the dot-vs-parentheses grammar. The pixels show the benchmark is absent, not mis-punctuated, so the deferral was accepted on an inaccurate description. With the Benchmark dropdown live in Phase 1 (SPY / QQQ / sector), a member who changes it has nothing on the chart saying what the line is measured against. The pane-prints-long-name rule is an owner ruling (StockChart.jsx ~7040, pinned by readout.test.js:176 for RSI), so the fix must be an opt-in, not a change to every pane.

Fix: keep the long name and append the resolved benchmark for definitions that opt in (`UCT Relative Strength · SPY`), by stamping `chip.suffix` with the resolved ticker for RS (the 2a-09 design) or a `meta.paneLabelParams` flag that `paneReadoutLabel` honours; resolve the enum to its ticker, not the option label. Pin with a legend test on rsLine. Correct section 20 to say the benchmark is absent from the pane row today.

Likely files: `app/src/components/chart/engine/readout.js` (paneReadoutLabel; chipsFrom for the suffix stamp), `engine/readout.test.js`, one meta line in `engine/nativeRegistry.js` RS_LINE_RAW.

#### L2. Pane legend panel paints over the newest RS new-high dot — MINOR (keep 1, lower 2)

Images:
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_desktop_oled_reload.png)
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_desktop_oled_widget.png)

Observed (pixel-verified by two skeptics): `.paneLegend` (rgba(14,15,13,0.78), about 183x24 px, 28 % of the 87-px pane) covers x 252-427, y 628-651; the May 14 new-high dot at (272,651) shows only its lower rows, and the gridline at y=631 is dimmed from (23,23,23) to (16,16,16) under the box. Because an RS new high is by definition at the top of the autoscaled range, any dot in the leftmost ~27 bars of a window lands under the strip.

Expected: plan 6.7 "every one kept" and visible. Lowered because the strip is the platform's shared oscillator legend (same for RSI/MACD/Volume), the owner compacted it to one line on 2026-09-30 rather than moving it, placement.js PANE_BAND (top 0.16, ~14 px) documents the series passing under the label, and the capture window happened to start exactly at lastRsHigh.

Fix (platform polish, 2a): match PANE_BAND to the measured ~24 px legend height, or drop the fill on own-pane strips. Not in this branch's fix plan; recorded for the 2a map.

Likely files: `app/src/components/StockChart.module.css` (.paneLegend), `engine/placement.js` (PANE_BAND).

#### L3. Legend label wears the series colour — NOTE, leave as is (keep 2, refute 1)

Image:
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_desktop_oled_widget.png)

`UCT Relative Strength` is painted in the RS blue as `Volume` is green and `EMA 9` green; values are bright neutral. Platform 7 says "text never wears series color", but LegendRow.jsx records the owner restoring exactly this on 2026-09-14 ("a key printed in one colour names nothing"). RS is consistent with every neighbour. No fix; the plan should stop citing platform 7 as the chip colour rule.

### 2.2 Desktop chart (RS pane)

#### D1. RS axis numbers shown, and the axis/tag precision disagrees with the legend — MINOR, one line actionable now (keep 4, lower/refute 5 across three copies)

Images:
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_desktop_oled_widget.png)
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_desktop_light_widget.png)
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_phone_oled.png)

Observed: right axis 0.35 / 0.30 / 0.25 and a muted-blue last-value tag `0.25` while the legend reads `0.2477`. The rsLine/rsMa plots declare `legend: { decimals: 4 }` but no `precision`, so pool.js `precisionFor` falls to DEFAULT_PRICE_PRECISION = 2; every other pool plot pairs the two. The tag will read `0.25` for weeks while the ratio moves 0.24-0.26. Tag colour is fine (desaturated info blue).

Expected: D6 / plan 6.2(3), axis hidden, values in the crosshair. Hiding the axis is a documented section 20 deferral (schema field), so that half is not a Phase 1 defect. The precision mismatch is not covered by the deferral and breaks the platform's "one formatting pipeline" rule.

Fix now: `precision: 4` on rsLine and rsMa; `lastValueVisible: false` on rsLine (pool.js ~665 already honours it). Fix in 2a: `placement.pane.axis: 'hidden'` mapped to `priceScale().applyOptions({ visible: false })` in binder.js.

Likely files: `engine/nativeRegistry.js` RS_LINE_RAW plots (now); `engine/defSchema.js`, `engine/binder.js` (2a).

#### D2. Dashed 21-EMA renders faint on the dark canvas — MINOR (keep 3, lower 2, refute 1; two copies)

Images:
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_desktop_oled_reload.png)
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_phone_oled.png)

Observed (measured twice, matching to the pixel): in the honest reload frame roughly three quarters of the MA's ink sits below 2.2:1 against (15,15,15); the full #8a8574 (5.2:1) reaches the screen on 8 % of its pixels. Cause: `lineStyle: 'dashed'` is LWC [2w, 2w], so at width 1 each 2-px dash anti-aliases to partial coverage on a slope. The token is inside the OKLCH band; the rendering, not the colour, is the issue. Clearly readable on the phone at 2x; faint on desktop at 1x. In the Classic preset the MA is the only on-chart cue for above/below average, since both line colours default to the same blue.

Expected: plan 6.2, a dashed neutral MA the member reads the line against. No document sets a contrast floor for context lines, hence minor.

Fix: `lineStyle: 'largeDashed'` ([6w, 6w]) on the rsMa plot, keep width 1 and the dashed style so it never competes with the RS line; resolve the `maColor` default from the active preset's `ind.neutral` instead of the hard-coded #8a8574 (owner question whether to go one step lighter on OLED).

Likely file: `engine/nativeRegistry.js` RS_LINE_RAW rsMa plot and maColor input.

#### D3. Small and large dots are the same 9-px circle at every daily zoom up to 12 px/bar — MINOR in pixels, real in code (keep 1, lower 2)

Images:
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_desktop_oled_reload.png)
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_phone_oled.png)
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_phone_light.png)

Observed: the size-0.6 dot measures 9 px (radius 4) on desktop at 6.6 px/bar and 9 CSS px on the phone at 2.2 px/bar; two consecutive NH days overlap into a figure-8 on desktop and one blob on the phone. Library maths (lightweight-charts 5.2.0 series-markers, verified in node_modules by two skeptics): shapeHeight = 10 for barSpacing <= 12, times marker.size gives 6 / 12, and drawCircle re-clamps to [12,30] x 0.8 = 9 px for both 0.6 and 1.2. The large gold dot separates from the small blue one only above ~13 px/bar. `presentation.dotSize` acts on `markers`-style point plots, not these `plots[].marker` glyphs, so the plan's density lever is a no-op here. No before-price high fired in the window (dotNHbeforePx = 0), so the identity is not visible in any frame; that is why the severity drops.

Expected: plan 6.7 "intensity by size and colour", small info / large premium.

Fix: `marker.size: 2` (or larger) on dotNHbeforePx so the gold dot is at least 1.6x the blue at daily zoom; add a test that renders both at barSpacing 6 and asserts large > small; make the server's dotNH exclusive of before-price bars or pin the plot order (gold after blue). Whether the 9-px small-dot floor is acceptable is an owner call (section 4).

Likely files: `engine/nativeRegistry.js` RS_LINE_RAW dot plots; a new test beside `engine/markerPrimitive.js`; server rs lane (dotNH column) if the exclusivity route is taken.

### 2.3 Phone chart

#### P1. The RS pane has no name, no benchmark and no collapsed chip at rest — MINOR, platform-level (keep 2, lower 2, refute 2; two copies)

Images:
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_phone_oled_reload.png)
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_phone_light_reload.png)
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_phone_oled.png)

Observed: after the `UCT RS added · Undo` toast clears, nothing on the phone identifies the pane (DOM probe legend_texts [] after reload). The price pane is likewise legend-less, so a member has no cue that a touch summons a chip. Cause: MobileChartsApp.jsx ~455-460 sets `verticalLegend:false, alwaysShowLegend:false` (Phase 10 "clean canvas", pinned by MobileChartsApp.landing.test.jsx), and StockChart.jsx ~20666 renders pane readouts only under `crosshairData`. RSI and MACD are equally unlabelled at rest; the dot-collapse CSS does exist (IndicatorChip.module.css ~299-340) but the strip is crosshair-only on this shell, so the plan's "chips collapse to dots as the platform does" is true of the chip but not of its visibility.

Expected: plan 6.6 / 6.9 defer to the platform; the platform's owner decision is inspection-only. The plan's own 12.2 gate ("name the benchmark" on phones) cannot pass from the chart as shipped.

Fix: a shell-wide decision, not RS code: either a resting 10px/600 pane title row on own-pane indicators (`paneNamesAlways` from the phone shell, price legend untouched) or accept inspection-only and say so in the plan and the gate script. Owner question (section 4). Record in the 2a map with these captures.

Likely files (if the owner says yes): `app/src/pages/charts/mobile/MobileChartsApp.jsx` (stockChartProps), `app/src/components/StockChart.jsx` (paneLegend render ~20680).

### 2.4 Settings dialog (Chart Settings > Indicators inspector)

#### S1. Seven of thirteen RS labels truncate to an ellipsis, and the units are the part cut — MAJOR (keep 9 of 9; three roles)

Image:
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_desktop_oled_settings.png)

Observed: `Average length …` (21), `RS high before …`, `New-high lookb…` (252), `Price-high toler…` (2), `Short-history d…`, `Line above aver…`, `Line below aver…`. `.insFieldLabel` is `flex: 0 0 92px; 11.5px; nowrap; ellipsis` (ChartSettingsModal.module.css:1661; 84 px under the narrow query at :2594) and holds ~14-16 characters; RS declares the longest input labels in the registry (nativeRegistry.js ~3867-3887, 20-24 characters). `(bars)` and `(%)` never render, so "find the lookback" presents two unlabelled numeric rows, 21 and 252. Hover does not help: ChartSettingsIndicators.jsx:2211 sets `title` only when the field is disabled, so the registry's tooltip text never reaches the inspector. `data-measure='wide'` widens the control cell, not the label column, so that route is out.

Expected: plan 6.3 "lookbacks are declared in bars and say so"; build record section 20 "labels carry units and fit the inspector column". Both visibly contradicted. RS-specific (7 of the 10 labels over 16 characters in the registry are RS).

Fix: shorten the labels to fit 92 px while keeping the unit and the long form in the tooltip: `Average (bars)`, `High before price`, `Lookback (bars)`, `Tolerance (%)`, `Short-history dots`, `Line above avg`, `Line below avg`, `Average colour`. Wire `f.tooltip` onto the label span as `title`. Add a test that measures RS_LINE_RAW labels at the inspector width (or caps label length) and fails on overflow. Re-check the phone editor (MobileIndicatorSheet) with the same labels.

Likely files: `engine/nativeRegistry.js` RS_LINE_RAW inputs; `app/src/components/chart/ChartSettingsIndicators.jsx` (~2206-2213); a label-length test.

#### S2. No preset picker and no Simple/Line/New-highs grouping on the gear door — MINOR, documented deferral (lower 2, refute 1)

Image: as S1.

Observed: the instance renders as a flat CORE list of ten inputs plus APPEARANCE swatches; no Classic / Classic weekly / Phase picker, no collapsed groups. Only IndicatorSettingsDialog.jsx reads `meta.presets` and `meta.groupsCollapsed`; ChartSettingsIndicators.jsx reads neither. On the desktop workspace the gear door is the only door (StockChart.jsx ~5710/5791 route the chip gear to onOpenSettings), so the Phase 1 DoD line "preset picker" is satisfied by a dialog desktop members never open.

Expected: section 20 explicitly defers "the preset picker on the Chart Settings Indicators surface and the phone sheet" to 2a. Recorded so the owner sees plainly that the main door ships without the presets the plan sells.

Fix (2a): render the generic picker and honour groupsCollapsed inside ChartSettingsIndicators' Core section from the same meta (one writer, setInstanceInput). Not in this branch's fix plan.

Likely file: `app/src/components/chart/ChartSettingsIndicators.jsx` (Core ~2440, Appearance ~2460).

#### S3. Two identical blue swatches on consecutive truncated rows read as a duplicated control — MINOR (keep 2, refute 1)

Image: as S1.

Observed: `Line above aver…` and `Line below aver…` both #6ba3be, then `Average colour`. Identical defaults are plan decision 9 (Classic is one static blue; bull/bear is the Phase preset), and two inputs is the documented platform amendment, so no violation; what remains is that without the preset picker on this door (S2) nothing hints why there are two. Mostly resolved by S1's shorter labels (`Line above avg` / `Line below avg` say what differs). Pairing on one `.insPair` row under `Line colour` is a taste call for the owner; no unit in the fix plan.

### 2.5 Phone sheet (Indicator library)

#### Q1. The added row is marked with a green check — MINOR, pre-existing library chrome (keep 3)

Images:
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_phone_oled_sheet.png)
![](C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/6e4e6fd4-6e10-45a7-909f-160ba3d0bb17/scratchpad/rs/visual/rs_phone_light_sheet.png)

Observed: `.check { color: var(--gain) }` (IndicatorLibraryDialog.module.css:185-191), byte-identical on origin/master; the RS branch does not touch the file. Everything else on the row is on brand (neutral `UCT RS` chip, gold-tinted Premium badge, declarative description, `+ Add another` as the only verb).

Expected: brand 1 / 22 "don't use green for active UI states; use gold or a muted gold tint; green is reserved for gains". The guide also lists green-bright for "sidebar active", so it is internally loose here; section 22's explicit anti-pattern is the stated rule.

Fix: `.check` to `var(--text-bright)` (safer than gold, which brand 1 says not to spend on every selected state); keep the glyph. Separate, one-file unit; owner may prefer to leave it.

Likely file: `app/src/components/chart/IndicatorLibraryDialog.module.css` (lines 185-191).

## 3. Fix plan

Small units, grouped by file so parallel agents do not touch the same file. The code review runs on the same branch and will most likely touch `engine/nativeRegistry.js` (RS_LINE_RAW) and the server rs lane; unit 1 therefore runs after the code-review fixes to that block are merged (or by the same agent), and no other unit edits nativeRegistry.js. Units 2-5 have no file in common with each other or with unit 1.

1. `engine/nativeRegistry.js` RS_LINE_RAW only (one agent, after the code-review fixes to the same block): (a) shorten the seven input labels per S1, long form kept in `tooltip`; (b) `precision: 4` on rsLine and rsMa, `lastValueVisible: false` on rsLine (D1); (c) rsMa `lineStyle: 'largeDashed'`, `maColor` default resolved from the preset's `ind.neutral` (D2); (d) `marker.size: 2` on dotNHbeforePx (D3); (e) the one meta line unit 2 keys on (e.g. `meta.paneLabelParams: true`, or whatever unit 2 names). Update the existing RS registry tests and add a label-length test for S1. Server-side dotNH exclusivity (D3) stays with the code review, which owns the lane.
2. `engine/readout.js` + `engine/readout.test.js` (L1): `paneReadoutLabel` appends the resolved `legendParams` (ticker, not option label) after the long name for definitions carrying the unit-1 flag, or `chipsFrom` stamps `chip.suffix` with the resolved benchmark for those definitions. RSI pane-label test at :176 must stay green. New test: rsLine pane row reads `UCT Relative Strength · SPY`, and `· QQQ` after a benchmark change.
3. `app/src/components/chart/ChartSettingsIndicators.jsx` (S1 tooltip half): put `f.tooltip` on the label span as `title` for regular input rows (~2206-2213). One-line change plus a test asserting the title is present.
4. `app/src/components/chart/IndicatorLibraryDialog.module.css` (Q1): `.check` colour to `var(--text-bright)`. Owner-gated; ship only on a yes.
5. `engine/markerPrimitive` test (D3 evidence): new test file rendering size-0.6 and size-2 circles at barSpacing 6 and asserting the large radius exceeds the small. Lives beside unit 1's data but in a new file, so it can be written in parallel; it will fail until unit 1(d) lands, which is the point.
6. Plan repo `C:/Users/pgosz/projects/uct-rs-plan/.../2026-11-05-uct-relative-strength-indicator-design.md` section 20 (separate repo, no conflict): replace "today `UCT RS(SPY)` plus the raw ratio" with "today the pane row prints `UCT Relative Strength` plus the raw ratio and no benchmark"; replace "labels carry units and fit the inspector column" with the unit-1 labels; stop citing platform 7 as the chip colour rule (L3). Add to the 2a owner list: phone resting pane title (P1), PANE_BAND vs legend height (L2), 9-px small-dot floor and dotSize no-op (D3), axis-hidden schema field (D1), preset picker on the gear door (S2).
7. Capture harness (`scratchpad/rs/visual` scripts, not product code): wait ~300 ms for the Chart Settings backdrop to leave the DOM before the widget screenshot (the non-reload frames are at ~62 % alpha); add a capture with a symbol that has a recent before-price high so the gold dot and HVC bars can be judged; capture the post-add Studies list on the phone; run the phone pass with a non-admin account so the hub chrome is absent.

Not in the fix plan (2a or owner): L2 pane legend fill / PANE_BAND, P1 phone pane title, S2 picker on the gear door, D1 axis-hidden schema field, S3 swatch pairing.

## 4. Owner questions (need a human eye)

1. Dot sizes. With unit 1(d) the gold before-price dot is 15 px against a 9-px blue dot at daily zoom (6.6 px/bar). Is 15 px right, or should it be 13 (size 1.6 rounds the same way; the next step down is 9)? And is the 9-px floor on the small dot acceptable when consecutive NH days overlap into a caterpillar on a 200-bar window, or should the small dots move to the `markers`-style point path (radius 1.5-2.5, truly small, but a different renderer)? Needs a capture of a symbol with a recent before-price high; none fired for NVDA in this window.
2. Gold dot beside gold HVC volume bars. Unverified in pixels (no HVC bars and no gold dot in view). The one-gold-element rule says the dot and the bars should not both shout; if they coincide on a breakout day, which one yields? Same capture as question 1.
3. Pane height. The declared 0.18 resolves to 87 px at 1440x900 (18 % of the candle+RS frame, 15.9 % of the full stack). The plan's "18 % height" reads as 18 % of the chart (98 px). The 87-px pane holds the line and a 24-px legend with the dots tucked under it (L2). Is 0.18 of the candle frame the number, or should RS declare 0.20?
4. Phone resting pane title (P1). Platform-wide: do own-pane indicators get a 10px/600 resting title on the phone shell, or does inspection-only stand and the 12.2 phone gate script changes to "touch the pane, then name the benchmark"?
5. Green check (Q1). Change to text-bright, change to gold, or leave the library chrome alone until a library pass.
6. MA weight (D2). largeDashed at width 1 is the proposed fix; the alternative is one lightness step up for `ind.neutral` lines on OLED only. Pick one after seeing both on the chart; largeDashed alone is the conservative default.
7. Swatch pairing (S3). After the shorter labels land, do `Line above avg` / `Line below avg` want to sit on one row under `Line colour`, or stay as two rows like every other definition.
8. Hub rollout pre-condition. Not RS, but the phone captures show what every member will see once the joystick hub reaches stage 2: the orb, pill and FABs cover the right axis and newest bars of whichever pane is lowest. The hub PR needs a bottom inset on the phone chart column (or to hide on the portrait chart as FloatingOrb does) before it ships to members.

## 5. Dropped findings

- "Phone: RS pane buried under the chart shell's controls (critical)" — the orb, pill, sliders/chat FABs and coach mark are the admin-only joystick hub (ROLLOUT_STAGE = 1; the capture account is admin) plus transient toasts; a member sees a clear pane; the residual Compass orb clip is pre-existing for Volume and section 20 already defers the phone-pane-under-controls item to 2a. Kept as owner question 8.
- "Phone: pane under coach toast, timeframe pill, both FABs and orb (critical)" — same evidence, same disposition; two of the five overlays are first-run state on a fresh sandbox account.
- "Point to the last RS high: a small line-coloured dot at the far left, no text (major)" — the dot is ~10x the line width, two dots are present, same-hue small info circle is what plan 3 / 6.7 / D9 specify, and "N bars ago" is the 2a Leadership readout; the left-edge position is NVDA's data (121 bars back).
- "Phone library row on-state is a lone green tick and + Add another (minor)" — checkmark add-flow is the platform 6 contract copied from TradingView; `.rowOn` styling, aria-pressed, the toast and the fx badge all confirm the add; Remove and Settings live in the chip sheet by design; the missed first tap is a harness settling issue.
- "Phone: no legend, axis and tag under the knob, last bars under the fx orb (major)" — admin hub chrome again; D6 wants the axis hidden anyway; alwaysShowLegend:false is the shell's documented policy (survives only as P1).
- "RS line at lineWidth 1 is a soft stroke; IBD draws it bolder (minor)" — plan 6.3 documents `lineWidth` default 1, range 1-4, same as every other line definition; a bolder default is a plan amendment, not a defect.

## 6. Sandbox artefacts to ignore

- 503 on /api/live-prices, /api/stream/bars and intraday/monthly /api/bars; 404 on /api/econ/catalog and /api/fundamentals/pit/catalog (no vendor keys). None touch the RS pane.
- Theme widget copy ("Computing returns… ready in ~30s", "No theme data — run the morning wire engine") and the watchlist "0 stocks" tile: empty sandbox data.
- The non-reload desktop frames (rs_desktop_oled.png, rs_desktop_light.png, both *_widget.png) were taken while the Chart Settings backdrop was fading: every chart pixel is at ~62 % alpha, chart bg (10,10,10) vs (15,15,15), RS blue (70,107,125) vs the true #6ba3be. All contrast numbers in this review come from the *_reload.png frames. Harness fix in unit 7.
- The app light theme recolours only the shell; the chart canvas, toolbar and Chart Settings modal keep the dark chart theme (`charts_theme` is a separate preference). No light-canvas RS colours exist in these captures; Light-preset colour roles (deferred to 2a) could not be judged.
- Left NavBar expanded in the first desktop frames and collapsed in the settings/reload frames: capture-order chrome state.
- The Compass "New: speak instead of type…" nudge toast bottom-right on every desktop frame, and the phone joystick coach mark "Drag for shortcuts · hold to go home": first-run product chrome; the coach mark is washed out in the light theme (a separate shell ticket, not RS).
- The joystick hub (orb, "CHART tap: next timeframe" pill, sliders FAB) and the chat/report FAB on the phone: admin-only at ROLLOUT_STAGE 1; the capture account is admin.
- "UCT RS added · Undo ×" toast across the phone time axis: transient, auto-dismisses.
- Phone: the first synthetic tap on the library row did not register on two runs and the script re-tapped: bottom-sheet settling under Playwright; one real-device check before it is called a product issue.
- The mid-branch "setting lineColor no longer exists" refusal (unit 2 to unit 5 rename): dev-only migration artefact, not in these frames, though a real path for any future input rename on a member's saved chart.
- capture_report.json records worktree_head f684c400b0, not the a21d598a74 the task brief names; the frames are from the later head.
- Only state=ok was captured (benchmark SPY resolved, 852 bars, history.short=false, intraday=false). The 6.10 states (warm-up, same-symbol, SECTOR fallback, server unavailable, intraday NaN dots), the crosshair readout, the Phase preset colouring and IndicatorSettingsDialog's picker surface are unverified by any frame.

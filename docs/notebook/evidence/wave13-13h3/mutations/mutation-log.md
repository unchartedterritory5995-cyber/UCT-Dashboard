# Wave 13 lane 13H-3 — mutation proof

Target: `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx`'s Draw-mode
toolbar-clearance fix (the `drawClearance` measurement effect + `annotateEffectiveHeight`).
Test file: `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.drawClearance.test.jsx`
(5 cases).

Method: capture the file's bytes, apply ONE textual mutation, run the test file, record the
result, restore by writing back the captured bytes (never `git checkout --`), verify the
restored file's sha256 matches the pre-mutation capture before moving to the next mutation.
Baseline sha256 (both before the first mutation and after the last restore):
`7fd951f6bd5450a0de5defb4473e2d5477b79473f405c588afdbef835713ef02`.

## M1 — neutralize the fix (`effectiveHeight = height`, the clearance bump never applies)

```
const effectiveHeight = annotateEffectiveHeight(height, drawClearance)
                      ↓
const effectiveHeight = height // MUTATED M1
```

Result: **2 of 5 killed** (the other 3 do not exercise the bump at all and are correctly
unaffected):

```
 × a coarse pointer gets a taller body once Draw mode measures the floating toolbar
   AssertionError: expected '531px' not to be '531px'
 × exiting Draw mode drops the bump -- nothing here is persisted
   AssertionError: expected '531px' not to be '531px'
 Tests  2 failed | 3 passed (5)
```

## M2 — drop the coarse-pointer guard (`!isCoarsePointer` removed from the effect's gate)

```
if (!annotate || !isCoarsePointer || attrs.widgetId !== 'chart') { setDrawClearance(0); return }
                      ↓
if (!annotate || attrs.widgetId !== 'chart') { setDrawClearance(0); return } // MUTATED M2
```

Result: **1 of 5 killed** (exactly the test that proves a fine pointer is unaffected):

```
 × a fine pointer never gets the bump -- the SAME floating toolbar never trips it
   AssertionError: expected '1000px' to be '531px'
 Tests  1 failed | 4 passed (5)
```

## M3 — drop the toolbar-band filter (every aria-labeled button counts, not just the top-anchored ones)

```
if (r.top - bodyTop > TOOLBAR_BAND_PX) return // not the top-anchored toolbar
                      ↓
// MUTATED M3: if (r.top - bodyTop > TOOLBAR_BAND_PX) return
```

**First attempt used a loose bound (`toBeLessThan(BOTTOM_CHROME_OFFSET / 2)`) and did NOT
kill this mutation** — `EMBED_MAX_H`'s own clamp caps the runaway at 1400, which still
satisfies "less than 2500". That is the masked-mutation shape this repo's conventions warn
about (a guard that can be green alone and red in company): the clamp was doing the job the
band filter was supposed to be proven to do. The test was tightened to assert the EXACT
height the toolbar alone produces (`TOOLBAR_BOTTOM_OFFSET + ANNOTATE_DRAW_BUFFER_PX`), and
re-run:

```
 × a button far below the toolbar band never feeds the clearance (the measured feedback-loop class)
   AssertionError: expected 1400 to be 1000
 Tests  1 failed | 4 passed (5)
```

Killed, once the assertion was exact rather than a loose bound.

## Restore verification

After every mutation the file was restored by writing back the captured original bytes
(never `git checkout --`) and its sha256 was re-checked against the baseline before the next
mutation ran. The baseline, M1-restore, M2-restore and M3-restore shas were all
`7fd951f6bd5450a0de5defb4473e2d5477b79473f405c588afdbef835713ef02`. A final `grep -n
MUTATED` over the restored file returned no matches.

## Full suite, post-restore

```
npx vitest run \
  src/pages/journal-2-0/lib/widgetEmbedNode.test.js \
  src/pages/journal-2-0/lib/widgetEmbed.test.jsx \
  src/pages/journal-2-0/lib/widgetEmbedInsert.test.jsx \
  src/pages/journal-2-0/components/notebook/WidgetEmbedView.chartPlan.test.jsx \
  src/pages/journal-2-0/lib/widgetEmbedId.test.js \
  src/pages/journal-2-0/lib/widgetEmbedTemporal.test.js \
  src/pages/journal-2-0/components/notebook/ChartPlanPanel.test.jsx \
  src/pages/journal-2-0/components/notebook/SlashMenu.chartPlan.test.jsx \
  src/pages/journal-2-0/lib/widgetEmbedCore.drawClearance.test.js \
  src/pages/journal-2-0/components/notebook/WidgetEmbedView.drawClearance.test.jsx \
  --maxWorkers=1

Test Files  10 passed (10)
     Tests  142 passed (142)
```

(132 from 13H-2's original 8 files + 5 from `widgetEmbedCore.drawClearance.test.js` + 5 from
`WidgetEmbedView.drawClearance.test.jsx` = 142 — the 13H-2 quality bar's own 132 stayed green
throughout.)

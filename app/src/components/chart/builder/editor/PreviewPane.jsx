// app/src/components/chart/builder/editor/PreviewPane.jsx
//
// ─── THE DRAFT, DRAWN BY THE ENGINE THAT WILL DRAW IT ───────────────────────
//
// The universal `ChartPane` on the current symbol, holding ONE instance: the
// draft. Nothing here computes a column — the binder does, through the same
// registry lookup the saved definition will resolve through (`getDefinition`),
// which is why the draft is INSTALLED under a fixed id for as long as it
// evaluates and FORGOTTEN the moment it does not or the pane goes away.
// ⛔ Inert on a refusal, on a missing symbol, and on a registry refusal: the
// sheet already says why in the door's own words; this pane says nothing.
//
// ⛔⛔ `null` IS THE SAME OBSERVABLE FOR SEVERAL DIFFERENT REASONS, and that is
// the one thing about this file worth holding in mind while changing it. A pane
// broken outright — an import typo, a `return null` left at the top — would read
// as "correctly inert" from every negative test. So each reason is cut ONE AT A
// TIME on one fixture in `PreviewPane.test.jsx`'s `the reason it is inert,
// isolated`, and the ROSTER is written here rather than counted, because a count
// beside the list it describes is how this repo keeps shipping a false claim of
// coverage:
//   · NO DEFINITION      — the buffer refuses     → 'the DEFINITION is the reason'
//   · NO SYMBOL          — `sym` is null          → 'the SYMBOL is the reason'
//   · NO TIMEFRAME       — `tf` is null           → 'the TIMEFRAME is the reason'
//   · REGISTRY REFUSAL   — a document the install door refuses, AFTER a good one
//                          installed → 'the REGISTRY is the reason' (fix round 1;
//                          it was the one reason with no discriminator, and it
//                          was leaking the previous entry — see the effect below)
// If you add another reason to be inert, add its row here AND its discriminator
// there. A row without a case is a claim nobody ran.
//
// ⛔ THE REGISTRY ENTRY IS TRANSIENT AND ITS TEARDOWN IS NOT OPTIONAL. A leaked
// `PREVIEW_DEF_ID` rides `listUserDefinitions()` onto the member's REAL chart —
// the same list the settings row, the legend and the alert address read — so
// the uninstall is asserted against the LISTING, never against a spy.

import { useEffect, useMemo, useState } from 'react'
import ChartPane from '../../pane/ChartPane'
import * as engineRegistry from '../../engine/nativeRegistry'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { PREVIEW_DEF_ID } from './previewDefinition'
import styles from './CodeEditor.module.css'

const noop = () => {}
/** No streaming, no background warm: the member's real chart already does both for this symbol. */
const PREVIEW_CHART_PROPS = Object.freeze({ liveUpdates: false, backgroundWarm: false })

export default function PreviewPane({ sym = null, tf = null, settings = null, definition = null }) {
  const live = !!(sym && tf && definition)
  const [installed, setInstalled] = useState(null)

  useEffect(() => {
    if (!live) {
      engineRegistry.uninstallUserDefinition(PREVIEW_DEF_ID)
      setInstalled(null)
      return undefined
    }
    // ⭐ THE SHIPPED INSTALL DOOR, WHICH IS ALSO THE VALIDATION DOOR. A draft the
    // registry refuses (a budget blown, a lane this client cannot run) installs
    // nothing and the pane stays inert — it does NOT draw on a verdict nobody
    // re-measured, and it does not invent a second refusal sentence beside the
    // one the sheet is already showing.
    const { installed: got } = engineRegistry.installUserDefinitions([definition])
    if (got.length === 1) {
      setInstalled(got[0])
      return undefined
    }
    // ⛔⛔ FIX ROUND 1 — A REFUSAL MUST TAKE THE PREVIOUS ENTRY WITH IT, AND THIS
    // IS NOT A HYPOTHETICAL. `installUserDefinitions` drops a refused document
    // BEFORE the loop that writes `_userById`, so it never touches the entry a
    // GOOD draft installed a keystroke earlier. Without this line `live` is
    // still true (the sheet handed us a document, it was simply refused), the
    // `!live` uninstall above is skipped, the unmount cleanup has not run — and
    // the STALE definition rides `listUserDefinitions()` onto the member's real
    // chart, which is the exact leak this file's header forbids.
    //
    // ⭐ MEASURED, not reasoned about (2026-08-27, through the SHEET): declare a
    // member input `period`, type `sma(close, 20) + period`, then RENAME that
    // input to `zzz`. `result` still carries the mode the linter measured under
    // the OLD scope while the document now declares the NEW inputs, so
    // `validateAstLane` re-lints, measures `repaints` against a declared
    // `non-repainting`, and refuses. Before this line
    // `listUserDefinitions()` answered `['u_editor-preview']` holding
    // `sma(close, 20) + period` — a definition naming an input the member no
    // longer has. `PreviewPane.test.jsx`'s fourth discriminator is that
    // sequence.
    engineRegistry.uninstallUserDefinition(PREVIEW_DEF_ID)
    setInstalled(null)
    return undefined
  }, [live, definition])

  // ⛔ A SEPARATE, EMPTY-DEP EFFECT. Putting the uninstall in the cleanup of the
  // effect above would fire it on EVERY keystroke that changes `definition` —
  // uninstall-then-reinstall bumps `_generation` twice per character and rebuilds
  // every registry-keyed memo on the chart path each time. This one runs once, on
  // the way out.
  useEffect(() => () => { engineRegistry.uninstallUserDefinition(PREVIEW_DEF_ID) }, [])

  // ⛔ THE MEMBER'S OWN CANVAS, WITH EVERY INSTANCE REMOVED — the draft and
  // nothing else. Their colours, their candles, their background; none of their
  // indicators, because a preview crowded with the eight they already run does
  // not answer "what does the thing I am typing look like".
  const stored = useMemo(() => {
    if (!installed) return null
    const base = mergeChartSettings(settings || {})
    const bare = { ...base, indicatorInstances: [], indicators: {} }
    return addInstance(bare, PREVIEW_DEF_ID, engineRegistry)
  }, [installed, settings])

  if (!live || !stored) return null
  return (
    <div className={styles.preview} data-testid="formula-preview" data-def-id={PREVIEW_DEF_ID}>
      <ChartPane
        sym={sym}
        tf={tf}
        density="mini"
        showTfBar={false}
        stored={stored}
        onStore={noop}
        stockChartProps={PREVIEW_CHART_PROPS}
      />
    </div>
  )
}

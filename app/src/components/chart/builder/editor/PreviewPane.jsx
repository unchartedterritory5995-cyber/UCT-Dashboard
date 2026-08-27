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
// ⛔⛔ `null` IS THE SAME OBSERVABLE FOR THREE DIFFERENT REASONS, and that is
// the one thing about this file worth holding in mind while changing it. A
// refused draft, an unknown symbol/timeframe and a registry that refused the
// install all render nothing, so a pane broken outright would read as
// "correctly inert" from every negative test. `PreviewPane.test.jsx` cuts each
// reason ONE AT A TIME on one fixture and restores it — if you add a fourth
// reason to be inert, add its discriminator there too.
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
    setInstalled(got.length === 1 ? got[0] : null)
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

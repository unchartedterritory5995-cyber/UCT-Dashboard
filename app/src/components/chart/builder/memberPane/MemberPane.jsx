// app/src/components/chart/builder/memberPane/MemberPane.jsx
//
// ─── ⭐⭐ T5 — A MEMBER'S OWN PINE, ON A PANE, BEHIND A FLAG ────────────────
//
// The surface `memberPaneGate.js` was written for. It composes the pieces that
// already exist — `memberPaneDefinition` builds the document, the SHIPPED
// install door validates it, `addInstance` puts it in `indicatorInstances`, and
// `ChartPane` draws it — and adds nothing of its own except the flag and the
// disclosures.
//
// ⛔⛔ FLAG-OFF IS A `null` RETURN BEFORE ANY WORK, AND THAT IS THE WHOLE POINT
// OF PUTTING THE CHECK FIRST. `memberPaneEnabled()` is read INSIDE the component
// (never at module scope, so a test can flip it), and when it is off this
// installs nothing, registers nothing, and renders nothing — a member on the
// default build cannot reach an unfinished pane through any path, including a
// registry listing that outlived a render.
//
// ⛔ AND THE TEARDOWN IS NOT OPTIONAL. `PreviewPane`'s header records what a
// leaked definition costs: it rides `listUserDefinitions()` onto the member's
// REAL chart, which is the same list the settings row, the legend and the alert
// address read. The uninstall runs on unmount and whenever the flag or the
// source changes.
//
// ⚠️ WHAT THIS FILE CANNOT PROVE, STATED HERE RATHER THAN IN A REPORT NOBODY
// OPENS: its tests mock `ChartPane`, so every case is about WHAT the pane is
// HANDED, never about pixels. Whether four series actually paint, whether Scale
// Padding is invisible and scale-setting, and whether the sub-pane is a quarter
// high are SCREENSHOT questions and are owed against the real chart.
import { useEffect, useMemo, useState } from 'react'
import ChartPane from '../../pane/ChartPane'
import * as engineRegistry from '../../engine/nativeRegistry'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { memberPaneEnabled } from '../../engine/memberPaneGate'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX } from './memberPaneDefinition'

const noop = () => {}

/** ⭐ The member's real chart already streams and warms this symbol; a second
 *  surface doing both would double the work for one pane. Same recipe
 *  `PreviewPane` uses, and for the same reason. */
const MEMBER_CHART_PROPS = Object.freeze({ liveUpdates: false, backgroundWarm: false })

/**
 * @param {object} props
 * @param {string|null} props.sym    the symbol to draw on
 * @param {string|null} props.tf     the timeframe
 * @param {string|null} props.source the member's Pine
 * @param {string} [props.defId]     the id to install under
 * @param {object|null} props.settings the member's own chart settings
 */
export default function MemberPane({
  sym = null, tf = null, source = null, defId = MEMBER_PANE_DEF_PREFIX, settings = null,
}) {
  // ⛔ FIRST, AND BEFORE ANY BUILD. Reading the flag after `memberPaneDefinition`
  // would translate a member's script on a build that may not show it — work
  // nobody asked for, on the render path.
  const enabled = memberPaneEnabled()
  const live = !!(enabled && sym && tf && source)

  // ⭐ THE BUILD IS MEMOISED ON THE SOURCE, not run per render: `translatePine`
  // on a real script is milliseconds, and milliseconds on every keystroke is a
  // frame budget.
  const built = useMemo(
    () => (live ? memberPaneDefinition({ source, id: defId }) : null),
    [live, source, defId],
  )
  const [installed, setInstalled] = useState(null)

  useEffect(() => {
    if (!built || !built.ok) {
      engineRegistry.uninstallUserDefinition(defId)
      setInstalled(null)
      return undefined
    }
    // ⭐ THE SHIPPED INSTALL DOOR, WHICH IS ALSO THE VALIDATION DOOR. It re-lints
    // the ast lane and refuses a document whose declared repaint mode disagrees
    // with what it measures; a draft it refuses installs nothing and this pane
    // stays inert rather than drawing on a verdict nobody re-measured.
    const { installed: got } = engineRegistry.installUserDefinitions([built.definition])
    if (got.length === 1) {
      setInstalled(got[0])
      return undefined
    }
    // ⛔ A REFUSAL MUST TAKE THE PREVIOUS ENTRY WITH IT — `installUserDefinitions`
    // drops a refused document BEFORE it writes the registry, so it never touches
    // the entry a good source installed a keystroke earlier, and that stale entry
    // would ride `listUserDefinitions()` onto the member's real chart.
    engineRegistry.uninstallUserDefinition(defId)
    setInstalled(null)
    return undefined
  }, [built, defId])

  // ⛔ A SEPARATE, EMPTY-DEP EFFECT for the teardown. Putting it in the cleanup
  // above would fire on every source change — uninstall-then-reinstall bumps the
  // registry generation twice per keystroke and rebuilds every registry-keyed
  // memo on the chart path each time.
  useEffect(() => () => { engineRegistry.uninstallUserDefinition(defId) }, [defId])

  const stored = useMemo(() => {
    if (!installed) return null
    const base = mergeChartSettings(settings || {})
    // ⛔ THE MEMBER'S OWN CANVAS WITH EVERY OTHER INSTANCE REMOVED — their
    // colours and candles, none of their indicators. A pane crowded with the
    // eight they already run does not answer "what does my script look like".
    const bare = { ...base, indicatorInstances: [], indicators: {} }
    return addInstance(bare, defId, engineRegistry)
  }, [installed, settings, defId])

  if (!enabled) return null
  if (!live) return null
  // ⭐ A REFUSAL IS A SENTENCE, NEVER A BLANK. `paneGate` already produced one;
  // this renders it verbatim rather than inventing a second wording.
  if (built && !built.ok) {
    return (
      <div data-testid="pine-member-pane-refusal" role="status">{built.reason}</div>
    )
  }
  if (!stored) return null

  return (
    <div data-testid="pine-member-pane" data-def-id={defId}>
      <ChartPane
        sym={sym}
        tf={tf}
        density="mini"
        showTfBar={false}
        stored={stored}
        onStore={noop}
        stockChartProps={MEMBER_CHART_PROPS}
      />
      {/* ⭐ THE DISCLOSURES THE RULINGS OWE A MEMBER, rendered VERBATIM and
          composed nowhere: the D1 alert note comes from `memberPaneDefinition`,
          which interpolates the condition's name from the one sentence declared
          in `closedTable.json::_alertconditions`. */}
      {built.notes.length > 0 && (
        <ul data-testid="pine-member-pane-notes">
          {built.notes.map((n) => <li key={n.name}>{n.note}</li>)}
        </ul>
      )}
    </div>
  )
}

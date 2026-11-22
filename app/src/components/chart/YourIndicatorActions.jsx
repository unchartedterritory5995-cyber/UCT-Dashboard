// app/src/components/chart/YourIndicatorActions.jsx
//
// THE DOORS ON ONE OF THE MEMBER'S OWN INDICATORS, in the Indicators window's "Your indicators" list.
//
// The same calls as the legend chip's menu: Modify (with the UCT Agent, where the member has it),
// Edit formula, Custom copy, and, since Studio lane R1, Run over a list (the Screener's existing
// run flow, opened on this indicator: `pages/screener/scanLink`).
//
// ⭐ SHARE (Indicators backlog 29). Sharing lived only on the formula builder's Share tab, and the
// builder opens a saved indicator on its Formula tab by its own rule, so a row could not land
// there. The row now opens THE SAME PANEL (`builder/SharePanel`: the link, the library listing,
// the saved versions) in a window of its own. One panel, two places to open it; nothing about
// sharing is restated here. The panel is loaded when Share is first pressed, never with the list.
//
// Its own file so the row's doors can be tested without mounting the whole window. Every button
// stops the click from also adding the row to the chart.
import { lazy, Suspense, useState } from 'react'

import Sheet from '../mobile/Sheet'
import { scanLink } from '../../pages/screener/scanLink'

const SharePanel = lazy(() => import('./builder/SharePanel'))

/** Navigation without a router hook: the window also renders inside pop-outs with no router. */
function go(to) {
  try { window.open(to, '_self') } catch { /* the address is the whole action; nothing to recover */ }
}

/** The name the member gave it, wherever this shape of definition keeps it. */
export function nameOfDefinition(def) {
  const meta = def && def.meta
  const name = (def && (def.label || def.name)) || (meta && meta.name) || ''
  return typeof name === 'string' ? name.trim() : ''
}

/** A press or a key inside the share window is not a press on the row behind it. The window is
 *  drawn elsewhere on the page, but React still hands its events to the row it was opened from. */
const quiet = (e) => { e.stopPropagation() }
/** The wrapper that does that takes no room in the row of buttons. */
const NO_BOX = Object.freeze({ display: 'contents' })

export default function YourIndicatorActions({ def, doors, className, actionClassName }) {
  const [sharing, setSharing] = useState(false)
  if (!def || !doors) return null
  const stop = (fn) => (e) => { e.stopPropagation(); fn() }
  // a stored indicator has the address the Screener and the share routes both take; a draft has neither
  const runLink = scanLink(def.id)
  const stored = !!runLink
  const name = nameOfDefinition(def)
  return (
    <span className={className} data-testid="your-indicator-actions" data-guide="indicators.yours">
      {typeof doors.canModify === 'function' && doors.canModify() && (
        <button type="button" className={actionClassName} data-testid="your-indicator-modify"
          onClick={stop(() => doors.modify(def.id))}>Modify</button>
      )}
      <button type="button" className={actionClassName} data-testid="your-indicator-edit"
        onClick={stop(() => doors.editFormula(def.id))}>Edit formula</button>
      <button type="button" className={actionClassName} data-testid="your-indicator-copy"
        title="A new, independent indicator of your own — this one stays as it is"
        onClick={stop(() => doors.customCopy(def, {}))}>Custom copy</button>
      {runLink && (
        <button type="button" className={actionClassName} data-testid="your-indicator-run"
          title="Open the Screener on this indicator, ready to run over a list of symbols"
          onClick={stop(() => go(runLink))}>Run over a list</button>
      )}
      {stored && (
        <button type="button" className={actionClassName} data-testid="your-indicator-share"
          title="Send a link to this indicator, or publish it to the library"
          onClick={stop(() => setSharing(true))}>Share</button>
      )}
      {sharing && (
        <span data-testid="your-indicator-share-window" style={NO_BOX} onClick={quiet} onMouseDown={quiet}
          onPointerDown={quiet} onKeyDown={quiet}>
          <Sheet open onClose={() => setSharing(false)} maxWidth={560} labelledByTitle
            title={name ? `Share ${name}` : 'Share this indicator'}>
            <Suspense fallback={<p data-testid="your-indicator-share-loading">Opening…</p>}>
              <SharePanel defId={def.id} defName={name || null} noun="indicator" />
            </Suspense>
          </Sheet>
        </span>
      )}
    </span>
  )
}

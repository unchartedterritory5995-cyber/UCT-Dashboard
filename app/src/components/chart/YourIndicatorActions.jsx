// app/src/components/chart/YourIndicatorActions.jsx
//
// THE DOORS ON ONE OF THE MEMBER'S OWN INDICATORS, in the Indicators window's "Your indicators" list.
//
// The same calls as the legend chip's menu: Modify (with the UCT Agent, where the member has it),
// Edit formula, Custom copy, and, since Studio lane R1, Run over a list (the Screener's existing
// run flow, opened on this indicator: `pages/screener/scanLink`).
//
// Its own file so the row's doors can be tested without mounting the whole window. Every button
// stops the click from also adding the row to the chart.
import { scanLink } from '../../pages/screener/scanLink'

/** Navigation without a router hook: the window also renders inside pop-outs with no router. */
function go(to) {
  try { window.open(to, '_self') } catch { /* the address is the whole action; nothing to recover */ }
}

export default function YourIndicatorActions({ def, doors, className, actionClassName }) {
  if (!def || !doors) return null
  const stop = (fn) => (e) => { e.stopPropagation(); fn() }
  const runLink = scanLink(def.id)
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
    </span>
  )
}

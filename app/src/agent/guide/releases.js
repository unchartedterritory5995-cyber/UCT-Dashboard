// ⭐ A control behind a release switch: the guide reads the SAME accessor the widget renders from, at the moment the walkthrough
// starts. Switch on: the walkthrough runs as designed. Switch off: nothing is rung and the member is told plainly that it isn't
// available yet. Never "pick a scan first" for a button no member can see.
//
// A step carries `release: '<name>'`; each name is one accessor and the sentence that is true while it is off. A step on a
// widget the switch keeps off the board (widgets/captureRelease.js UNRELEASED_CAPTURE_WIDGETS: Indexes, Market Context) is
// behind the same switch without saying so: the add-widget menus stop offering it while it is off.
import { captureEnabled, UNRELEASED_CAPTURE_WIDGETS } from '../../widgets/captureRelease'

const WIDGET_NAME = { indexes: 'Indexes', marketcontext: 'Market Context' }

export const RELEASES = {
  // widgets/captureRelease.js: Wave R's capture doors (the Scanner's Send to Journal, pages/charts/widgets/ScannerResults.jsx)
  capture: { on: () => captureEnabled(), off: 'Sending a scan to the Journal isn’t available yet. It will show in the Scanner widget once it’s switched on.' },
}

// the unreleased widget a step's target is on or adds, if any (`{ widgetType: 'indexes' }`, 'workspace.widgets.indexes')
function unreleasedWidget(target) {
  const s = JSON.stringify(target ?? null)
  return UNRELEASED_CAPTURE_WIDGETS.find(id => s.includes(`"widgetType":"${id}"`) || s.includes(`workspace.widgets.${id}"`)) || null
}

// the words name one of them while the walkthrough adds a widget: the menu it opens doesn't offer it while it is off
const WIDGET_WORDS = { indexes: /\bindex(es)?\b/i, marketcontext: /\bmarket context\b/i }
const addsAWidget = (list) => list.some(s => JSON.stringify(s?.target ?? null).includes('workspace.widgets'))
const namedUnreleased = (words) => Object.keys(WIDGET_WORDS).find(id => WIDGET_WORDS[id].test(String(words || ''))) || null

/** → the steps unchanged, or the sentence to say instead when a step's release is off (or can't be read). */
export function releasedOnly(steps, words = '') {
  const list = steps || []
  const step = list.find(s => s && s.release)
  const widget = step ? null : (list.map(s => unreleasedWidget(s?.target)).find(Boolean) || (addsAWidget(list) ? namedUnreleased(words) : null))
  const name = step ? step.release : widget ? 'capture' : null
  if (!name) return steps
  const r = RELEASES[name]
  if (!r) return steps
  let on = false
  try { on = !!r.on() } catch { on = false }
  if (on) return steps
  if (widget) return `The ${WIDGET_NAME[widget] || widget} widget isn’t available yet. It will be on Widgets ▾ once it’s switched on.`
  return step.releaseOff || r.off
}

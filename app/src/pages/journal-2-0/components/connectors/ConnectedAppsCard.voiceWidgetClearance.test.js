// Wave 10 lane FX -- proof walk wk-7bd834b9f clause 6c ("app chrome covers Notebook
// controls at rest"). At 390px, this card (the last one in Settings -> Connections) had
// its own "Connect" button land directly under the app-wide voice widget
// (GlobalVoiceLayer's `.wrap`, fixed bottom-right: bottom:16px + 64px tall = an 80px
// zone). Confirmed live with `document.elementFromPoint` at the reported centre: it
// returned the widget's own svg, never this card's layout.
//
// This rail reads the stylesheet (jsdom lays nothing out): the touch-tier `.section`
// rule must reserve enough bottom padding to give the page room to scroll the card's
// last row clear of the widget's zone.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRules, declarations } from '../../a11y/cssAudit'

const FILE = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'connectors',
  'ConnectedAppsCard.module.css')

// The voice widget's own reserved zone (FloatingOrb.module.css `.orbCluster`):
// bottom:16px + 64px tall.
const WIDGET_ZONE_PX = 16 + 64

function px(value) {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec((value || '').trim())
  return m ? Number(m[1]) : null
}

function sectionRules(css) {
  return parseRules(css)
    .filter((r) => r.selector === '.section')
    .map((r) => Object.fromEntries(declarations(r).map((d) => [d.prop, d.value])))
}

describe('.section reserves room below the voice widget at the touch tier (ConnectedAppsCard.module.css)', () => {
  it('non-vacuity: more than one `.section` rule exists (a base rule and a touch-tier override)', () => {
    expect(sectionRules(readFileSync(FILE, 'utf8')).length).toBeGreaterThan(1)
  })

  it('the LAST `.section` rule (the phone-tier override) reserves at least the widget\'s own zone', () => {
    const rules = sectionRules(readFileSync(FILE, 'utf8'))
    const phoneRule = rules[rules.length - 1]
    const bottom = px(phoneRule['padding-bottom'])
    expect(bottom, `padding-bottom: ${phoneRule['padding-bottom']}`).not.toBeNull()
    expect(bottom).toBeGreaterThanOrEqual(WIDGET_ZONE_PX)
  })

  it('control: the base rule alone declares no bottom padding', () => {
    const rules = sectionRules(readFileSync(FILE, 'utf8'))
    const base = rules[0]
    expect(px(base['padding-bottom'])).toBeNull()
  })
})

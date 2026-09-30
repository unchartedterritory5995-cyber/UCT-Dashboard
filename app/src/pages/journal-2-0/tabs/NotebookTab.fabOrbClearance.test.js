// Wave 10 lane FX -- proof walk wk-7bd834b9f clause 6c ("app chrome covers Notebook
// controls at rest"). At 390px, once a Notebook surface scrolls as far as it goes, the
// LAST row of content (the view-switcher's "Week"/"List view" tab, the find bar's "Show
// replace"/"Find in note") rendered directly under two app-wide fixed overlays every
// Notebook route shares: the Log-Trade FAB (JournalLayout.module.css `.logFab`,
// bottom:70px + 44px tall = a 114px zone) and the voice orb (FloatingOrb.module.css
// `.orbCluster`, bottom:16px + 64px tall = an 80px zone). Confirmed live with
// `document.elementFromPoint` at the reported centres: it returned the FAB's own
// button/span or the orb's own glyph, never a Notebook control.
//
// `.main` carries every Notebook surface (list views AND the open editor, via
// `.mainNote`), so one reservation here covers both classes of finding. This rail reads
// the stylesheet (jsdom lays nothing out): the phone-tier `.main` rule must reserve
// enough bottom padding to clear the taller of the two zones (114px), with margin.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRules, declarations } from '../a11y/cssAudit'

const FILE = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'tabs', 'NotebookTab.module.css')

// The FAB's own reserved zone (JournalLayout.module.css `.logFab`/`.logFabBtn`):
// bottom:70px + min-height 44px. The taller of the two fixed overlays.
const FAB_ZONE_PX = 70 + 44

function px(value) {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec((value || '').trim())
  return m ? Number(m[1]) : null
}

/** Every `.main` rule's declarations, in file order (later ones are inside a
 *  narrower @media block -- parseRules flattens @media, so file order is how
 *  a later, phone-scoped override is told apart from the base rule). */
function mainRules(css) {
  return parseRules(css)
    .filter((r) => r.selector === '.main')
    .map((r) => Object.fromEntries(declarations(r).map((d) => [d.prop, d.value])))
}

describe('.main reserves room below the FAB/orb zone at the touch tier (NotebookTab.module.css)', () => {
  it('non-vacuity: more than one `.main` rule exists (a base rule and a touch-tier override)', () => {
    const rules = mainRules(readFileSync(FILE, 'utf8'))
    expect(rules.length).toBeGreaterThan(1)
  })

  it('the LAST `.main` rule (the phone-tier override) reserves at least the FAB\'s own zone', () => {
    const rules = mainRules(readFileSync(FILE, 'utf8'))
    const phoneRule = rules[rules.length - 1]
    const bottom = px(phoneRule['padding-bottom'])
    expect(bottom, `padding-bottom: ${phoneRule['padding-bottom']}`).not.toBeNull()
    expect(bottom).toBeGreaterThanOrEqual(FAB_ZONE_PX)
  })

  it('control: the base (desktop) rule alone does not reserve enough room', () => {
    const rules = mainRules(readFileSync(FILE, 'utf8'))
    const base = rules[0]
    const bottom = px(base['padding-bottom'])
    expect(bottom === null || bottom < FAB_ZONE_PX).toBe(true)
  })
})

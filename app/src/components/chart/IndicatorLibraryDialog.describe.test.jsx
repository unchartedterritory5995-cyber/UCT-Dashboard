// app/src/components/chart/IndicatorLibraryDialog.describe.test.jsx
//
// ─── CREATE INDICATOR FROM THE LIBRARY ───────────────────────────────────────
//
// Measured on production at 390px, 2026-11-15, the day Create Indicator opened to every
// account: this dialog is the only way into indicators on a phone, and it offered "New
// formula" and nothing else. A member on a phone could not reach the feature at all.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import { mergeChartSettings } from './chartDefaults'
import * as engineRegistry from './engine/nativeRegistry'

const settings = mergeChartSettings(JSON.stringify({}))
const open = (props = {}) => render(
  <IndicatorLibraryDialog open onClose={() => {}} settings={settings} onChange={() => {}}
    registry={engineRegistry} {...props} />)

afterEach(cleanup)

describe('the library offers Create Indicator when the host passes its door', () => {
  it('shows "Describe an indicator" above "New formula", and a press calls the door once', () => {
    const describeIt = vi.fn()
    const formula = vi.fn()
    open({ onCreateIndicator: describeIt, onCreateFormula: formula })
    const d = screen.getByTestId('library-describe')
    const f = screen.getByTestId('library-new-formula')
    expect(d).toHaveTextContent('Describe an indicator')
    // DOM order: the plain-words door comes first.
    expect(d.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(d)
    expect(describeIt).toHaveBeenCalledTimes(1)
    expect(formula).not.toHaveBeenCalled()
  })

  it('says what will happen, in the member\'s terms', () => {
    open({ onCreateIndicator: () => {} })
    expect(screen.getByTestId('library-describe'))
      .toHaveTextContent(/previews on this chart.*nothing is saved until you say so/i)
  })

  it('no door from the host means no row: an account without access sees the library as before', () => {
    open({ onCreateFormula: () => {} })
    expect(screen.queryByTestId('library-describe')).toBeNull()
    expect(screen.getByTestId('library-new-formula')).toBeInTheDocument()      // control: the other row is untouched
  })

  it('it is not filtered by what is typed: a search that finds nothing still offers it', () => {
    open({ onCreateIndicator: () => {} })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz no such indicator' } })
    expect(screen.getByTestId('library-describe')).toBeInTheDocument()
  })
})

// The joystick edge tab's place in the stack (`hub/hub.module.css`, `.edgeTab`). A rail below
// holds this to that file.
const HUB_TAB_Z = 360

describe('wiring and the phone layout (read from source)', () => {
  const src = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8')
  // Comments are stripped first: a rule that only appears in prose must not satisfy these.
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the toolbar passes the door only to an account its own Create Indicator button would open for', () => {
    const t = code(src('./ChartToolbar.jsx'))
    expect(t).toMatch(/onCreateIndicator=\{canModifyWithIntelligence && typeof onStudioPreview === 'function'\s*\?\s*\((?:opts)?\) => \{[^}]*setCreateOpen\(true\)[^}]*\}\s*:\s*null\}/)
    // the library's "Describe it instead" carries its words through as the dock's seed
    expect(t).toMatch(/setCreateSeed\(libraryDescribeSeed\(opts\)\)/)
  })

  it('at the touch tier the dock is a bottom sheet, and the docked variant is left alone', () => {
    const css = code(src('./builder/studio/CreateIndicatorPanel.module.css'))
    const m = css.match(/@media \(max-width: 1024px\) \{\s*\.panel:not\(\.panelDocked\) \{([^}]*)\}/)
    expect(m, 'no touch-tier rule for the floating panel').not.toBeNull()
    const rule = m[1]
    expect(rule).toMatch(/bottom:\s*0/)
    expect(rule).toMatch(/top:\s*auto\s*!important/)
    expect(rule).toMatch(/width:\s*100%/)
    expect(rule).toMatch(/height:\s*min\(58dvh, 560px\)\s*!important/)
  })

  it('on a phone the dock HOST is the sheet: fixed across the bottom, above the joystick tab', () => {
    // Measured on production at 390px, 2026-11-16: the panel is DOCKED in a host that overlays the
    // chart's right edge, so the rule above (the floating panel) never applied there. The host is
    // what has to move. Tried on the live page before it was written here: 354px of chart visible
    // above the sheet, and nothing over its Send button.
    const css = code(src('../../pages/charts/ChartsWorkspace.module.css'))
    const m = css.match(/@media \(max-width: 1024px\) \{\s*\.studioDock\[data-studio-dock="overlay"\] \{([^}]*)\}/)
    expect(m, 'no touch-tier rule for the dock host').not.toBeNull()
    const rule = m[1]
    expect(rule).toMatch(/position:\s*fixed/)
    expect(rule).toMatch(/bottom:\s*0/)
    expect(rule).toMatch(/width:\s*100%/)
    expect(rule).toMatch(/height:\s*min\(58dvh, 560px\)/)
    // The joystick's edge tab is a fixed element; the sheet must sit above it.
    expect(Number(rule.match(/z-index:\s*(\d+)/)[1])).toBeGreaterThan(HUB_TAB_Z)
    // Only the overlay case: a pane wide enough to give the dock a column keeps it.
    expect(css).not.toMatch(/@media \(max-width: 1024px\) \{\s*\.studioDock \{/)
  })

  it('on a tablet the docked column sits just above the joystick tab, so its Send is not covered', () => {
    // Measured on production at 820x1180, 2026-11-16: the element under the dock's Send button was
    // the joystick's edge tab.
    const css = code(src('../../pages/charts/ChartsWorkspace.module.css'))
    const m = css.match(/\.studioDock\[data-studio-dock="dock"\] \{([^}]*)\}/)
    expect(m, 'no rule for the docked column').not.toBeNull()
    expect(Number(m[1].match(/z-index:\s*(\d+)/)[1])).toBeGreaterThan(HUB_TAB_Z)
    // and it is inside the touch-tier block, so the desktop column keeps its own stacking
    // The whole touch-tier block, found by matching braces (line endings differ by checkout).
    const start = css.search(/@media \(max-width: 1024px\) \{\s*\.studioDock\[data-studio-dock="overlay"\]/)
    expect(start, 'the touch-tier block was not found').toBeGreaterThan(-1)
    let depth = 0
    let end = -1
    for (let i = css.indexOf('{', start); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
    }
    expect(css.slice(start, end)).toContain('.studioDock[data-studio-dock="dock"]')
    // control: a rule that is NOT in that block is not found in it
    expect(css.slice(start, end)).not.toContain('.studioDock:empty')
  })

  it("the number these rails compare against is the joystick tab's own place in the stack", () => {
    // Read from the hub's stylesheet and the token it names, so if the tab moves in the stack this
    // fails instead of silently comparing against a remembered number.
    const hub = code(src('../../hub/hub.module.css'))
    const tab = hub.match(/\.edgeTab \{([^}]*)\}/)
    expect(tab, 'the hub no longer declares .edgeTab').not.toBeNull()
    const token = tab[1].match(/z-index:\s*var\((--[a-z-]+)\)/)
    expect(token, 'the edge tab no longer takes its z-index from a token').not.toBeNull()
    const tokens = code(src('../../styles/tokens.css'))
    const at = tokens.indexOf(`${token[1]}:`)
    expect(at, `${token[1]} is not defined in tokens.css`).toBeGreaterThan(-1)
    expect(parseInt(tokens.slice(at + token[1].length + 1), 10)).toBe(HUB_TAB_Z)
  })

  it("in that sheet the docked panel takes the sheet's top edge, not a side border", () => {
    const css = code(src('./builder/studio/CreateIndicatorPanel.module.css'))
    expect(css).toMatch(/\[data-studio-dock="overlay"\] > \.panelDocked \{[^}]*border-left:\s*none;[^}]*border-radius:\s*16px 16px 0 0/)
  })

  it('⛔ CONTROL: the rule check can tell a missing rule from a present one', () => {
    const without = '.panel { position: fixed; width: 360px; }'
    expect(without.match(/@media \(max-width: 1024px\) \{\s*\.panel:not\(\.panelDocked\) \{([^}]*)\}/)).toBeNull()
  })
})
